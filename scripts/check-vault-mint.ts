import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../app/.env.local") });

// Read program ID from the freshly-generated IDL so this script never
// drifts from `anchor build` / declare_id! / Anchor.toml.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PROGRAM_ID = new PublicKey(require("../target/idl/fundex.json").address);
const NAMES = ["BTC", "ETH", "SOL", "JTO"];
const DURS  = ["7D", "30D", "90D", "180D"];

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const IDL = require("../target/idl/fundex.json");
  const program = new anchor.Program(IDL, provider);

  for (const p of [0, 1, 2, 3]) {
    for (const d of [0, 1, 2, 3]) {
      const pb = Buffer.alloc(2); pb.writeUInt16LE(p);
      const [mkt] = PublicKey.findProgramAddressSync([Buffer.from("market"), pb, Buffer.from([d])], PROGRAM_ID);
      const [pv]  = PublicKey.findProgramAddressSync([Buffer.from("pool_vault"), mkt.toBuffer()], PROGRAM_ID);

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mktAcc = await (program.account as any).marketState.fetch(mkt);
        const vault  = await getAccount(provider.connection, pv);
        const match  = vault.mint.toBase58() === mktAcc.collateralMint.toBase58();
        console.log(
          `${NAMES[p]} ${DURS[d]}: vault_mint=${vault.mint.toBase58().slice(0, 8)}… market_mint=${mktAcc.collateralMint.toBase58().slice(0, 8)}… ${match ? "✓" : "❌ MISMATCH"}`
        );
      } catch (e) {
        console.log(`${NAMES[p]} ${DURS[d]}: error - ${e instanceof Error ? e.message.slice(0, 60) : e}`);
      }
    }
  }
}

main().catch(console.error);
