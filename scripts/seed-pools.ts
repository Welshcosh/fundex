/**
 * seed-pools.ts — Deposit USDC into LP pools for demo liquidity.
 *
 * Usage:
 *   yarn ts-node scripts/seed-pools.ts
 *
 * Seeds the 8 most important markets (BTC + ETH × all 4 durations) with
 * SEED_AMOUNT_USDC each. SOL and JTO get half. Skips pools that already
 * have liquidity.
 */
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../app/.env.local") });

const PROGRAM_ID = new PublicKey("BVyfQfmD6yCXqgqGQm6heYg85WYypqVxLnxb7MrGEKPb");
const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);

// Seed amounts per perp (USDC with 6 decimals)
const SEED: Record<number, number> = {
  0: 500 * 1_000_000,  // BTC: 500 USDC per market
  1: 500 * 1_000_000,  // ETH: 500 USDC per market
  2: 200 * 1_000_000,  // SOL: 200 USDC per market
  3: 200 * 1_000_000,  // JTO: 200 USDC per market
};

const PERP_NAMES = ["BTC", "ETH", "SOL", "JTO"];
const DUR_NAMES  = ["7D", "30D", "90D", "180D"];

function marketPda(p: number, d: number): PublicKey {
  const pb = Buffer.alloc(2); pb.writeUInt16LE(p);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), pb, Buffer.from([d])], PROGRAM_ID
  )[0];
}
function poolPda(market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), market.toBuffer()], PROGRAM_ID
  )[0];
}
function poolVaultPda(market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool_vault"), market.toBuffer()], PROGRAM_ID
  )[0];
}
function lpPositionPda(user: PublicKey, pool: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("lp_position"), user.toBuffer(), pool.toBuffer()], PROGRAM_ID
  )[0];
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const IDL = require("../target/idl/fundex.json");
  const program = new anchor.Program(IDL, provider);
  const admin = provider.wallet.publicKey;

  const userTokenAccount = await getAssociatedTokenAddress(USDC_MINT, admin);

  // Check admin USDC balance
  try {
    const ata = await getAccount(provider.connection, userTokenAccount);
    console.log(`Admin USDC balance: ${Number(ata.amount) / 1_000_000} USDC`);
  } catch {
    console.error("❌ Admin has no USDC token account. Run setup-devnet.ts first.");
    process.exit(1);
  }

  console.log(`Admin: ${admin.toBase58()}`);
  console.log(`USDC:  ${USDC_MINT.toBase58()}\n`);

  let seeded = 0, skipped = 0, failed = 0;

  for (const p of [0, 1, 2, 3]) {
    for (const d of [0, 1, 2, 3]) {
      const market = marketPda(p, d);
      const pool   = poolPda(market);
      const pv     = poolVaultPda(market);
      const lp     = lpPositionPda(admin, pool);
      const amount = SEED[p];
      const label  = `${PERP_NAMES[p]} ${DUR_NAMES[d]}`;

      // Skip if pool doesn't exist
      const poolInfo = await provider.connection.getAccountInfo(pool);
      if (!poolInfo) {
        console.log(`  ~ ${label}: pool not initialized, skipping`);
        skipped++;
        continue;
      }

      // Skip if already has liquidity
      try {
        const vault = await getAccount(provider.connection, pv);
        if (Number(vault.amount) > 0) {
          console.log(`  ✓ ${label}: already seeded (${Number(vault.amount) / 1_000_000} USDC)`);
          skipped++;
          continue;
        }
      } catch { /* vault might not exist yet */ }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (program.methods as any)
          .depositLp(new anchor.BN(amount))
          .accounts({
            user: admin,
            market,
            pool,
            lpPosition: lp,
            poolVault: pv,
            userTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        console.log(`  ✅ ${label}: deposited ${amount / 1_000_000} USDC`);
        seeded++;
        await new Promise(r => setTimeout(r, 600));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ❌ ${label}: ${msg.slice(0, 100)}`);
        failed++;
      }
    }
  }

  console.log(`\nDone: ${seeded} seeded, ${skipped} skipped, ${failed} failed`);
}

main().catch(console.error);
