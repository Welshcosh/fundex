/**
 * crank.ts
 *
 * Crank bot: fetches real 8h funding rates from Drift Protocol (mainnet)
 * and calls settle_funding on all active Fundex markets every hour.
 *
 * Usage:
 *   yarn crank:devnet          # settle on devnet with mainnet rates
 *   yarn crank:devnet:dry      # dry run (log only)
 *
 * Env vars:
 *   INTERVAL_MS=3600000   settlement interval in ms (default: 1h)
 *   DRY_RUN=true          log only, don't send transactions
 */

import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Fundex } from "../target/types/fundex";
import { Buffer } from "buffer";
import { Keypair, Connection, PublicKey } from "@solana/web3.js";
import {
  DriftClient,
  Wallet,
  FUNDING_RATE_PRECISION,
} from "@drift-labs/sdk";

// ─── Config ──────────────────────────────────────────────────────────────────

const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 3_600_000); // 1h default
const DRY_RUN = process.env.DRY_RUN === "true";
const MAINNET_RPC = process.env.MAINNET_RPC ?? "https://api.mainnet-beta.solana.com";

/**
 * Map our perpIndex → Drift's marketIndex (mainnet)
 * Verify at: https://app.drift.trade/stats
 */
const DRIFT_MARKET_INDEX: Record<number, number> = {
  0: 1,  // BTC-PERP
  1: 2,  // ETH-PERP
  2: 0,  // SOL-PERP
  3: 20, // JTO-PERP
};

const PERP_INDICES = [0, 1, 2, 3];
const DURATIONS    = [0, 1, 2, 3];

// ─── PDA helpers ─────────────────────────────────────────────────────────────

function oraclePda(perpIndex: number, programId: PublicKey): PublicKey {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(perpIndex);
  return PublicKey.findProgramAddressSync([Buffer.from("rate_oracle"), buf], programId)[0];
}

function marketPda(perpIndex: number, duration: number, programId: PublicKey): PublicKey {
  const perpBuf = Buffer.alloc(2);
  perpBuf.writeUInt16LE(perpIndex);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), perpBuf, Buffer.from([duration])],
    programId
  )[0];
}

// ─── Drift PerpMarket PDA ─────────────────────────────────────────────────────

const DRIFT_PROGRAM_ID = new PublicKey("dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH");

/**
 * Drift PerpMarket PDA = ["perp_market", marketIndex as u16 LE]
 * Same on mainnet and devnet (same program ID).
 */
function driftPerpMarketPda(driftMarketIndex: number): PublicKey {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(driftMarketIndex);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("perp_market"), buf],
    DRIFT_PROGRAM_ID
  )[0];
}

// ─── Drift rate logger (for display only — on-chain reads rate directly) ─────

/**
 * Logs the current Drift lastFundingRate for monitoring purposes.
 * The actual rate used for settlement is read on-chain by the program.
 */
async function logDriftRate(
  driftClient: DriftClient,
  perpIndex: number,
): Promise<void> {
  const driftIndex = DRIFT_MARKET_INDEX[perpIndex];
  if (driftIndex === undefined) return;

  try {
    const market = driftClient.getPerpMarketAccount(driftIndex);
    if (!market) return;
    const lastRate: BN = market.amm.lastFundingRate;
    const fundingRatePrec: BN = FUNDING_RATE_PRECISION;
    const pricePrec = 1_000_000;
    const displayRate = lastRate.muln(pricePrec).div(fundingRatePrec).toNumber();
    console.log(`  [Drift] perp=${perpIndex} lastFundingRate=${displayRate} (1e6 units)`);
  } catch {
    // Non-critical — just for display
  }
}

// ─── Settlement loop ─────────────────────────────────────────────────────────

async function settleAll(
  program: anchor.Program<Fundex>,
  driftClient: DriftClient,
) {
  const crankKey = (program.provider as anchor.AnchorProvider).wallet.publicKey;
  const now = new Date().toISOString();

  for (const perpIndex of PERP_INDICES) {
    const driftIndex = DRIFT_MARKET_INDEX[perpIndex];
    const driftPerpMarket = driftPerpMarketPda(driftIndex);

    // Log current rate for monitoring (on-chain program reads it directly)
    await logDriftRate(driftClient, perpIndex);

    const oracle = oraclePda(perpIndex, program.programId);

    for (const duration of DURATIONS) {
      const market = marketPda(perpIndex, duration, program.programId);

      // Skip if market not initialized or inactive
      let isActive = false;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mktAcc = await (program.account as any).marketState.fetch(market);
        isActive = mktAcc.isActive;
      } catch {
        continue;
      }
      if (!isActive) continue;

      const label = `perp=${perpIndex} dur=${duration}`;

      if (DRY_RUN) {
        console.log(`[${now}] DRY_RUN settle_funding ${label} driftMarket=${driftPerpMarket.toBase58().slice(0, 8)}…`);
        continue;
      }

      try {
        const sig = await (program.methods as any)
          .settleFunding()
          .accounts({ crank: crankKey, market, oracle, driftPerpMarket })
          .rpc();
        console.log(`[${now}] ✓ settle_funding ${label} sig=${sig.slice(0, 8)}…`);
      } catch (e: any) {
        if (e.message?.includes("TooSoon") || e.message?.includes("FundingIntervalNotElapsed")) {
          console.log(`[${now}] ~ ${label}: too soon, skipping`);
        } else {
          console.error(`[${now}] ✗ ${label}: ${e.message?.slice(0, 100)}`);
        }
      }
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // ── Fundex client (devnet) ──
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Fundex as anchor.Program<Fundex>;

  // ── Drift client (mainnet — read-only for live rates) ──
  const mainnetConn = new Connection(MAINNET_RPC, "confirmed");
  const dummyKeypair = Keypair.generate();
  const driftClient = new DriftClient({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connection: mainnetConn as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wallet: new Wallet(dummyKeypair as any),
    env: "mainnet-beta",
    accountSubscription: { type: "websocket" },
  });
  await driftClient.subscribe();

  console.log("=".repeat(60));
  console.log("Fundex crank bot");
  console.log("=".repeat(60));
  console.log(`Crank:    ${provider.wallet.publicKey.toBase58()}`);
  console.log(`Interval: ${INTERVAL_MS / 1000}s`);
  console.log(`Dry run:  ${DRY_RUN}`);
  console.log(`Drift:    mainnet-beta (rate source)`);
  console.log("=".repeat(60));

  // Run immediately, then on interval
  await settleAll(program, driftClient);
  setInterval(() => settleAll(program, driftClient), INTERVAL_MS);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
