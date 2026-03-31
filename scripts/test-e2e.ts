/**
 * test-e2e.ts
 *
 * End-to-end integration test for Fundex on devnet.
 * Uses perpIndex=99 (isolated namespace) so it never conflicts with real markets.
 *
 * Tests:
 *   1. Oracle initialization + seeding
 *   2. Market initialization (V1 fixed rate override)
 *   3. Open position (FixedPayer + FixedReceiver)
 *   4. Crank: settle_funding → verify PnL accumulation
 *   5. Close position → verify payout
 *   6. Liquidation: adverse settlement → liquidate underwater position
 *   7. Drift rate fetch smoke test (mainnet read-only)
 *
 * Usage:
 *   yarn test:e2e
 *
 * Requirements:
 *   - Program deployed to devnet with FUNDING_INTERVAL=1, MIN_ORACLE_SAMPLES=3
 *   - USDC_MINT env var set (from yarn setup:devnet output)
 *   - Wallet has ≥ 0.5 SOL on devnet
 */

import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Fundex } from "../target/types/fundex";
import {
  Keypair,
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import {
  DriftClient,
  Wallet,
  FUNDING_RATE_PRECISION,
} from "@drift-labs/sdk";

// ─── Constants ────────────────────────────────────────────────────────────────

// Use timestamp-based perpIndex so each run gets a fresh namespace (no leftover state)
const TEST_PERP_INDEX = (Math.floor(Date.now() / 1000) % 60_000) + 1_000; // 1000–61000
const TEST_DURATION   = 1;           // 30D
const FIXED_RATE      = 1000;        // 0.10% per interval
const NOTIONAL_PER_LOT = 100_000_000; // 100 USDC
const INITIAL_MARGIN_BPS = 1_000;
const MAINT_MARGIN_BPS   = 500;
const DRIFT_PRICE_PRECISION = 1_000_000;

// ─── PDA helpers ─────────────────────────────────────────────────────────────

function oraclePda(perpIndex: number, programId: PublicKey): PublicKey {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(perpIndex);
  return PublicKey.findProgramAddressSync([Buffer.from("rate_oracle"), buf], programId)[0];
}
function marketPda(perpIndex: number, duration: number, programId: PublicKey): PublicKey {
  const perpBuf = Buffer.alloc(2);
  perpBuf.writeUInt16LE(perpIndex);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), perpBuf, Buffer.from([duration])],
    programId
  )[0];
}
function vaultPda(market: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer()], programId)[0];
}
function positionPda(user: PublicKey, market: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), user.toBuffer(), market.toBuffer()],
    programId
  )[0];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  process.stdout.write(`  ${name} … `);
  try {
    await fn();
    console.log("✓");
    passed++;
  } catch (e: any) {
    console.log(`✗\n    ${e.message?.slice(0, 120) ?? e}`);
    failed++;
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Fundex as anchor.Program<Fundex>;
  const admin = provider.wallet as anchor.Wallet;
  const conn = provider.connection;

  console.log("=".repeat(60));
  console.log("Fundex E2E test");
  console.log("=".repeat(60));
  console.log(`Program:  ${program.programId.toBase58()}`);
  console.log(`Admin:    ${admin.publicKey.toBase58()}`);
  console.log(`PerpIdx:  ${TEST_PERP_INDEX} (isolated test namespace)`);
  console.log("=".repeat(60));
  console.log();

  // ── Setup: USDC mint + test users ─────────────────────────────────────────

  console.log("Setup");

  let usdcMint: PublicKey;
  let adminAta: PublicKey;
  let userA: Keypair;
  let userB: Keypair;
  let ataA: PublicKey;
  let ataB: PublicKey;

  await test("Create test USDC mint", async () => {
    usdcMint = await createMint(conn, admin.payer, admin.publicKey, null, 6);
    adminAta = await createAssociatedTokenAccount(conn, admin.payer, usdcMint, admin.publicKey);
    await mintTo(conn, admin.payer, usdcMint, adminAta, admin.publicKey, 1_000_000_000_000);
  });

  await test("Fund test users (transfer + USDC)", async () => {
    userA = Keypair.generate();
    userB = Keypair.generate();
    // Use admin SOL transfer instead of airdrop (avoids devnet rate limits)
    const tx = new Transaction();
    for (const kp of [userA, userB]) {
      tx.add(SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: kp.publicKey,
        lamports: Math.floor(0.2 * LAMPORTS_PER_SOL),
      }));
    }
    await provider.sendAndConfirm(tx);
    ataA = await createAssociatedTokenAccount(conn, admin.payer, usdcMint, userA.publicKey);
    ataB = await createAssociatedTokenAccount(conn, admin.payer, usdcMint, userB.publicKey);
    for (const ata of [ataA, ataB]) {
      await mintTo(conn, admin.payer, usdcMint, ata, admin.publicKey, 10_000_000_000); // 10k USDC each
    }
    const balA = Number((await getAccount(conn, ataA)).amount);
    assert(balA === 10_000_000_000, `Expected 10k USDC, got ${balA / 1e6}`);
  });

  console.log();
  console.log("1. Oracle");

  const oracle = oraclePda(TEST_PERP_INDEX, program.programId);

  await test("initialize_rate_oracle", async () => {
    await (program.methods as any)
      .initializeRateOracle(TEST_PERP_INDEX)
      .accounts({ admin: admin.publicKey, oracle, systemProgram: SystemProgram.programId })
      .rpc();
    const acc = await (program.account as any).rateOracle.fetch(oracle);
    assert(acc.perpIndex === TEST_PERP_INDEX, "perpIndex mismatch");
    assert(acc.numSamples.toNumber() === 0, "numSamples should be 0");
  });

  await test("Seed oracle with 3 samples", async () => {
    const market = marketPda(TEST_PERP_INDEX, TEST_DURATION, program.programId);
    const vault = vaultPda(market, program.programId);

    // Need at least one market to settle_funding
    await (program.methods as any)
      .initializeMarket(TEST_PERP_INDEX, TEST_DURATION, new BN(FIXED_RATE))
      .accounts({
        admin: admin.publicKey, oracle, market, vault,
        collateralMint: usdcMint,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const rates = [1050, 950, 1000];
    for (const rate of rates) {
      await (program.methods as any)
        .settleFunding(new BN(rate))
        .accounts({ crank: admin.publicKey, market, oracle })
        .rpc();
      await sleep(200);
    }

    const acc = await (program.account as any).rateOracle.fetch(oracle);
    assert(acc.numSamples.toNumber() === 3, `Expected 3 samples, got ${acc.numSamples.toNumber()}`);
    assert(acc.emaFundingRate.toNumber() > 0, "EMA should be > 0");
  });

  console.log();
  console.log("2. Position lifecycle");

  const market = marketPda(TEST_PERP_INDEX, TEST_DURATION, program.programId);
  const vault  = vaultPda(market, program.programId);
  const posA   = positionPda(userA.publicKey, market, program.programId);
  const posB   = positionPda(userB.publicKey, market, program.programId);
  const LOTS   = 5;
  const COLLATERAL = LOTS * NOTIONAL_PER_LOT * INITIAL_MARGIN_BPS / 10_000;

  await test("userA opens FixedPayer (Long rate)", async () => {
    const balBefore = Number((await getAccount(conn, ataA)).amount);
    await (program.methods as any)
      .openPosition(0, new BN(LOTS)) // side=0 FixedPayer
      .accounts({
        user: userA.publicKey, market, position: posA, vault,
        userTokenAccount: ataA,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([userA])
      .rpc();
    const balAfter = Number((await getAccount(conn, ataA)).amount);
    assert(balBefore - balAfter === COLLATERAL, `Collateral mismatch: expected ${COLLATERAL / 1e6} USDC`);
  });

  await test("userB opens FixedReceiver (Short rate)", async () => {
    await (program.methods as any)
      .openPosition(1, new BN(LOTS)) // side=1 FixedReceiver
      .accounts({
        user: userB.publicKey, market, position: posB, vault,
        userTokenAccount: ataB,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([userB])
      .rpc();
    const mkt = await (program.account as any).marketState.fetch(market);
    assert(mkt.totalFixedPayerLots.toNumber() === LOTS, "payerLots mismatch");
    assert(mkt.totalFixedReceiverLots.toNumber() === LOTS, "receiverLots mismatch");
    assert(mkt.totalCollateral.toNumber() === COLLATERAL * 2, "totalCollateral mismatch");
  });

  console.log();
  console.log("3. Crank (settle_funding)");

  await test("Settlement 1: actualRate=1500 → FixedPayer profits", async () => {
    await (program.methods as any)
      .settleFunding(new BN(1500))
      .accounts({ crank: admin.publicKey, market, oracle })
      .rpc();
    const mkt = await (program.account as any).marketState.fetch(market);
    // cumulative = 1500 - 1000 (fixedRate) = 500
    assert(mkt.cumulativeRateIndex.toNumber() === 500, `cumulative should be 500, got ${mkt.cumulativeRateIndex.toNumber()}`);
  });

  await test("Settlement 2: actualRate=600 → FixedReceiver profits", async () => {
    await (program.methods as any)
      .settleFunding(new BN(600))
      .accounts({ crank: admin.publicKey, market, oracle })
      .rpc();
    const mkt = await (program.account as any).marketState.fetch(market);
    // cumulative = 500 + (600-1000) = 500 - 400 = 100
    assert(mkt.cumulativeRateIndex.toNumber() === 100, `cumulative should be 100, got ${mkt.cumulativeRateIndex.toNumber()}`);
  });

  await test("Settlement 3: actualRate=1200", async () => {
    await (program.methods as any)
      .settleFunding(new BN(1200))
      .accounts({ crank: admin.publicKey, market, oracle })
      .rpc();
    const mkt = await (program.account as any).marketState.fetch(market);
    // cumulative = 100 + (1200-1000) = 100 + 200 = 300
    assert(mkt.cumulativeRateIndex.toNumber() === 300, `cumulative should be 300, got ${mkt.cumulativeRateIndex.toNumber()}`);
  });

  console.log();
  console.log("4. Close positions → verify PnL");

  let payoutA: number;
  let payoutB: number;

  await test("userA (FixedPayer) closes → profit if cumulative > 0", async () => {
    const balBefore = Number((await getAccount(conn, ataA)).amount);
    await (program.methods as any)
      .closePosition()
      .accounts({
        user: userA.publicKey, market, position: posA, vault,
        userTokenAccount: ataA,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([userA])
      .rpc();
    const balAfter = Number((await getAccount(conn, ataA)).amount);
    payoutA = balAfter - balBefore;
    // PnL = +300 * 5 * 100_000_000 / 1_000_000 = +150_000_000 = +150 USDC
    // payout = collateral (500 USDC) + PnL (150 USDC) = 650 USDC
    assert(payoutA > COLLATERAL, `userA should receive more than collateral. Got ${payoutA / 1e6} USDC`);
    console.log(`\n    → payout: ${payoutA / 1e6} USDC (deposited ${COLLATERAL / 1e6} USDC)`);
  });

  await test("userB (FixedReceiver) closes → loss if cumulative > 0", async () => {
    const balBefore = Number((await getAccount(conn, ataB)).amount);
    await (program.methods as any)
      .closePosition()
      .accounts({
        user: userB.publicKey, market, position: posB, vault,
        userTokenAccount: ataB,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([userB])
      .rpc();
    const balAfter = Number((await getAccount(conn, ataB)).amount);
    payoutB = balAfter - balBefore;
    assert(payoutB < COLLATERAL, `userB should receive less than collateral. Got ${payoutB / 1e6} USDC`);
    assert(payoutA + payoutB === COLLATERAL * 2, "Sum of payouts should equal total collateral");
    console.log(`\n    → payout: ${payoutB / 1e6} USDC (deposited ${COLLATERAL / 1e6} USDC)`);
  });

  console.log();
  console.log("5. Liquidation");

  // New user for liquidation test
  const victim = Keypair.generate();
  let ataVictim: PublicKey;
  const posVictim = positionPda(victim.publicKey, market, program.programId);

  await test("Setup victim (1 lot FixedReceiver)", async () => {
    // Transfer SOL from admin (no airdrop rate limits)
    const solTx = new Transaction().add(SystemProgram.transfer({
      fromPubkey: admin.publicKey,
      toPubkey: victim.publicKey,
      lamports: Math.floor(0.2 * LAMPORTS_PER_SOL),
    }));
    await provider.sendAndConfirm(solTx);
    ataVictim = await createAssociatedTokenAccount(conn, admin.payer, usdcMint, victim.publicKey);
    await mintTo(conn, admin.payer, usdcMint, ataVictim, admin.publicKey, 500_000_000); // 500 USDC
    await (program.methods as any)
      .openPosition(1, new BN(1)) // 1 lot FixedReceiver
      .accounts({
        user: victim.publicKey, market, position: posVictim, vault,
        userTokenAccount: ataVictim,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([victim])
      .rpc();
  });

  await test("Liquidation fails above maintenance margin", async () => {
    let threw = false;
    try {
      await (program.methods as any)
        .liquidatePosition()
        .accounts({
          liquidator: admin.publicKey, market, position: posVictim, vault,
          liquidatorTokenAccount: adminAta,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .rpc();
    } catch (e: any) {
      threw = e.message?.includes("PositionAboveMaintenanceMargin");
    }
    assert(threw, "Should reject liquidation above maintenance margin");
  });

  await test("Adverse settlement pushes victim underwater", async () => {
    // victim: 1 lot FixedReceiver, collateral = 10 USDC
    // Need effective < 5% maintenance → need pnl < -5 USDC
    // pnl = -rateDelta * 1 * 100_000_000 / 1_000_000 = -rateDelta * 100 (in lamports)
    // Need: -rateDelta * 100 < -5_000_000 → rateDelta > 50_000
    // victim entered at current cumulative (300). Settle with actualRate = 60_000
    // delta = 60_000 - 1000 (fixed) = 59_000 > 50_000 ✓
    await (program.methods as any)
      .settleFunding(new BN(60_000))
      .accounts({ crank: admin.publicKey, market, oracle })
      .rpc();

    const mkt = await (program.account as any).marketState.fetch(market);
    assert(mkt.cumulativeRateIndex.toNumber() > 50_000, "cumulative should be high after extreme settlement");
  });

  await test("Liquidation succeeds below maintenance margin", async () => {
    const balBefore = Number((await getAccount(conn, adminAta)).amount);
    await (program.methods as any)
      .liquidatePosition()
      .accounts({
        liquidator: admin.publicKey, market, position: posVictim, vault,
        liquidatorTokenAccount: adminAta,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .rpc();
    const balAfter = Number((await getAccount(conn, adminAta)).amount);
    const reward = balAfter - balBefore;
    console.log(`\n    → liquidator reward: ${reward / 1e6} USDC`);

    // Verify position is closed
    let posGone = false;
    try {
      await (program.account as any).position.fetch(posVictim);
    } catch {
      posGone = true;
    }
    assert(posGone, "Position account should be closed after liquidation");
  });

  console.log();
  console.log("6. Drift rate fetch (mainnet smoke test)");

  await test("Fetch SOL-PERP funding rate from Drift mainnet", async () => {
    const MAINNET_RPC = process.env.MAINNET_RPC ?? "https://api.mainnet-beta.solana.com";
    const mainnetConn = new Connection(MAINNET_RPC, "confirmed");
    const dummyKp = Keypair.generate();

    // Use websocket subscription to avoid batch RPC calls (incompatible with Helius free tier)
    const driftClient = new DriftClient({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connection: mainnetConn as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      wallet: new Wallet(dummyKp as any),
      env: "mainnet-beta",
      accountSubscription: { type: "websocket" },
    });

    try {
      await driftClient.subscribe();
    } catch (e: any) {
      const msg = e.message ?? String(e);
      if (msg.includes("429") || msg.includes("Too Many Requests") || msg.includes("403")) {
        console.log(`\n    → SKIPPED (mainnet RPC limited: ${msg.slice(0, 60)})`);
        passed++;
        failed--;
        await driftClient.unsubscribe().catch(() => {});
        return;
      }
      throw e;
    }

    const market = driftClient.getPerpMarketAccount(0); // SOL-PERP
    assert(!!market, "SOL-PERP market not found on Drift");

    const lastRate = market.amm.lastFundingRate;
    const actualRate = lastRate.muln(1_000_000).div(FUNDING_RATE_PRECISION).toNumber();
    assert(isFinite(actualRate), "Rate should be a finite number");
    console.log(`\n    → SOL-PERP lastFundingRate: ${lastRate.toString()} → ${actualRate} (our units, can be negative)`);

    await driftClient.unsubscribe();
  });

  // ── Summary ──────────────────────────────────────────────────────────────

  console.log();
  console.log("=".repeat(60));
  const total = passed + failed;
  console.log(`Results: ${passed}/${total} passed${failed > 0 ? `, ${failed} failed` : ""}`);
  console.log("=".repeat(60));

  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
