/**
 * Quick diagnostic: prints collateral_mint for every (perp, duration) market.
 * Used to verify on-chain mint vs frontend-baked mint.
 */
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

function marketPda(p: number, d: number): PublicKey {
  const pb = Buffer.alloc(2); pb.writeUInt16LE(p);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), pb, Buffer.from([d])],
    PROGRAM_ID,
  )[0];
}

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const IDL = require("../target/idl/fundex.json");
  const program = new anchor.Program(IDL, { connection: conn } as unknown as anchor.AnchorProvider);
  for (const p of [0, 1, 2, 3]) {
    for (const d of [0, 1, 2, 3]) {
      const mkt = marketPda(p, d);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const acc: any = await (program.account as any).marketState.fetch(mkt);
        console.log(
          `perp=${p} dur=${d}  mint=${acc.collateralMint?.toBase58?.() ?? "?"}  active=${acc.isActive}  oi(p/r)=${acc.fixedPayerLots ?? "?"}/${acc.fixedReceiverLots ?? "?"}`,
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`perp=${p} dur=${d}  NOT_FOUND  (${msg.slice(0, 80)})`);
      }
    }
  }
}
main().catch(console.error);
