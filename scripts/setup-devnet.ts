/**
 * setup-devnet.ts
 *
 * One-shot devnet bootstrap:
 *   1. Creates a fresh USDC mock mint (6 decimals)
 *   2. Initializes RateOracle for each perp (BTC/ETH/SOL/JTO)
 *   3. Seeds each oracle with MIN_ORACLE_SAMPLES mock settlements
 *   4. Initializes all 16 markets (4 perps × 4 durations) using oracle EMA
 *   5. Prints .env.local content to copy into the app
 *
 * Usage:
 *   cd /Users/andrewsong/fundex
 *   yarn ts-node -P tsconfig.json scripts/setup-devnet.ts
 *
 * Prerequisites:
 *   - solana config set --url devnet
 *   - solana config set --keypair ~/.config/solana/id.json
 *   - wallet has ≥1 SOL on devnet (airdrop: solana airdrop 2)
 *   - program already deployed: anchor deploy --provider.cluster devnet
 */

import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Fundex } from "../target/types/fundex";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";

// ─── Config ──────────────────────────────────────────────────────────────────

// Fundex rate precision: 1e6 = 100% per hour. APR = (rate/10_000) × 8760.
// These mockRate values target realistic long-term Binance perp funding medians:
//   BTC 0.010%/8h → 12/1h (10.5% APR)
//   ETH 0.008%/8h → 10/1h (8.8% APR)
//   SOL 0.015%/8h → 19/1h (16.6% APR)
//   JTO 0.025%/8h → 31/1h (27.2% APR — thin-altcoin premium)
const PERPS = [
  { index: 0, name: "BTC-PERP", mockRate: 12 },
  { index: 1, name: "ETH-PERP", mockRate: 10 },
  { index: 2, name: "SOL-PERP", mockRate: 19 },
  { index: 3, name: "JTO-PERP", mockRate: 31 },
];

const DURATIONS = [0, 1, 2, 3]; // Days7, Days30, Days90, Days180
// Only seed 1 sample during setup — crank will accumulate the remaining 23
// (MIN_ORACLE_SAMPLES=24 on-chain; positions won't open until 24 samples exist)
const SEED_SAMPLES = 1;

// ─── PDA helpers ─────────────────────────────────────────────────────────────

function oraclePda(perpIndex: number, programId: PublicKey): [PublicKey, number] {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(perpIndex);
  return PublicKey.findProgramAddressSync([Buffer.from("rate_oracle"), buf], programId);
}

function marketPda(perpIndex: number, duration: number, programId: PublicKey): [PublicKey, number] {
  const perpBuf = Buffer.alloc(2);
  perpBuf.writeUInt16LE(perpIndex);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), perpBuf, Buffer.from([duration])],
    programId
  );
}

function vaultPda(market: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer()], programId);
}

const DRIFT_PROGRAM_ID = new PublicKey("dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH");
const DRIFT_MARKET_INDEX: Record<number, number> = { 0: 1, 1: 2, 2: 0, 3: 20 };

