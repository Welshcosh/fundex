/**
 * crank-devnet.ts
 *
 * Devnet demo crank: settles funding every INTERVAL_MS using stable mock rates.
 * Designed for hackathon demos — no Drift mainnet dependency.
 *
 * Usage:
 *   yarn crank:demo             # settle every 5 minutes
 *   INTERVAL_MS=60000 yarn crank:demo  # settle every 1 minute
 *   DRY_RUN=true yarn crank:demo       # log only
 *
 * Rates (Drift PRICE_PRECISION units, display = rate/10000 %):
 *   BTC-PERP: 8500  → 0.85% per settlement
 *   ETH-PERP: 5200  → 0.52%
 *   SOL-PERP: 12100 → 1.21%
 *   JTO-PERP: 3300  → 0.33%
 */

import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Fundex } from "../target/types/fundex";
import { PublicKey } from "@solana/web3.js";

const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 5 * 60 * 1000); // 5 min default
const DRY_RUN = process.env.DRY_RUN === "true";

const PERPS = [
  { index: 0, name: "BTC-PERP", rate: 8500 },
  { index: 1, name: "ETH-PERP", rate: 5200 },
  { index: 2, name: "SOL-PERP", rate: 12100 },
  { index: 3, name: "JTO-PERP", rate: 3300 },
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
        console.log(`[${now}] DRY settle_funding ${label} rate=${perp.rate}`);
        continue;
      }

      try {
        const sig = await (program.methods as any)
          .settleFunding(new BN(perp.rate))
          .accounts({ crank, market, oracle })
          .rpc();
        console.log(`[${now}] ✓ ${label} rate=${perp.rate} sig=${sig.slice(0, 8)}…`);
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
  const program = anchor.workspace.Fundex as anchor.Program<Fundex>;

  console.log("=".repeat(60));
  console.log("Fundex devnet demo crank");
  console.log("=".repeat(60));
  console.log(`Crank:    ${provider.wallet.publicKey.toBase58()}`);
  console.log(`Interval: ${INTERVAL_MS / 1000}s`);
  console.log(`Dry run:  ${DRY_RUN}`);
  console.log("=".repeat(60));

  await settleAll(program);
  setInterval(() => settleAll(program), INTERVAL_MS);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
