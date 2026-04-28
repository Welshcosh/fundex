import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionSignature } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { DurationVariant, Side } from "@/lib/constants";
import { FUNDEX_PROGRAM_ID, NOTIONAL_PER_LOT_LAMPORTS, INITIAL_MARGIN_BPS, DRIFT_PRICE_PRECISION } from "./constants";
import { oraclePda, marketPda, vaultPda, positionPda, poolPda, poolVaultPda, lpPositionPda } from "./pda";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const IDL = require("./idl.json");

export interface MarketState {
  perpIndex: number;
  durationVariant: number;
  fixedRate: number;
  notionalPerLot: number;
  expiryTs: number;
  collateralMint: PublicKey;
  cumulativeActualIndex: number;
  cumulativeFixedIndex: number;
  lastSettledTs: number;
  totalFixedPayerLots: number;
  totalFixedReceiverLots: number;
  totalCollateral: number;
  isActive: boolean;
}

export interface PoolInfo {
  address: PublicKey;
  totalShares: number;
  lastActualIndex: number;
  lastFixedIndex: number;
  lastNetLots: number;
  vaultBalance: number;  // USDC lamports
}

export interface LpPositionInfo {
  address: PublicKey;
  shares: number;
  /** Pro-rata USDC value (lamports) */
  usdcValue: number;
}

export interface PositionWithPnl {
  address: PublicKey;
  market: PublicKey;
  side: number;
  lots: number;
  collateralDeposited: number;
  entryActualIndex: number;
  entryFixedIndex: number;
  openTs: number;
  unrealizedPnl: number;
  marginRatioBps: number;
  /** Copied from MarketState for display */
  expiryTs: number;
  fixedRate: number;
  notionalPerLot: number;
}

