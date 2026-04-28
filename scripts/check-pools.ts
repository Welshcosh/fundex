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
const USER = new PublicKey("BXrMyY4bQdqrFvHADfHYSEoAScBo3dKQifHMEE13G7Q5");

function marketPda(p: number, d: number): PublicKey {
  const pb = Buffer.alloc(2); pb.writeUInt16LE(p);
  return PublicKey.findProgramAddressSync([Buffer.from("market"), pb, Buffer.from([d])], PROGRAM_ID)[0];
}
function poolPda(market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("pool"), market.toBuffer()], PROGRAM_ID)[0];
}
function poolVaultPda(market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("pool_vault"), market.toBuffer()], PROGRAM_ID)[0];
}
function positionPda(user: PublicKey, market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("position"), user.toBuffer(), market.toBuffer()], PROGRAM_ID)[0];
}

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const IDL = require("../target/idl/fundex.json");
  const program = new anchor.Program(IDL, { connection: conn } as unknown as anchor.AnchorProvider);

  console.log(`\n=== Pool init status (for every market) ===`);
  console.log(`${"perp".padEnd(5)}${"dur".padEnd(5)}${"pool".padEnd(10)}${"pool_vault"}`);
  for (const p of [0, 1, 2, 3]) {
    for (const d of [0, 1, 2, 3]) {
      const mkt = marketPda(p, d);
      const pool = poolPda(mkt);
      const pv = poolVaultPda(mkt);
      const [poolInfo, pvInfo] = await Promise.all([conn.getAccountInfo(pool), conn.getAccountInfo(pv)]);
      console.log(`${String(p).padEnd(5)}${String(d).padEnd(5)}${(poolInfo ? "✅" : "❌").padEnd(10)}${pvInfo ? "✅" : "❌"}`);
    }
  }

  console.log(`\n=== User ${USER.toBase58().slice(0,8)}… positions ===`);
  for (const p of [0, 1, 2, 3]) {
    for (const d of [0, 1, 2, 3]) {
      const mkt = marketPda(p, d);
      const pos = positionPda(USER, mkt);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const acc: any = await (program.account as any).position.fetch(pos);
        console.log(`perp=${p} dur=${d}  lots=${acc.lots?.toString()}  side=${acc.side}  coll=${acc.collateralDeposited?.toString()}`);
      } catch {
        // No position
      }
    }
  }
}
main().catch(console.error);
