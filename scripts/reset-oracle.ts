/**
 * reset-oracle.ts
 *
 * Rapidly resets oracle EMA values to realistic rates by calling
 * settle_funding 60 times per perp (testing feature must be ON, no interval).
 *
 * Target rates (Drift PRICE_PRECISION, 1e6 units):
 *   BTC-PERP: 8500  → 0.85% per 8h
 *   ETH-PERP: 5200  → 0.52% per 8h
 *   SOL-PERP: 12100 → 1.21% per 8h
 *   JTO-PERP: 3300  → 0.33% per 8h
 */

import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Fundex } from "../target/types/fundex";
import { PublicKey } from "@solana/web3.js";

const PERPS = [
  { index: 0, name: "BTC-PERP", targetRate: 8500 },
  { index: 1, name: "ETH-PERP", targetRate: 5200 },
  { index: 2, name: "SOL-PERP", targetRate: 12100 },
  { index: 3, name: "JTO-PERP", targetRate: 3300 },
];

const DURATIONS = [0, 1, 2, 3];
const SETTLE_ROUNDS = 60; // EMA window=10, 60 rounds brings EMA within ~0.1% of target

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

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Fundex as anchor.Program<Fundex>;
  const crank = provider.wallet.publicKey;

  console.log("=".repeat(60));
  console.log("Oracle reset — " + SETTLE_ROUNDS + " rounds per perp");
  console.log("=".repeat(60));

  for (const perp of PERPS) {
    const oracle = oraclePda(perp.index, program.programId);

    // Check current EMA
    const before = await program.account.rateOracle.fetch(oracle);
    const emaBefore = before.emaFundingRate.toNumber();
    console.log(`\n${perp.name} EMA before: ${emaBefore} (${(emaBefore/10000).toFixed(4)}%)`);

    // Use any one market for settling (7D = duration 0)
    const market = marketPda(perp.index, 0, program.programId);

    let settled = 0;
    for (let i = 0; i < SETTLE_ROUNDS; i++) {
      try {
        await (program.methods as any)
          .settleFunding(new BN(perp.targetRate))
          .accounts({ crank, market, oracle })
          .rpc();
        settled++;
        if (i % 10 === 9) process.stdout.write(".");
      } catch (e: any) {
        if (e.message?.includes("TooEarlyToSettle")) {
          console.warn(`\n  ⚠ TooEarlyToSettle at round ${i} — testing feature may not be enabled`);
          break;
        }
        // Skip other transient errors
      }
    }

    const after = await program.account.rateOracle.fetch(oracle);
    const emaAfter = after.emaFundingRate.toNumber();
    console.log(`\n${perp.name} EMA after ${settled} rounds: ${emaAfter} (${(emaAfter/10000).toFixed(4)}%)`);
  }

  // Also settle remaining durations to keep cumulative_rate_index in sync
  console.log("\nSyncing remaining durations (30D/90D/180D)…");
  for (const perp of PERPS) {
    const oracle = oraclePda(perp.index, program.programId);
    for (const dur of [1, 2, 3]) {
      const market = marketPda(perp.index, dur, program.programId);
      for (let i = 0; i < SETTLE_ROUNDS; i++) {
        try {
          await (program.methods as any)
            .settleFunding(new BN(perp.targetRate))
            .accounts({ crank, market, oracle })
            .rpc();
        } catch { /* ignore */ }
      }
      process.stdout.write(".");
    }
  }

  console.log("\n\n✓ Oracle reset complete");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
