import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionSignature,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { Fundex } from "../../target/types/fundex";
import IDL from "../../target/idl/fundex.json";
import {
  FUNDEX_PROGRAM_ID,
  DurationVariant,
  Side,
  NOTIONAL_PER_LOT,
  INITIAL_MARGIN_BPS,
  DRIFT_PRICE_PRECISION,
} from "./constants";
import { oraclePda, marketPda, vaultPda, positionPda, poolPda, poolVaultPda, lpPositionPda } from "./pda";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface RateOracle {
  perpIndex: number;
  emaFundingRate: number;
  lastUpdateTs: number;
  numSamples: number;
}

export interface MarketState {
  perpIndex: number;
  durationVariant: number;
  fixedRate: number;
  notionalPerLot: number;
  expiryTs: number;
  collateralMint: PublicKey;
  cumulativeRateIndex: number;
  lastSettledTs: number;
  totalFixedPayerLots: number;
  totalFixedReceiverLots: number;
  totalCollateral: number;
  isActive: boolean;
  admin: PublicKey;
}

export interface Position {
  user: PublicKey;
  market: PublicKey;
  side: number;
  lots: number;
  collateralDeposited: number;
  entryRateIndex: number;
  openTs: number;
}

export interface PositionWithPnl extends Position {
  unrealizedPnl: number;  // USDC lamports
  marginRatioBps: number;
  address: PublicKey;
}

export interface PoolState {
  market: PublicKey;
  totalShares: number;
  lastRateIndex: number;
  lastNetLots: number;
  address: PublicKey;
  vaultBalance: number;  // USDC lamports in pool vault
}

export interface LpPosition {
  user: PublicKey;
  pool: PublicKey;
  shares: number;
  address: PublicKey;
}

// ─── FundexClient ─────────────────────────────────────────────────────────────

export class FundexClient {
  readonly program: Program<Fundex>;
  readonly provider: AnchorProvider;

  constructor(
    provider: AnchorProvider,
    programId: PublicKey = FUNDEX_PROGRAM_ID
  ) {
    this.provider = provider;
    this.program = new Program<Fundex>(IDL as Fundex, provider);
  }

  get connection(): Connection {
    return this.provider.connection;
  }

  get wallet(): PublicKey {
    return this.provider.wallet.publicKey;
  }

  // ─── Reads ──────────────────────────────────────────────────────────────────

  async fetchOracle(perpIndex: number): Promise<RateOracle | null> {
    const [pda] = oraclePda(perpIndex);
    try {
      const acc = await this.program.account.rateOracle.fetch(pda);
      return {
        perpIndex: acc.perpIndex,
        emaFundingRate: acc.emaFundingRate.toNumber(),
        lastUpdateTs: acc.lastUpdateTs.toNumber(),
        numSamples: acc.numSamples.toNumber(),
      };
    } catch {
      return null;
    }
  }

  async fetchMarket(
    perpIndex: number,
    duration: DurationVariant
  ): Promise<MarketState | null> {
    const [pda] = marketPda(perpIndex, duration);
    try {
      const acc = await this.program.account.marketState.fetch(pda);
      return {
        perpIndex: acc.perpIndex,
        durationVariant: acc.durationVariant,
        fixedRate: acc.fixedRate.toNumber(),
        notionalPerLot: acc.notionalPerLot.toNumber(),
        expiryTs: acc.expiryTs.toNumber(),
        collateralMint: acc.collateralMint,
        cumulativeRateIndex: acc.cumulativeRateIndex.toNumber(),
        lastSettledTs: acc.lastSettledTs.toNumber(),
        totalFixedPayerLots: acc.totalFixedPayerLots.toNumber(),
        totalFixedReceiverLots: acc.totalFixedReceiverLots.toNumber(),
        totalCollateral: acc.totalCollateral.toNumber(),
        isActive: acc.isActive,
        admin: acc.admin,
      };
    } catch {
      return null;
    }
  }