export class FundexClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly program: Program<any>;
  readonly provider: AnchorProvider;

  constructor(provider: AnchorProvider) {
    this.provider = provider;
    this.program = new Program(IDL, provider);
  }

  get wallet(): PublicKey {
    return this.provider.wallet.publicKey;
  }

  async fetchOracle(perpIndex: number): Promise<{ emaFundingRate: number; numSamples: number } | null> {
    const [pda] = oraclePda(perpIndex);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const acc = await (this.program.account as any).rateOracle.fetch(pda);
      return {
        emaFundingRate: acc.emaFundingRate.toNumber(),
        numSamples: acc.numSamples.toNumber(),
      };
    } catch {
      return null;
    }
  }

  async fetchMarket(perpIndex: number, duration: DurationVariant): Promise<MarketState | null> {
    const [pda] = marketPda(perpIndex, duration);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const acc = await (this.program.account as any).marketState.fetch(pda);
      return {
        perpIndex: acc.perpIndex,
        durationVariant: acc.durationVariant,
        fixedRate: acc.fixedRate.toNumber(),
        notionalPerLot: acc.notionalPerLot.toNumber(),
        expiryTs: acc.expiryTs.toNumber(),
        collateralMint: acc.collateralMint,
        cumulativeActualIndex: acc.cumulativeActualIndex.toNumber(),
        cumulativeFixedIndex: acc.cumulativeFixedIndex.toNumber(),
        lastSettledTs: acc.lastSettledTs.toNumber(),
        totalFixedPayerLots: acc.totalFixedPayerLots.toNumber(),
        totalFixedReceiverLots: acc.totalFixedReceiverLots.toNumber(),
        totalCollateral: acc.totalCollateral.toNumber(),
        isActive: acc.isActive,
      };
    } catch {
      return null;
    }
  }

  /**
   * Batch-fetch all Position accounts that belong to `user` in a single RPC
   * (getProgramAccounts with a memcmp filter on the leading `user: Pubkey`
   * field at offset 8). Returns raw Position fields only — callers combine
   * with fetchMarketsMulti / fetchOraclesMulti for PnL.
   */
  async fetchUserPositions(user: PublicKey): Promise<
    Array<{
      pda: PublicKey;
      market: PublicKey;
      side: number;
      lots: number;
      collateralDeposited: number;
      entryActualIndex: number;
      entryFixedIndex: number;
      openTs: number;
    }>
  > {
    // Discriminator (8) precedes `user: Pubkey` in Position.
    const USER_OFFSET = 8;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accs = await (this.program.account as any).position.all([
      { memcmp: { offset: USER_OFFSET, bytes: user.toBase58() } },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return accs.map((a: any) => ({
      pda: a.publicKey,
      market: a.account.market,
      side: a.account.side,
      lots: a.account.lots.toNumber(),
      collateralDeposited: a.account.collateralDeposited.toNumber(),
      entryActualIndex: a.account.entryActualIndex.toNumber(),
      entryFixedIndex: a.account.entryFixedIndex.toNumber(),
      openTs: a.account.openTs.toNumber(),
    }));
  }

  /** Batch-decode multiple MarketState accounts in a single RPC. */
  async fetchMarketsMulti(pdas: PublicKey[]): Promise<Array<MarketState | null>> {
    if (pdas.length === 0) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accs = await (this.program.account as any).marketState.fetchMultiple(pdas);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return accs.map((acc: any) =>
      acc
        ? {
            perpIndex: acc.perpIndex,
            durationVariant: acc.durationVariant,
            fixedRate: acc.fixedRate.toNumber(),
            notionalPerLot: acc.notionalPerLot.toNumber(),
            expiryTs: acc.expiryTs.toNumber(),
            collateralMint: acc.collateralMint,
            cumulativeActualIndex: acc.cumulativeActualIndex.toNumber(),
            cumulativeFixedIndex: acc.cumulativeFixedIndex.toNumber(),
            lastSettledTs: acc.lastSettledTs.toNumber(),
            totalFixedPayerLots: acc.totalFixedPayerLots.toNumber(),
            totalFixedReceiverLots: acc.totalFixedReceiverLots.toNumber(),
            totalCollateral: acc.totalCollateral.toNumber(),
            isActive: acc.isActive,
          }
        : null,
    );
  }

  /** Batch-decode RateOracles for a set of perp indices in a single RPC. */
  async fetchOraclesMulti(
    perpIndices: number[],
  ): Promise<Record<number, { emaFundingRate: number; numSamples: number } | null>> {
    if (perpIndices.length === 0) return {};
    const pdas = perpIndices.map((p) => oraclePda(p)[0]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accs = await (this.program.account as any).rateOracle.fetchMultiple(pdas);
    const out: Record<number, { emaFundingRate: number; numSamples: number } | null> = {};
    perpIndices.forEach((p, i) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const acc: any = accs[i];
      out[p] = acc
        ? { emaFundingRate: acc.emaFundingRate.toNumber(), numSamples: acc.numSamples.toNumber() }
        : null;
    });
    return out;
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const acc = await (this.program.account as any).position.fetch(posPda);
      const lots = acc.lots.toNumber();
      const collateralDeposited = acc.collateralDeposited.toNumber();
      const entryActualIndex = acc.entryActualIndex.toNumber();
      const entryFixedIndex = acc.entryFixedIndex.toNumber();

      // Split-index PnL: mirrors on-chain unrealized_pnl()
      const actualDelta = market.cumulativeActualIndex - entryActualIndex;
      const fixedDelta = market.cumulativeFixedIndex - entryFixedIndex;
      const netDelta = actualDelta - fixedDelta;
      const rawPnl = (netDelta * lots * market.notionalPerLot) / DRIFT_PRICE_PRECISION;
      const unrealizedPnl = acc.side === Side.FixedPayer ? rawPnl : -rawPnl;
      const notional = market.notionalPerLot * lots;
      const effective = collateralDeposited + unrealizedPnl;
      const marginRatioBps =
        notional > 0 ? Math.floor((Math.max(effective, 0) * 10_000) / notional) : 99_999;

      return {
        address: posPda,
        market: mkt,
        side: acc.side,
        lots,
        collateralDeposited,
        entryActualIndex,
        entryFixedIndex,
        openTs: acc.openTs.toNumber(),
        unrealizedPnl,
        marginRatioBps,
        expiryTs: market.expiryTs,
        fixedRate: market.fixedRate,
        notionalPerLot: market.notionalPerLot,
      };
    } catch {
      return null;
    }
  }

  requiredCollateral(lots: number): number {
    return Math.floor((lots * NOTIONAL_PER_LOT_LAMPORTS * INITIAL_MARGIN_BPS) / 10_000);
  }

  async openPosition(
    perpIndex: number,
    duration: DurationVariant,
    side: Side,
    lots: number,
    userTokenAccount: PublicKey
  ): Promise<TransactionSignature> {
    const [oracle] = oraclePda(perpIndex);  // α: needed for time-weighted entry pre-bias
    const [market] = marketPda(perpIndex, duration);
    const [position] = positionPda(this.wallet, market);
    const [vault] = vaultPda(market);
    const [pv] = poolVaultPda(market);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.program.methods as any)
      .openPosition(side, new BN(lots))
      .accounts({
        user: this.wallet,
        market,
        oracle,
        position,
        vault,
        poolVault: pv,
        userTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
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
    // β: pool / pool_vault counterparty for the locked-skew transfer at close
    const [pool] = poolPda(market);
    const [pv] = poolVaultPda(market);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.program.methods as any)
      .closePosition()
      .accounts({
        user: this.wallet,
        market,
        position,
        vault,
        pool,
        poolVault: pv,
        userTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  async fetchPool(perpIndex: number, duration: DurationVariant): Promise<PoolInfo | null> {
    const [mkt] = marketPda(perpIndex, duration);
    const [pool] = poolPda(mkt);
    const [pv] = poolVaultPda(mkt);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [acc, bal] = await Promise.all([
        (this.program.account as any).poolState.fetch(pool),
        this.provider.connection.getTokenAccountBalance(pv),
      ]);
      return {
        address: pool,
        totalShares: acc.totalShares.toNumber(),
        lastActualIndex: acc.lastActualIndex.toNumber(),
        lastFixedIndex: acc.lastFixedIndex.toNumber(),
        lastNetLots: acc.lastNetLots.toNumber(),
        vaultBalance: Number(bal.value.amount),
      };
    } catch {
      return null;
    }
  }

  async fetchLpPosition(
    user: PublicKey,
    perpIndex: number,
    duration: DurationVariant
  ): Promise<LpPositionInfo | null> {
    const [mkt] = marketPda(perpIndex, duration);
    const [pool] = poolPda(mkt);
    const [lpAddr] = lpPositionPda(user, pool);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const acc = await (this.program.account as any).lpPosition.fetch(lpAddr);
      const shares = acc.shares.toNumber();
      // Get pool vault balance to compute pro-rata value
      const poolInfo = await this.fetchPool(perpIndex, duration);
      const usdcValue =
        poolInfo && poolInfo.totalShares > 0
          ? Math.floor((shares * poolInfo.vaultBalance) / poolInfo.totalShares)
          : 0;
      return { address: lpAddr, shares, usdcValue };
    } catch {
      return null;
    }
  }

  async depositLp(
    perpIndex: number,
    duration: DurationVariant,
    amount: number,
    userTokenAccount: PublicKey
  ): Promise<TransactionSignature> {
    const [mkt] = marketPda(perpIndex, duration);
    const [pool] = poolPda(mkt);
    const [pv] = poolVaultPda(mkt);
    const [lp] = lpPositionPda(this.wallet, pool);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.program.methods as any)
      .depositLp(new BN(amount))
      .accounts({
        user: this.wallet,
        market: mkt,
        pool,
        lpPosition: lp,
        poolVault: pv,
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
    const [pv] = poolVaultPda(mkt);
    const [lp] = lpPositionPda(this.wallet, pool);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.program.methods as any)
      .withdrawLp(new BN(shares))
      .accounts({
        user: this.wallet,
        market: mkt,
        pool,
        lpPosition: lp,
        poolVault: pv,
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
    const [pv] = poolVaultPda(mkt);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.program.methods as any)
      .syncPoolPnl()
      .accounts({
        caller: this.wallet,
        market: mkt,
        pool,
        vault,
        poolVault: pv,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  async initializeMarket(
    perpIndex: number,
    duration: DurationVariant,
    collateralMint: PublicKey,
    fixedRateOverride?: number,
    skewKOverride?: number,
  ): Promise<TransactionSignature> {
    const [oracle] = oraclePda(perpIndex);
    const [market] = marketPda(perpIndex, duration);
    const [vault] = vaultPda(market);
    const fixedRate = fixedRateOverride !== undefined ? new BN(fixedRateOverride) : null;
    // β: skew_k_override — null falls back to DEFAULT_SKEW_K (50_000) on-chain
    const skewK = skewKOverride !== undefined ? new BN(skewKOverride) : null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.program.methods as any)
      .initializeMarket(perpIndex, duration, fixedRate, skewK)
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
}
