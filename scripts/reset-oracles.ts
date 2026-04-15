import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { Fundex } from "../target/types/fundex";

/**
 * Reset RateOracle EMA and sample count for all 4 perp markets.
 * Used once after the twap-denominated rate conversion fix (2026-04-15) to
 * purge historical samples that were computed with the wrong formula.
 */
async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Fundex as anchor.Program<Fundex>;
  const PROGRAM_ID = program.programId;

  const PERPS: [number, string][] = [[0, "BTC"], [1, "ETH"], [2, "SOL"], [3, "JTO"]];

  function marketPda(p: number, d: number): PublicKey {
    const pb = Buffer.alloc(2); pb.writeUInt16LE(p);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("market"), pb, Buffer.from([d])],
      PROGRAM_ID
    )[0];
  }
  function oraclePda(p: number): PublicKey {
    const pb = Buffer.alloc(2); pb.writeUInt16LE(p);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("rate_oracle"), pb],
      PROGRAM_ID
    )[0];
  }

  console.log("=== Before reset ===");
  for (const [p, name] of PERPS) {
    const oracle = await program.account.rateOracle.fetch(oraclePda(p));
    console.log(`${name}: samples=${oracle.numSamples} ema=${oracle.emaFundingRate}`);
  }

  console.log("\n=== Resetting ===");
  for (const [p, name] of PERPS) {
    // Use the 7D market (duration=0) — any market with matching perp_index works
    const market = marketPda(p, 0);
    const oracle = oraclePda(p);
    const sig = await program.methods
      .adminResetOracle()
      .accountsStrict({
        admin: provider.wallet.publicKey,
        market,
        oracle,
      })
      .rpc();
    console.log(`${name}: ${sig}`);
  }

  console.log("\n=== After reset ===");
  for (const [p, name] of PERPS) {
    const oracle = await program.account.rateOracle.fetch(oraclePda(p));
    console.log(`${name}: samples=${oracle.numSamples} ema=${oracle.emaFundingRate}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