  async fetchPosition(
    user: PublicKey,
    perpIndex: number,
    duration: DurationVariant
  ): Promise<PositionWithPnl | null> {
    const [mkt] = marketPda(perpIndex, duration);
    const [posPda] = positionPda(user, mkt);
    const market = await this.fetchMarket(perpIndex, duration);
    if (!market) return null;

    try {
      const acc = await this.program.account.position.fetch(posPda);
      const pos: Position = {
        user: acc.user,
        market: acc.market,
        side: acc.side,
        lots: acc.lots.toNumber(),
        collateralDeposited: acc.collateralDeposited.toNumber(),
        entryRateIndex: acc.entryRateIndex.toNumber(),
        openTs: acc.openTs.toNumber(),
      };
      const rateDelta = market.cumulativeRateIndex - pos.entryRateIndex;
      const rawPnl =
        (rateDelta * pos.lots * market.notionalPerLot) / DRIFT_PRICE_PRECISION;
      const unrealizedPnl =
        pos.side === Side.FixedPayer ? rawPnl : -rawPnl;
      const notional = market.notionalPerLot * pos.lots;
      const effective = pos.collateralDeposited + unrealizedPnl;
      const marginRatioBps =
        notional > 0
          ? Math.floor((Math.max(effective, 0) * 10_000) / notional)
          : 99_999;

      return { ...pos, unrealizedPnl, marginRatioBps, address: posPda };
    } catch {
      return null;
    }
  }

  /** Required collateral (USDC lamports) for a given number of lots */
  requiredCollateral(lots: number): number {
    return Math.floor(
      (lots * NOTIONAL_PER_LOT * INITIAL_MARGIN_BPS) / 10_000
    );
  }

  // ─── Writes ─────────────────────────────────────────────────────────────────

