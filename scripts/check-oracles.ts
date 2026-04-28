import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection } from "@solana/web3.js";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../app/.env.local") });

// Read program ID from the freshly-generated IDL so this script never
// drifts from `anchor build` / declare_id! / Anchor.toml.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PROGRAM_ID = new PublicKey(require("../target/idl/fundex.json").address);
const rpc = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
const conn = new Connection(rpc, "confirmed");

function oraclePda(p: number): PublicKey {
  const pb = Buffer.alloc(2); pb.writeUInt16LE(p);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("rate_oracle"), pb],
    PROGRAM_ID,
  )[0];
}

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const IDL = require("../target/idl/fundex.json");
  const program = new anchor.Program(IDL, { connection: conn } as unknown as anchor.AnchorProvider);
  for (const p of [0, 1, 2, 3]) {
    const or = oraclePda(p);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const acc: any = await (program.account as any).rateOracle.fetch(or);
      console.log(`perp=${p}  ema=${acc.emaFundingRate?.toString()}  numSamples=${acc.numSamples?.toString()}  lastUpdate=${acc.lastUpdateTs?.toString()}`);
    } catch (e: unknown) {
      console.log(`perp=${p}  NOT_FOUND  ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`);
    }
  }
}
main().catch(console.error);
