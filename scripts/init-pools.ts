/**
 * init-pools.ts
 *
 * Initializes PoolState + pool_vault for all 16 markets (4 perps × 4 durations).
 * Run this once after deploying the new program with Pool instructions.
 *
 * Usage:
 *   cd /Users/andrewsong/fundex
 *   yarn ts-node -P tsconfig.json scripts/init-pools.ts
 *
 * Prerequisites:
 *   - solana config set --url devnet
 *   - solana config set --keypair ~/.config/solana/id.json
 *   - NEXT_PUBLIC_USDC_MINT set (or use default devnet USDC)
 */

import * as anchor from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../app/.env.local") });

// Read program ID from the freshly-generated IDL so this script never
// drifts from `anchor build` / declare_id! / Anchor.toml.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PROGRAM_ID = new PublicKey(require("../target/idl/fundex.json").address);
const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);

const PERPS = [0, 1, 2, 3];
const DURATIONS = [0, 1, 2, 3];

function marketPda(perpIndex: number, duration: number): PublicKey {
  const perpBuf = Buffer.alloc(2);
  perpBuf.writeUInt16LE(perpIndex);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), perpBuf, Buffer.from([duration])],
    PROGRAM_ID
  );
  return pda;
}

function poolPda(market: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), market.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

function poolVaultPda(market: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_vault"), market.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const IDL = require("../target/idl/fundex.json");
  const program = new anchor.Program(IDL, provider);

  console.log("Admin:", provider.wallet.publicKey.toBase58());
  console.log("USDC mint:", USDC_MINT.toBase58());
  console.log();

  let initialized = 0;
  let skipped = 0;
  let failed = 0;

  for (const perpIndex of PERPS) {
    for (const duration of DURATIONS) {
      const market = marketPda(perpIndex, duration);
      const pool = poolPda(market);
      const poolVault = poolVaultPda(market);

      // Check if pool already exists
      const existing = await provider.connection.getAccountInfo(pool);
      if (existing) {
        console.log(`  ✓ Pool already exists: perp=${perpIndex} dur=${duration}`);
        skipped++;
        continue;
      }

      // Check market exists
      const marketInfo = await provider.connection.getAccountInfo(market);
      if (!marketInfo) {
        console.log(`  ⚠ Market not found: perp=${perpIndex} dur=${duration} — skipping`);
        skipped++;
        continue;
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sig = await (program.methods as any)
          .initializePool()
          .accounts({
            admin: provider.wallet.publicKey,
            market,
            pool,
            poolVault,
            collateralMint: USDC_MINT,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .rpc();

        console.log(`  ✅ Pool initialized: perp=${perpIndex} dur=${duration} sig=${sig.slice(0, 12)}…`);
        initialized++;

        // Small delay to avoid rate limiting
        await new Promise((r) => setTimeout(r, 500));
      } catch (e) {
        console.error(`  ❌ Failed: perp=${perpIndex} dur=${duration}:`, e instanceof Error ? e.message : e);
        failed++;
      }
    }
  }

  console.log();
  console.log(`Done: ${initialized} initialized, ${skipped} skipped, ${failed} failed`);
}

main().catch(console.error);