  async initializeOracle(perpIndex: number): Promise<TransactionSignature> {
    const [oracle] = oraclePda(perpIndex);
    return (this.program.methods.initializeRateOracle(perpIndex) as any)
      .accounts({
        admin: this.wallet,
        oracle,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async initializeMarket(
    perpIndex: number,
    duration: DurationVariant,
    collateralMint: PublicKey,
    /** undefined → V2 auto from oracle EMA */
    fixedRateOverride?: number
  ): Promise<TransactionSignature> {
    const [oracle] = oraclePda(perpIndex);
    const [market] = marketPda(perpIndex, duration);
    const [vault] = vaultPda(market);
    const fixedRate =
      fixedRateOverride !== undefined ? new BN(fixedRateOverride) : null;

    return (this.program.methods.initializeMarket(perpIndex, duration, fixedRate) as any)
      .accounts({
        admin: this.wallet,
        oracle,
        market,
        vault,
        collateralMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();
  }

  async openPosition(
    perpIndex: number,
    duration: DurationVariant,
    side: Side,
    lots: number,
    userTokenAccount: PublicKey
  ): Promise<TransactionSignature> {
    const [market] = marketPda(perpIndex, duration);
    const [position] = positionPda(this.wallet, market);
    const [vault] = vaultPda(market);

    return (this.program.methods.openPosition(side, new BN(lots)) as any)
      .accounts({
        user: this.wallet,
        market,
        position,
        vault,
        userTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async settleFunding(
    perpIndex: number,
    duration: DurationVariant,
    actualRate: number
  ): Promise<TransactionSignature> {
    const [market] = marketPda(perpIndex, duration);
    const [oracle] = oraclePda(perpIndex);

    return (this.program.methods.settleFunding(new BN(actualRate)) as any)
      .accounts({
        crank: this.wallet,
        market,
        oracle,
      })
      .rpc();
  }

  async closePosition(
    perpIndex: number,
    duration: DurationVariant,
    userTokenAccount: PublicKey
  ): Promise<TransactionSignature> {
    const [market] = marketPda(perpIndex, duration);
    const [position] = positionPda(this.wallet, market);
    const [vault] = vaultPda(market);

    return (this.program.methods.closePosition() as any)
      .accounts({
        user: this.wallet,
        market,
        position,
        vault,
        userTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  async liquidatePosition(
    targetUser: PublicKey,
    perpIndex: number,
    duration: DurationVariant,
    liquidatorTokenAccount: PublicKey
  ): Promise<TransactionSignature> {
    const [market] = marketPda(perpIndex, duration);
    const [position] = positionPda(targetUser, market);
    const [vault] = vaultPda(market);

    return (this.program.methods.liquidatePosition() as any)
      .accounts({
        liquidator: this.wallet,
        market,
        position,
        vault,
        liquidatorTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  // ─── Pool reads ─────────────────────────────────────────────────────────────

  async fetchPool(
    perpIndex: number,
    duration: DurationVariant
  ): Promise<PoolState | null> {
    const [mkt] = marketPda(perpIndex, duration);
    const [poolAddr] = poolPda(mkt);
    const [pv] = poolVaultPda(mkt);
    try {
      const [acc, vaultAcc] = await Promise.all([
        this.program.account.poolState.fetch(poolAddr),
        this.connection.getTokenAccountBalance(pv),
      ]);
      return {
        market: acc.market,
        totalShares: acc.totalShares.toNumber(),
        lastRateIndex: acc.lastRateIndex.toNumber(),
        lastNetLots: acc.lastNetLots.toNumber(),
        address: poolAddr,
        vaultBalance: Number(vaultAcc.value.amount),
      };
    } catch {
      return null;
    }
  }

  async fetchLpPosition(
    user: PublicKey,
    perpIndex: number,
    duration: DurationVariant
  ): Promise<LpPosition | null> {
    const [mkt] = marketPda(perpIndex, duration);
    const [poolAddr] = poolPda(mkt);
    const [lpAddr] = lpPositionPda(user, poolAddr);
    try {
      const acc = await this.program.account.lpPosition.fetch(lpAddr);
      return {
        user: acc.user,
        pool: acc.pool,
        shares: acc.shares.toNumber(),
        address: lpAddr,
      };
    } catch {
      return null;
    }
  }

  // ─── Pool writes ────────────────────────────────────────────────────────────

  async initializePool(
    perpIndex: number,
    duration: DurationVariant,
    collateralMint: PublicKey
  ): Promise<TransactionSignature> {
    const [mkt] = marketPda(perpIndex, duration);
    const [pool] = poolPda(mkt);
    const [poolVault] = poolVaultPda(mkt);

    return (this.program.methods.initializePool() as any)
      .accounts({
        admin: this.wallet,
        market: mkt,
        pool,
        poolVault,
        collateralMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();
  }

  async depositLp(
    perpIndex: number,
    duration: DurationVariant,
    amount: number,
    userTokenAccount: PublicKey
  ): Promise<TransactionSignature> {
    const [mkt] = marketPda(perpIndex, duration);
    const [pool] = poolPda(mkt);
    const [poolVault] = poolVaultPda(mkt);
    const [lpPosition] = lpPositionPda(this.wallet, pool);

    return (this.program.methods.depositLp(new BN(amount)) as any)
      .accounts({
        user: this.wallet,
        market: mkt,
        pool,
        lpPosition,
        poolVault,
        userTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async withdrawLp(
    perpIndex: number,
    duration: DurationVariant,
    shares: number,
    userTokenAccount: PublicKey
  ): Promise<TransactionSignature> {
    const [mkt] = marketPda(perpIndex, duration);
    const [pool] = poolPda(mkt);
    const [poolVault] = poolVaultPda(mkt);
    const [lpPosition] = lpPositionPda(this.wallet, pool);

    return (this.program.methods.withdrawLp(new BN(shares)) as any)
      .accounts({
        user: this.wallet,
        market: mkt,
        pool,
        lpPosition,
        poolVault,
        userTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  async syncPoolPnl(
    perpIndex: number,
    duration: DurationVariant
  ): Promise<TransactionSignature> {
    const [mkt] = marketPda(perpIndex, duration);
    const [pool] = poolPda(mkt);
    const [vault] = vaultPda(mkt);
    const [poolVault] = poolVaultPda(mkt);

    return (this.program.methods.syncPoolPnl() as any)
      .accounts({
        caller: this.wallet,
        market: mkt,
        pool,
        vault,
        poolVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }
}
