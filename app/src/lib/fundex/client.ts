import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionSignature } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { DurationVariant, Side } from "@/lib/constants";
import { FUNDEX_PROGRAM_ID, NOTIONAL_PER_LOT_LAMPORTS, INITIAL_MARGIN_BPS, DRIFT_PRICE_PRECISION } from "./constants";
import { oraclePda, marketPda, vaultPda, positionPda } from "./pda";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const IDL = require("./idl.json");

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
}

export interface PositionWithPnl {
  address: PublicKey;
  market: PublicKey;
  side: number;
  lots: number;
  collateralDeposited: number;
  entryRateIndex: number;
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
        cumulativeRateIndex: acc.cumulativeRateIndex.toNumber(),
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
      const entryRateIndex = acc.entryRateIndex.toNumber();

      const rateDelta = market.cumulativeRateIndex - entryRateIndex;
      const rawPnl = (rateDelta * lots * market.notionalPerLot) / DRIFT_PRICE_PRECISION;
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
        entryRateIndex,
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
    const [market] = marketPda(perpIndex, duration);
    const [position] = positionPda(this.wallet, market);
    const [vault] = vaultPda(market);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.program.methods as any)
      .openPosition(side, new BN(lots))
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

  async closePosition(
    perpIndex: number,
    duration: DurationVariant,
    userTokenAccount: PublicKey
  ): Promise<TransactionSignature> {
    const [market] = marketPda(perpIndex, duration);
    const [position] = positionPda(this.wallet, market);
    const [vault] = vaultPda(market);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.program.methods as any)
      .closePosition()
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

  async initializeMarket(
    perpIndex: number,
    duration: DurationVariant,
    collateralMint: PublicKey,
    fixedRateOverride?: number
  ): Promise<TransactionSignature> {
    const [oracle] = oraclePda(perpIndex);
    const [market] = marketPda(perpIndex, duration);
    const [vault] = vaultPda(market);
    const fixedRate = fixedRateOverride !== undefined ? new BN(fixedRateOverride) : null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.program.methods as any)
      .initializeMarket(perpIndex, duration, fixedRate)
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
