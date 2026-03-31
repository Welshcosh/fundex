/**
 * liquidator.ts
 *
 * Liquidation bot: scans all open positions every SCAN_INTERVAL_MS.
 * Positions with marginRatio < MAINT_MARGIN_BPS (5%) are liquidated.
 *
 * Usage:
 *   yarn liquidator:devnet
 *   yarn liquidator:devnet:dry
 *
 * Env vars:
 *   SCAN_INTERVAL_MS=60000   scan interval in ms (default: 1 min)
 *   DRY_RUN=true             log only
 */

import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Fundex } from "../target/types/fundex";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

// ─── Config ──────────────────────────────────────────────────────────────────

const SCAN_INTERVAL_MS = Number(process.env.SCAN_INTERVAL_MS ?? 60_000);
const DRY_RUN = process.env.DRY_RUN === "true";

// Must match on-chain constant
const MAINT_MARGIN_BPS = 500;   // 5%
const DRIFT_PRICE_PRECISION = 1_000_000;

// Devnet USDC mint — must match NEXT_PUBLIC_USDC_MINT in app/.env.local
const USDC_MINT = new PublicKey(
  process.env.USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);

// ─── PDA helpers ─────────────────────────────────────────────────────────────

function vaultPda(market: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer()], programId)[0];
}

// ─── Margin calculation ───────────────────────────────────────────────────────

interface PositionRisk {
  positionPubkey: PublicKey;
  userPubkey: PublicKey;
  marketPubkey: PublicKey;
  marginRatioBps: number;
  label: string;
}

async function scanPositions(program: anchor.Program<Fundex>): Promise<PositionRisk[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allPositions = await (program.account as any).position.all();
  const risky: PositionRisk[] = [];

  for (const { publicKey: positionPubkey, account: pos } of allPositions) {
    const marketPubkey: PublicKey = pos.market;

    let market: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      market = await (program.account as any).marketState.fetch(marketPubkey);
    } catch {
      continue; // market not found
    }
    if (!market.isActive) continue;

    const lots: number = pos.lots.toNumber();
    const collateral: number = pos.collateralDeposited.toNumber();
    const entryRateIndex: number = pos.entryRateIndex.toNumber();
    const cumRateIndex: number = market.cumulativeRateIndex.toNumber();
    const notionalPerLot: number = market.notionalPerLot.toNumber();
    const side: number = pos.side;

    const rateDelta = cumRateIndex - entryRateIndex;
    const rawPnl = (rateDelta * lots * notionalPerLot) / DRIFT_PRICE_PRECISION;
    const unrealizedPnl = side === 0 ? rawPnl : -rawPnl; // 0=FixedPayer
    const notional = notionalPerLot * lots;
    const effective = collateral + unrealizedPnl;
    const marginRatioBps = notional > 0
      ? Math.floor((Math.max(effective, 0) * 10_000) / notional)
      : 99_999;

    const userPubkey: PublicKey = pos.user;
    const label = `${userPubkey.toBase58().slice(0, 6)}… perp=${market.perpIndex} dur=${market.durationVariant} margin=${(marginRatioBps / 100).toFixed(1)}%`;

    if (marginRatioBps < MAINT_MARGIN_BPS) {
      risky.push({ positionPubkey, userPubkey, marketPubkey, marginRatioBps, label });
    }
  }

  return risky;
}

// ─── Liquidation ─────────────────────────────────────────────────────────────

async function liquidateAll(program: anchor.Program<Fundex>) {
  const liquidator = (program.provider as anchor.AnchorProvider).wallet.publicKey;
  const now = new Date().toISOString();

  const risky = await scanPositions(program);

  if (risky.length === 0) {
    console.log(`[${now}] Scan complete — no positions below maintenance margin`);
    return;
  }

  console.log(`[${now}] Found ${risky.length} liquidatable position(s)`);

  const liquidatorTokenAccount = getAssociatedTokenAddressSync(USDC_MINT, liquidator);

  for (const pos of risky) {
    if (DRY_RUN) {
      console.log(`[${now}] DRY_RUN liquidate ${pos.label}`);
      continue;
    }

    try {
      const vault = vaultPda(pos.marketPubkey, program.programId);
      const sig = await (program.methods as any)
        .liquidatePosition()
        .accounts({
          liquidator,
          market: pos.marketPubkey,
          position: pos.positionPubkey,
          vault,
          liquidatorTokenAccount,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .rpc();
      console.log(`[${now}] ✓ Liquidated ${pos.label} sig=${sig.slice(0, 8)}…`);
    } catch (e: any) {
      if (e.message?.includes("PositionAboveMaintenanceMargin")) {
        // Race condition: another liquidator got there first, or position improved
        console.log(`[${now}] ~ ${pos.label}: no longer liquidatable`);
      } else {
        console.error(`[${now}] ✗ ${pos.label}: ${e.message?.slice(0, 100)}`);
      }
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Fundex as anchor.Program<Fundex>;

  console.log("=".repeat(60));
  console.log("Fundex liquidator bot");
  console.log("=".repeat(60));
  console.log(`Liquidator: ${provider.wallet.publicKey.toBase58()}`);
  console.log(`Scan every: ${SCAN_INTERVAL_MS / 1000}s`);
  console.log(`Dry run:    ${DRY_RUN}`);
  console.log(`USDC mint:  ${USDC_MINT.toBase58()}`);
  console.log("=".repeat(60));

  await liquidateAll(program);
  setInterval(() => liquidateAll(program), SCAN_INTERVAL_MS);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
