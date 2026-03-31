import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Fundex } from "../target/types/fundex";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert, expect } from "chai";

const { PublicKey, SystemProgram, LAMPORTS_PER_SOL } = anchor.web3;

// ─── PDA helpers ─────────────────────────────────────────────────────────────
function oraclePda(perpIndex: number, programId: PublicKey) {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(perpIndex);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("rate_oracle"), buf],
    programId
  );
}

function marketPda(perpIndex: number, durationVariant: number, programId: PublicKey) {
  const perpBuf = Buffer.alloc(2);
  perpBuf.writeUInt16LE(perpIndex);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), perpBuf, Buffer.from([durationVariant])],
    programId
  );
}

function vaultPda(marketPubkey: PublicKey, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), marketPubkey.toBuffer()],
    programId
  );
}

function positionPda(user: PublicKey, market: PublicKey, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), user.toBuffer(), market.toBuffer()],
    programId
  );
}

// ─── Suite ───────────────────────────────────────────────────────────────────
describe("fundex", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Fundex as Program<Fundex>;
  const admin = provider.wallet as anchor.Wallet;

  // perp 0 = SOL-PERP, duration 1 = 30 days
  const PERP_INDEX = 0;
  const DURATION_30D = 1;

  let usdcMint: PublicKey;
  let adminUsdc: PublicKey;
  let user1Kp: anchor.web3.Keypair;
  let user2Kp: anchor.web3.Keypair;
  let user1Usdc: PublicKey;
  let user2Usdc: PublicKey;

  const [oraclePubkey] = oraclePda(PERP_INDEX, program.programId);
  const [marketPubkey] = marketPda(PERP_INDEX, DURATION_30D, program.programId);
  const [vaultPubkey] = vaultPda(marketPubkey, program.programId);

  const NOTIONAL_PER_LOT = 100_000_000; // 100 USDC
  const LOTS = 5;
  const COLLATERAL = NOTIONAL_PER_LOT * LOTS * 0.1; // 10% of notional = 50 USDC

  // ── 공통 셋업 ───────────────────────────────────────────────────────────────
  before(async () => {
    // USDC mock mint (6 decimals)
    usdcMint = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      null,
      6
    );
    adminUsdc = await createAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      usdcMint,
      admin.publicKey
    );
    // Mint 10,000 USDC to admin
    await mintTo(
      provider.connection,
      admin.payer,
      usdcMint,
      adminUsdc,
      admin.publicKey,
      10_000_000_000
    );

    // Create user keypairs and fund
    user1Kp = anchor.web3.Keypair.generate();
    user2Kp = anchor.web3.Keypair.generate();
    for (const kp of [user1Kp, user2Kp]) {
      await provider.connection.requestAirdrop(kp.publicKey, LAMPORTS_PER_SOL);
    }
    await new Promise((r) => setTimeout(r, 1000));

    user1Usdc = await createAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      usdcMint,
      user1Kp.publicKey
    );
    user2Usdc = await createAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      usdcMint,
      user2Kp.publicKey
    );

    // Give each user 1,000 USDC
    for (const ata of [user1Usdc, user2Usdc]) {
      await mintTo(
        provider.connection,
        admin.payer,
        usdcMint,
        ata,
        admin.publicKey,
        1_000_000_000
      );
    }
  });

  // ── 1. initialize_rate_oracle ───────────────────────────────────────────────
  describe("initialize_rate_oracle", () => {
    it("오라클 PDA를 생성한다", async () => {
      await program.methods
        .initializeRateOracle(PERP_INDEX)
        .accounts({
          admin: admin.publicKey,
          oracle: oraclePubkey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const oracle = await program.account.rateOracle.fetch(oraclePubkey);
      assert.equal(oracle.perpIndex, PERP_INDEX);
      assert.equal(oracle.emaFundingRate.toNumber(), 0);
      assert.equal(oracle.numSamples.toNumber(), 0);
    });
  });

  // ── 2. initialize_market (V1 — fixed_rate_override) ─────────────────────────
  describe("initialize_market (V1)", () => {
    it("고정금리 100으로 30일 마켓을 생성한다", async () => {
      const fixedRate = new BN(100); // 100 Drift units ≈ 0.01% per interval

      await program.methods
        .initializeMarket(PERP_INDEX, DURATION_30D, fixedRate)
        .accounts({
          admin: admin.publicKey,
          oracle: oraclePubkey,
          market: marketPubkey,
          vault: vaultPubkey,
          collateralMint: usdcMint,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      const market = await program.account.marketState.fetch(marketPubkey);
      assert.equal(market.perpIndex, PERP_INDEX);
      assert.equal(market.durationVariant, DURATION_30D);
      assert.equal(market.fixedRate.toNumber(), 100);
      assert.equal(market.isActive, true);
      assert.equal(market.totalCollateral.toNumber(), 0);
    });

    it("invalid duration이면 revert된다", async () => {
      const [badMarket] = marketPda(PERP_INDEX, 99, program.programId);
      const [badVault] = vaultPda(badMarket, program.programId);

      try {
        await program.methods
          .initializeMarket(PERP_INDEX, 99, new BN(100))
          .accounts({
            admin: admin.publicKey,
            oracle: oraclePubkey,
            market: badMarket,
            vault: badVault,
            collateralMint: usdcMint,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .rpc();
        assert.fail("revert 되어야 함");
      } catch (e: any) {
        expect(e.message).to.include("InvalidDuration");
      }
    });
  });

  // ── 3. open_position ────────────────────────────────────────────────────────
  describe("open_position", () => {
    it("user1이 FixedPayer(0) 포지션을 오픈한다", async () => {
      const [pos1] = positionPda(user1Kp.publicKey, marketPubkey, program.programId);

      await program.methods
        .openPosition(0, new BN(LOTS)) // side=0 (FixedPayer), 5 lots
        .accounts({
          user: user1Kp.publicKey,
          market: marketPubkey,
          position: pos1,
          vault: vaultPubkey,
          userTokenAccount: user1Usdc,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user1Kp])
        .rpc();

      const pos = await program.account.position.fetch(pos1);
      assert.equal(pos.side, 0);
      assert.equal(pos.lots.toNumber(), LOTS);
      assert.equal(pos.collateralDeposited.toNumber(), COLLATERAL);

      // Vault에 담보 입금 확인
      const vault = await getAccount(provider.connection, vaultPubkey);
      assert.equal(Number(vault.amount), COLLATERAL);
    });

    it("user2가 FixedReceiver(1) 포지션을 오픈한다", async () => {
      const [pos2] = positionPda(user2Kp.publicKey, marketPubkey, program.programId);

      await program.methods
        .openPosition(1, new BN(LOTS)) // side=1 (FixedReceiver), 5 lots
        .accounts({
          user: user2Kp.publicKey,
          market: marketPubkey,
          position: pos2,
          vault: vaultPubkey,
          userTokenAccount: user2Usdc,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user2Kp])
        .rpc();

      const market = await program.account.marketState.fetch(marketPubkey);
      assert.equal(market.totalFixedPayerLots.toNumber(), LOTS);
      assert.equal(market.totalFixedReceiverLots.toNumber(), LOTS);
      assert.equal(market.totalCollateral.toNumber(), COLLATERAL * 2);
    });

    it("lots=0이면 revert된다", async () => {
      const newUser = anchor.web3.Keypair.generate();
      await provider.connection.requestAirdrop(newUser.publicKey, LAMPORTS_PER_SOL);
      await new Promise((r) => setTimeout(r, 500));
      const [pos] = positionPda(newUser.publicKey, marketPubkey, program.programId);
      const newUsdc = await createAssociatedTokenAccount(
        provider.connection, admin.payer, usdcMint, newUser.publicKey
      );
      await mintTo(provider.connection, admin.payer, usdcMint, newUsdc, admin.publicKey, 1_000_000_000);

      try {
        await program.methods
          .openPosition(0, new BN(0))
          .accounts({
            user: newUser.publicKey,
            market: marketPubkey,
            position: pos,
            vault: vaultPubkey,
            userTokenAccount: newUsdc,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([newUser])
          .rpc();
        assert.fail("revert 되어야 함");
      } catch (e: any) {
        expect(e.message).to.include("InvalidLots");
      }
    });
  });

  // ── 4. settle_funding ───────────────────────────────────────────────────────
  describe("settle_funding", () => {
    it("actual_rate=150으로 첫 번째 settlement — FixedPayer 수익 구간", async () => {
      // actual=150 > fixed=100 → delta=+50 → cumulative_rate_index = +50
      await program.methods
        .settleFunding(new BN(150))
        .accounts({
          crank: admin.publicKey,
          market: marketPubkey,
          oracle: oraclePubkey,
        })
        .rpc();

      await new Promise((r) => setTimeout(r, 100));

      const market = await program.account.marketState.fetch(marketPubkey);
      assert.equal(market.cumulativeRateIndex.toNumber(), 50); // 150-100=50

      const oracle = await program.account.rateOracle.fetch(oraclePubkey);
      assert.equal(oracle.numSamples.toNumber(), 1);
      assert.equal(oracle.emaFundingRate.toNumber(), 150);
    });

    it("actual_rate=80으로 두 번째 settlement — FixedReceiver 수익 구간", async () => {
      // actual=80 < fixed=100 → delta=-20 → cumulative = 50-20 = 30
      await program.methods
        .settleFunding(new BN(80))
        .accounts({
          crank: admin.publicKey,
          market: marketPubkey,
          oracle: oraclePubkey,
        })
        .rpc();

      await new Promise((r) => setTimeout(r, 100));

      const market = await program.account.marketState.fetch(marketPubkey);
      assert.equal(market.cumulativeRateIndex.toNumber(), 30); // 50-20
    });

    it("세 번째 settlement — EMA가 3샘플 이후 업데이트된다", async () => {
      await program.methods
        .settleFunding(new BN(110))
        .accounts({
          crank: admin.publicKey,
          market: marketPubkey,
          oracle: oraclePubkey,
        })
        .rpc();

      const oracle = await program.account.rateOracle.fetch(oraclePubkey);
      assert.equal(oracle.numSamples.toNumber(), 3);
      // EMA after 3 samples: start=150, then (80+9*150)/10=137, then (110+9*137)/10=134
      // Check it's a reasonable value
      assert.isAbove(oracle.emaFundingRate.toNumber(), 100);
    });
  });

  // ── 5. initialize_market (V2 — oracle EMA 자동설정) ─────────────────────────
  describe("initialize_market (V2)", () => {
    it("oracle 샘플이 충분하면 EMA로 고정금리 자동 설정된다", async () => {
      const DURATION_7D = 0;
      const [market7d] = marketPda(PERP_INDEX, DURATION_7D, program.programId);
      const [vault7d] = vaultPda(market7d, program.programId);

      await program.methods
        .initializeMarket(PERP_INDEX, DURATION_7D, null) // null = use oracle EMA
        .accounts({
          admin: admin.publicKey,
          oracle: oraclePubkey,
          market: market7d,
          vault: vault7d,
          collateralMint: usdcMint,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      const oracle = await program.account.rateOracle.fetch(oraclePubkey);
      const market = await program.account.marketState.fetch(market7d);
      // fixed_rate should equal oracle's current EMA
      assert.equal(market.fixedRate.toNumber(), oracle.emaFundingRate.toNumber());
    });
  });

  // ── 6. close_position ───────────────────────────────────────────────────────
  describe("close_position", () => {
    it("user1(FixedPayer)이 포지션을 청산한다 — PnL 수령", async () => {
      const [pos1] = positionPda(user1Kp.publicKey, marketPubkey, program.programId);

      const user1BalanceBefore = Number(
        (await getAccount(provider.connection, user1Usdc)).amount
      );

      await program.methods
        .closePosition()
        .accounts({
          user: user1Kp.publicKey,
          market: marketPubkey,
          position: pos1,
          vault: vaultPubkey,
          userTokenAccount: user1Usdc,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .signers([user1Kp])
        .rpc();

      const user1BalanceAfter = Number(
        (await getAccount(provider.connection, user1Usdc)).amount
      );

      // cumulative_rate_index = 30 (net across 3 settlements)
      // FixedPayer PnL = +30 * 5 lots * 100_000_000 / 1_000_000 = +15_000_000 (15 USDC)
      // payout = 50_000_000 (collateral) + 15_000_000 (PnL) = 65_000_000
      const payout = user1BalanceAfter - user1BalanceBefore;
      assert.isAbove(payout, COLLATERAL); // got back more than deposited
      console.log(`user1 payout: ${payout / 1e6} USDC (deposited ${COLLATERAL / 1e6} USDC)`);

      // Position PDA 닫혔는지 확인
      try {
        await program.account.position.fetch(pos1);
        assert.fail("포지션이 닫혀야 함");
      } catch (e: any) {
        expect(e.message).to.satisfy(
          (m: string) => m.includes("Account does not exist") || m.includes("Error")
        );
      }
    });

    it("user2(FixedReceiver)가 포지션을 청산한다 — 손실 반영", async () => {
      const [pos2] = positionPda(user2Kp.publicKey, marketPubkey, program.programId);

      const user2BalanceBefore = Number(
        (await getAccount(provider.connection, user2Usdc)).amount
      );

      await program.methods
        .closePosition()
        .accounts({
          user: user2Kp.publicKey,
          market: marketPubkey,
          position: pos2,
          vault: vaultPubkey,
          userTokenAccount: user2Usdc,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .signers([user2Kp])
        .rpc();

      const user2BalanceAfter = Number(
        (await getAccount(provider.connection, user2Usdc)).amount
      );

      // FixedReceiver PnL = -30 * 5 * 100_000_000 / 1_000_000 = -15 USDC
      // payout = 50_000_000 - 15_000_000 = 35_000_000
      const payout = user2BalanceAfter - user2BalanceBefore;
      assert.isBelow(payout, COLLATERAL); // got back less than deposited
      console.log(`user2 payout: ${payout / 1e6} USDC (deposited ${COLLATERAL / 1e6} USDC)`);
    });
  });

  // ── 7. liquidate_position ────────────────────────────────────────────────────
  describe("liquidate_position", () => {
    let victim: anchor.web3.Keypair;
    let victimUsdc: PublicKey;

    before(async () => {
      victim = anchor.web3.Keypair.generate();
      await provider.connection.requestAirdrop(victim.publicKey, LAMPORTS_PER_SOL);
      await new Promise((r) => setTimeout(r, 1000));
      victimUsdc = await createAssociatedTokenAccount(
        provider.connection, admin.payer, usdcMint, victim.publicKey
      );
      await mintTo(provider.connection, admin.payer, usdcMint, victimUsdc, admin.publicKey, 1_000_000_000);

      // victim opens FixedReceiver position on the 30d market (which is still active)
      const [victimPos] = positionPda(victim.publicKey, marketPubkey, program.programId);
      await program.methods
        .openPosition(1, new BN(1)) // 1 lot, FixedReceiver
        .accounts({
          user: victim.publicKey,
          market: marketPubkey,
          position: victimPos,
          vault: vaultPubkey,
          userTokenAccount: victimUsdc,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([victim])
        .rpc();
    });

    it("margin이 5% 이상이면 청산 불가", async () => {
      const [victimPos] = positionPda(victim.publicKey, marketPubkey, program.programId);
      const liquidatorUsdc = adminUsdc;

      try {
        await program.methods
          .liquidatePosition()
          .accounts({
            liquidator: admin.publicKey,
            market: marketPubkey,
            position: victimPos,
            vault: vaultPubkey,
            liquidatorTokenAccount: liquidatorUsdc,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          })
          .rpc();
        assert.fail("청산 불가여야 함");
      } catch (e: any) {
        expect(e.message).to.include("PositionAboveMaintenanceMargin");
      }
    });

    it("대규모 adverse settlement 후 청산 가능해진다", async () => {
      // Settle with very large actual_rate (victim is FixedReceiver, so loses when rate is high)
      // 1 lot * 100 USDC notional * 10% collateral = 10 USDC collateral
      // Need PnL < -5 USDC to breach 5% maintenance margin
      // PnL = delta * 1 * 100_000_000 / 1_000_000 = delta * 100
      // Need delta * 100 < -5_000_000 → delta < -50_000
      // Each settle: actual=50200, fixed=100, delta=50100
      // cumulative += 50100 → FixedReceiver PnL = -50100 * 1 * 100_000_000 / 1_000_000 = -5_010_000_000
      // That's way more than collateral. Let's do actual = 600, delta = 500 per settle
      // After 1 settle: delta = 500 + existing 30 from before + now 500 = 530? No, each settle adds delta
      // victim entered when cumulative_rate_index = 30
      // Let's do actual=700: delta=600. After settlement: cumulative += 600
      // FixedReceiver PnL for 1 lot: -600 * 100_000_000 / 1_000_000 = -60_000_000 (60 USDC)
      // collateral = 10_000_000 (10 USDC), margin = (10-60)/100 USDC = negative → liquidatable

      // Need rate_delta > 50_000 to breach 5% maintenance margin
      // victim collateral = 10 USDC = 10_000_000 lamports (1 lot * 100 USDC * 10%)
      // pnl = -rate_delta * 1 * 100_000_000 / 1_000_000 = -rate_delta * 100
      // need: 10_000_000 - rate_delta * 100 < 5_000_000 → rate_delta > 50_000
      // actual = 60_000: delta = 60_000 - 100 = 59_900 > 50_000 ✓
      await program.methods
        .settleFunding(new BN(60_000))
        .accounts({
          crank: admin.publicKey,
          market: marketPubkey,
          oracle: oraclePubkey,
        })
        .rpc();

      const [victimPos] = positionPda(victim.publicKey, marketPubkey, program.programId);
      const liquidatorBalanceBefore = Number(
        (await getAccount(provider.connection, adminUsdc)).amount
      );

      await program.methods
        .liquidatePosition()
        .accounts({
          liquidator: admin.publicKey,
          market: marketPubkey,
          position: victimPos,
          vault: vaultPubkey,
          liquidatorTokenAccount: adminUsdc,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .rpc();

      const liquidatorBalanceAfter = Number(
        (await getAccount(provider.connection, adminUsdc)).amount
      );

      // Liquidator should have received something (or 0 if effective_collateral went negative)
      const reward = liquidatorBalanceAfter - liquidatorBalanceBefore;
      console.log(`liquidator reward: ${reward / 1e6} USDC`);

      // Position should be closed
      try {
        await program.account.position.fetch(victimPos);
        assert.fail("포지션이 닫혀야 함");
      } catch (e: any) {
        expect(e.message).to.satisfy(
          (m: string) => m.includes("Account does not exist") || m.includes("Error")
        );
      }
    });
  });
});
