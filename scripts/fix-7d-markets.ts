/**
 * fix-7d-markets.ts
 *
 * Closes the 4 x 7D markets (duration=0) that were initialized with the old
 * USDC mint, then re-initializes them with the correct mint.
 *
 * Usage:
 *   yarn fix:7d
 */
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../app/.env.local") });

// Read program ID from the freshly-generated IDL so this script never
// drifts from `anchor build` / declare_id! / Anchor.toml.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PROGRAM_ID = new PublicKey(require("../target/idl/fundex.json").address);
const USDC_MINT  = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT ?? "H9Uy5y7DzqSqVkHVz3KJsT7RsGX4HkneXkToG3WBNYqR"
);
const NAMES = ["BTC", "ETH", "SOL", "JTO"];

// Drift market index mapping (same as crank-devnet.ts)
const DRIFT_MARKET_INDEX: Record<number, number> = { 0: 1, 1: 2, 2: 0, 3: 20 };

// Mock fixed rates for re-initialization (per-perp, in Drift precision)
const MOCK_RATES: Record<number, number> = {
  0: 500000,   // BTC  ~0.05%
  1: -180000,  // ETH  ~-0.018%
  2: 20000,    // SOL  ~0.002%
  3: 200,      // JTO
};

function marketPda(p: number, d: number): PublicKey {
  const pb = Buffer.alloc(2); pb.writeUInt16LE(p);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), pb, Buffer.from([d])], PROGRAM_ID
  )[0];
}
function vaultPda(market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), market.toBuffer()], PROGRAM_ID
  )[0];
}
function oraclePda(p: number): PublicKey {
  const pb = Buffer.alloc(2); pb.writeUInt16LE(p);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("rate_oracle"), pb], PROGRAM_ID
  )[0];
}
function driftPerpMarketPda(driftIndex: number): PublicKey {
  const DRIFT_PROGRAM_ID = new PublicKey("dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH");
  const buf = Buffer.alloc(2); buf.writeUInt16LE(driftIndex);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("perp_market"), buf], DRIFT_PROGRAM_ID
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
  console.log("New USDC mint:", USDC_MINT.toBase58());
  console.log();

  const DURATION = 0; // 7D only

  // ── Step 1: Close 7D pools first (if they exist) ──────────────────────────
  console.log("=== Step 1: Close 7D pools ===");
  for (const p of [0, 1, 2, 3]) {
    const market = marketPda(p, DURATION);
    const [pool] = PublicKey.findProgramAddressSync([Buffer.from("pool"), market.toBuffer()], PROGRAM_ID);
    const [poolVault] = PublicKey.findProgramAddressSync([Buffer.from("pool_vault"), market.toBuffer()], PROGRAM_ID);

    const poolInfo = await provider.connection.getAccountInfo(pool);
    if (!poolInfo) { console.log(`  ~ ${NAMES[p]} 7D: no pool, skipping`); continue; }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any).closePool()
        .accounts({ admin, market, pool, poolVault, tokenProgram: TOKEN_PROGRAM_ID })
        .rpc();
      console.log(`  ✅ Closed pool ${NAMES[p]} 7D`);
    } catch (e: unknown) {
      console.error(`  ❌ Close pool ${NAMES[p]} 7D: ${e instanceof Error ? e.message.slice(0, 80) : e}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // ── Step 2: Close 7D markets ──────────────────────────────────────────────
  console.log("\n=== Step 2: Close 7D markets ===");
  for (const p of [0, 1, 2, 3]) {
    const market = marketPda(p, DURATION);
    const vault  = vaultPda(market);

    const mktInfo = await provider.connection.getAccountInfo(market);
    if (!mktInfo) { console.log(`  ~ ${NAMES[p]} 7D: no market, skipping`); continue; }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any).closeMarket()
        .accounts({ admin, market, vault, tokenProgram: TOKEN_PROGRAM_ID })
        .rpc();
      console.log(`  ✅ Closed market ${NAMES[p]} 7D`);
    } catch (e: unknown) {
      console.error(`  ❌ Close market ${NAMES[p]} 7D: ${e instanceof Error ? e.message.slice(0, 80) : e}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // ── Step 3: Re-initialize 7D markets with correct mint ────────────────────
  console.log("\n=== Step 3: Re-initialize 7D markets ===");
  for (const p of [0, 1, 2, 3]) {
    const market = marketPda(p, DURATION);
    const vault  = vaultPda(market);
    const oracle = oraclePda(p);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any)
        // 4th arg = skew_k_override (null → DEFAULT_SKEW_K = 50_000)
        .initializeMarket(p, DURATION, new anchor.BN(MOCK_RATES[p]), null)
        .accounts({
          admin,
          oracle,
          market,
          vault,
          collateralMint: USDC_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      console.log(`  ✅ Re-initialized ${NAMES[p]} 7D`);
    } catch (e: unknown) {
      console.error(`  ❌ Init ${NAMES[p]} 7D: ${e instanceof Error ? e.message.slice(0, 80) : e}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // ── Step 4: Settle once to warm up ────────────────────────────────────────
  console.log("\n=== Step 4: Initial settlement ===");
  for (const p of [0, 1, 2, 3]) {
    const market  = marketPda(p, DURATION);
    const oracle  = oraclePda(p);
    const driftIdx = DRIFT_MARKET_INDEX[p];
    const driftPerpMarket = driftPerpMarketPda(driftIdx);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any).settleFunding()
        .accounts({ market, oracle, driftPerpMarket })
        .rpc();
      console.log(`  ✅ Settled ${NAMES[p]} 7D`);
    } catch (e: unknown) {
      // TooEarlyToSettle is fine — crank will handle it
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  ~ ${NAMES[p]} 7D: ${msg.includes("TooEarly") ? "TooEarlyToSettle (ok, crank will settle)" : msg.slice(0, 80)}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // ── Step 5: Re-initialize 7D pools ────────────────────────────────────────
  console.log("\n=== Step 5: Re-initialize 7D pools ===");
  for (const p of [0, 1, 2, 3]) {
    const market = marketPda(p, DURATION);
    const [pool]      = PublicKey.findProgramAddressSync([Buffer.from("pool"), market.toBuffer()], PROGRAM_ID);
    const [poolVault] = PublicKey.findProgramAddressSync([Buffer.from("pool_vault"), market.toBuffer()], PROGRAM_ID);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (program.methods as any).initializePool()
        .accounts({
          admin,
          market,
          pool,
          poolVault,
          collateralMint: USDC_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      console.log(`  ✅ Pool initialized ${NAMES[p]} 7D`);
    } catch (e: unknown) {
      console.error(`  ❌ Pool ${NAMES[p]} 7D: ${e instanceof Error ? e.message.slice(0, 80) : e}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  console.log("\n✅ Done. Now run: yarn seed:pools");
}

main().catch(console.error);
