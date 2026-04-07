/**
 * crank-devnet.ts
 *
 * Devnet demo crank: settles funding by passing the Drift PerpMarket account.
 * The on-chain program reads lastFundingRate directly from the account — no
 * off-chain rate input required.
 *
 * Usage:
 *   yarn crank:demo             # settle every 5 minutes
 *   INTERVAL_MS=60000 yarn crank:demo  # settle every 1 minute
 *   DRY_RUN=true yarn crank:demo       # log only
 */

import * as anchor from "@coral-xyz/anchor";
import { Fundex } from "../target/types/fundex";
import { PublicKey } from "@solana/web3.js";

const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 5 * 60 * 1000); // 5 min default
const DRY_RUN = process.env.DRY_RUN === "true";

// Drift program ID (same on mainnet and devnet)
const DRIFT_PROGRAM_ID = new PublicKey("dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH");

/**
 * Drift PerpMarket PDA = ["perp_market", marketIndex as u16 LE]
 * These are the same on both mainnet and devnet.
 */
function driftPerpMarketPda(driftMarketIndex: number): PublicKey {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(driftMarketIndex);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("perp_market"), buf],
    DRIFT_PROGRAM_ID
  )[0];
}

/**
 * Map our perpIndex → Drift's marketIndex
 */
const DRIFT_MARKET_INDEX: Record<number, number> = {
  0: 1,  // BTC-PERP
  1: 2,  // ETH-PERP
  2: 0,  // SOL-PERP
  3: 20, // JTO-PERP
};

const PERPS = [
  { index: 0, name: "BTC-PERP" },
  { index: 1, name: "ETH-PERP" },
  { index: 2, name: "SOL-PERP" },
  { index: 3, name: "JTO-PERP" },
];

const DURATIONS = [0, 1, 2, 3];

function oraclePda(perpIndex: number, programId: PublicKey): PublicKey {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(perpIndex);
  return PublicKey.findProgramAddressSync([Buffer.from("rate_oracle"), buf], programId)[0];
}

function marketPda(perpIndex: number, duration: number, programId: PublicKey): PublicKey {
  const pb = Buffer.alloc(2);
  pb.writeUInt16LE(perpIndex);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), pb, Buffer.from([duration])],
    programId
  )[0];
}

async function settleAll(program: anchor.Program<Fundex>) {
  const crank = (program.provider as anchor.AnchorProvider).wallet.publicKey;
  const now = new Date().toISOString();

  for (const perp of PERPS) {
    const oracle = oraclePda(perp.index, program.programId);
    const driftIndex = DRIFT_MARKET_INDEX[perp.index];
    const driftPerpMarket = driftPerpMarketPda(driftIndex);

    for (const dur of DURATIONS) {
      const market = marketPda(perp.index, dur, program.programId);

      // Check if market is active
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mktAcc = await (program.account as any).marketState.fetch(market);
        if (!mktAcc.isActive) continue;
      } catch {
        continue;
      }

      const label = `${perp.name} ${["7D","30D","90D","180D"][dur]}`;

      if (DRY_RUN) {
        console.log(`[${now}] DRY settle_funding ${label} driftMarket=${driftPerpMarket.toBase58().slice(0, 8)}…`);
        continue;
      }

      try {
        const sig = await (program.methods as any)
          .settleFunding()
          .accounts({ crank, market, oracle, driftPerpMarket })
          .rpc();
        console.log(`[${now}] ✓ ${label} sig=${sig.slice(0, 8)}…`);
      } catch (e: any) {
        if (e.message?.includes("TooSoon") || e.message?.includes("TooEarlyToSettle")) {
          console.log(`[${now}] ~ ${label}: too soon`);
        } else {
          console.error(`[${now}] ✗ ${label}: ${e.message?.slice(0, 80)}`);
        }
      }
    }
  }
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Load IDL directly from file to avoid workspace version mismatch after redeploy
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const IDL = require("../target/idl/fundex.json");
  const program = new anchor.Program(IDL, provider) as anchor.Program<Fundex>;

  console.log("=".repeat(60));
  console.log("Fundex devnet demo crank (on-chain Drift rate verification)");
  console.log("=".repeat(60));
  console.log(`Crank:    ${provider.wallet.publicKey.toBase58()}`);
  console.log(`Interval: ${INTERVAL_MS / 1000}s`);
  console.log(`Dry run:  ${DRY_RUN}`);
  console.log("=".repeat(60));

  // Initial run — non-fatal
  try {
    await settleAll(program);
  } catch (e: any) {
    console.error("Initial settle error (continuing):", e?.message ?? e);
  }

  // Keep running indefinitely — errors in settleAll are already caught per-market
  setInterval(async () => {
    try {
      await settleAll(program);
    } catch (e: any) {
      console.error("Settle loop error (continuing):", e?.message ?? e);
    }
  }, INTERVAL_MS);
}

// Global safety net — log but don't exit
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

main().catch((e) => {
  console.error("Fatal startup error:", e);
  process.exit(1);
});
