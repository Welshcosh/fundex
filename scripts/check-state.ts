import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { Fundex } from "../target/types/fundex";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Fundex as anchor.Program<Fundex>;
  const PROGRAM_ID = program.programId;

  function marketPda(p: number, d: number): PublicKey {
    const pb = Buffer.alloc(2); pb.writeUInt16LE(p);
    return PublicKey.findProgramAddressSync([Buffer.from("market"), pb, Buffer.from([d])], PROGRAM_ID)[0];
  }
  function oraclePda(p: number): PublicKey {
    const pb = Buffer.alloc(2); pb.writeUInt16LE(p);
    return PublicKey.findProgramAddressSync([Buffer.from("rate_oracle"), pb], PROGRAM_ID)[0];
  }

  console.log("=== Oracles ===");
  for (const [p, name] of [[0,"BTC"],[1,"ETH"],[2,"SOL"],[3,"JTO"]] as [number,string][]) {
    const oracle = await program.account.rateOracle.fetch(oraclePda(p));
    console.log(`${name}: samples=${oracle.numSamples} emaRate=${oracle.emaFundingRate}`);
  }

  console.log("\n=== Markets ===");
  const names = ["BTC","ETH","SOL","JTO"];
  const durs = ["7D","30D","90D","180D"];
  for (const p of [0,1,2,3]) {
    for (const d of [0,1,2,3]) {
      try {
        const acc = await program.account.marketState.fetch(marketPda(p, d));
        console.log(`${names[p]} ${durs[d]}: fixedRate=${acc.fixedRate} cumActual=${acc.cumulativeActualIndex} cumFixed=${acc.cumulativeFixedIndex} active=${acc.isActive}`);
      } catch {
        console.log(`${names[p]} ${durs[d]}: not found`);
      }
    }
  }
}

main().catch(console.error);
