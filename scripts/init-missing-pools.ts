/**
 * Initialize pool + pool_vault for every market whose pool doesn't exist yet.
 * Uses each market's on-chain collateral_mint (not env). Idempotent: skips
 * markets that already have a pool.
 *
 * Usage: yarn ts-node -P tsconfig.json scripts/init-missing-pools.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../app/.env.local") });

// Read program ID from the freshly-generated IDL so this script never
// drifts from `anchor build` / declare_id! / Anchor.toml.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PROGRAM_ID = new PublicKey(require("../target/idl/fundex.json").address);
const NAMES = ["BTC", "ETH", "SOL", "JTO"];
const DUR_LABELS = ["7D", "30D", "90D", "180D"];

function marketPda(p: number, d: number): PublicKey {
  const pb = Buffer.alloc(2); pb.writeUInt16LE(p);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), pb, Buffer.from([d])],
    PROGRAM_ID,
  )[0];
}
function poolPda(market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), market.toBuffer()],
    PROGRAM_ID,
  )[0];
}
function poolVaultPda(market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool_vault"), market.toBuffer()],
    PROGRAM_ID,
  )[0];
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const IDL = require("../target/idl/fundex.json");
  const program = new anchor.Program(IDL, provider);
  const admin = provider.wallet.publicKey;
  console.log("Admin:", admin.toBase58());

  for (const p of [0, 1, 2, 3]) {
    for (const d of [0, 1, 2, 3]) {
      const market = marketPda(p, d);
      const pool = poolPda(market);
      const poolVault = poolVaultPda(market);
      const label = `${NAMES[p]} ${DUR_LABELS[d]}`;

      // Skip if already exists.
      const existing = await provider.connection.getAccountInfo(pool);
      if (existing) {
        console.log(`  ~ ${label}: pool already exists, skipping`);
        continue;
      }

      // Read market's real collateral mint
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let mkt: any;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mkt = await (program.account as any).marketState.fetch(market);
      } catch {
        console.log(`  ~ ${label}: market not initialized, skipping`);
        continue;
      }
      const collateralMint = mkt.collateralMint as PublicKey;

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (program.methods as any).initializePool()
          .accounts({
            admin,
            market,
            pool,
            poolVault,
            collateralMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .rpc();
        console.log(`  ✅ ${label}: pool initialized (mint=${collateralMint.toBase58().slice(0, 8)}…)`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`  ❌ ${label}: ${msg.slice(0, 120)}`);
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}

main().catch(console.error);