function driftPerpMarketPda(driftMarketIndex: number): PublicKey {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(driftMarketIndex);
  return PublicKey.findProgramAddressSync([Buffer.from("perp_market"), buf], DRIFT_PROGRAM_ID)[0];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function confirm(sig: string, connection: anchor.web3.Connection) {
  await connection.confirmTransaction(sig, "confirmed");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Fundex as anchor.Program<Fundex>;
  const admin = provider.wallet as anchor.Wallet;
  const conn = provider.connection;

  console.log("=".repeat(60));
  console.log("Fundex devnet setup");
  console.log("=".repeat(60));
  console.log(`Admin:   ${admin.publicKey.toBase58()}`);
  console.log(`Program: ${program.programId.toBase58()}`);
  console.log(`Cluster: ${(conn as any)._rpcEndpoint ?? "devnet"}`);
  console.log();

  // ── Step 1: USDC mock mint ─────────────────────────────────────────────────
  console.log("Step 1: Creating USDC mock mint…");
  const usdcMint = await createMint(conn, admin.payer, admin.publicKey, null, 6);
  console.log(`  ✓ USDC mint: ${usdcMint.toBase58()}`);

  // Create admin ATA and mint 100,000 USDC for testing
  const adminAta = await createAssociatedTokenAccount(conn, admin.payer, usdcMint, admin.publicKey);
  await mintTo(conn, admin.payer, usdcMint, adminAta, admin.publicKey, 100_000_000_000); // 100k USDC
  console.log(`  ✓ Admin ATA: ${adminAta.toBase58()} (100,000 USDC minted)`);
  console.log();

  // ── Step 2: Initialize oracles ─────────────────────────────────────────────
  console.log("Step 2: Initializing oracles…");
  for (const perp of PERPS) {
    const [oracle] = oraclePda(perp.index, program.programId);
    try {
      const sig = await (program.methods as any)
        .initializeRateOracle(perp.index)
        .accounts({ admin: admin.publicKey, oracle, systemProgram: SystemProgram.programId })
        .rpc();
      await confirm(sig, conn);
      console.log(`  ✓ ${perp.name} oracle: ${oracle.toBase58()}`);
    } catch (e: any) {
      if (e.message?.includes("already in use") || e.message?.includes("custom program error: 0x0")) {
        console.log(`  ~ ${perp.name} oracle already exists, skipping`);
      } else {
        throw e;
      }
    }
  }
  console.log();

  // ── Step 3: Seed oracles with mock settlements ─────────────────────────────
  console.log(`Step 3: Seeding oracles (${SEED_SAMPLES} initial sample each — crank will add remaining 23)…`);

  // We need to initialize at least one market per oracle to call settle_funding.
  // Use a temporary market (duration=0, 7 days) with a manual fixed_rate override.
  for (const perp of PERPS) {
    const [oracle] = oraclePda(perp.index, program.programId);
    const [market] = marketPda(perp.index, 0, program.programId);
    const [vault] = vaultPda(market, program.programId);

    // Initialize seed market (7D, fixed_rate override = mockRate)
    try {
      const sig = await (program.methods as any)
        .initializeMarket(perp.index, 0, new BN(perp.mockRate))
        .accounts({
          admin: admin.publicKey,
          oracle,
          market,
          vault,
          collateralMint: usdcMint,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      await confirm(sig, conn);
    } catch (e: any) {
      if (!e.message?.includes("already in use") && !e.message?.includes("custom program error: 0x0")) {
        console.log(`  ~ ${perp.name} seed market may already exist: ${e.message?.slice(0, 60)}`);
      }
    }

    // One initial settlement to bootstrap the oracle EMA.
    // Remaining samples come from the crank running hourly.
    try {
      const driftPerpMarket = driftPerpMarketPda(DRIFT_MARKET_INDEX[perp.index]);
      const sig = await (program.methods as any)
        .settleFunding()
        .accounts({ crank: admin.publicKey, market, oracle, driftPerpMarket })
        .rpc();
      await confirm(sig, conn);
    } catch (e: any) {
      if (e.message?.includes("TooEarlyToSettle") || e.message?.includes("6006")) {
        console.log(`  ~ ${perp.name}: already settled recently, skipping seed`);
      } else {
        throw e;
      }
    }

    const oracleAcc = await program.account.rateOracle.fetch(oracle);
    console.log(
      `  ✓ ${perp.name}: ${oracleAcc.numSamples.toNumber()} samples, ` +
      `EMA = ${oracleAcc.emaFundingRate.toNumber()}`
    );
  }
  console.log();

  // ── Step 4: Initialize all 16 markets (oracle EMA auto-sets fixed_rate) ────
  console.log("Step 4: Initializing all markets (4 perps × 4 durations)…");
  const durationLabels = ["7D", "30D", "90D", "180D"];

  for (const perp of PERPS) {
    const [oracle] = oraclePda(perp.index, program.programId);
    for (const dur of DURATIONS) {
      // dur=0 (7D) was already created as seed market, skip
      if (dur === 0) {
        console.log(`  ~ ${perp.name} ${durationLabels[dur]}: already initialized (seed market)`);
        continue;
      }
      const [market] = marketPda(perp.index, dur, program.programId);
      const [vault] = vaultPda(market, program.programId);

      try {
        const sig = await (program.methods as any)
          .initializeMarket(perp.index, dur, new BN(perp.mockRate)) // use mockRate until oracle warms up
          .accounts({
            admin: admin.publicKey,
            oracle,
            market,
            vault,
            collateralMint: usdcMint,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .rpc();
        await confirm(sig, conn);
        const mktAcc = await program.account.marketState.fetch(market);
        console.log(
          `  ✓ ${perp.name} ${durationLabels[dur]}: fixedRate = ${mktAcc.fixedRate.toNumber()}`
        );
      } catch (e: any) {
        if (e.message?.includes("already in use") || e.message?.includes("custom program error: 0x0")) {
          console.log(`  ~ ${perp.name} ${durationLabels[dur]}: already exists, skipping`);
        } else {
          console.error(`  ✗ ${perp.name} ${durationLabels[dur]}: ${e.message?.slice(0, 80)}`);
        }
      }
    }
  }
  console.log();

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log("=".repeat(60));
  console.log("Setup complete! Add this to app/.env.local:");
  console.log("=".repeat(60));
  console.log(`NEXT_PUBLIC_USDC_MINT=${usdcMint.toBase58()}`);
  console.log("=".repeat(60));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
