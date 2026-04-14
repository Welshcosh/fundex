import { NextRequest, NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { MODEL_HAIKU, GATEWAY_FALLBACK_ORDER } from "@/lib/fundex/ai-models";
import { rateToAprPct } from "@/lib/utils";

export interface RiskInput {
  // Position
  side: number;              // 0 = Fixed Payer, 1 = Fixed Receiver
  marginRatioBps: number;    // current margin ratio in bps
  unrealizedPnl: number;     // USDC lamports
  collateralDeposited: number; // USDC lamports
  fixedRate: number;         // Fundex precision (10_000 = 1% per 8h interval)
  // Market
  currentOracleRate: number; // current EMA funding rate (same Fundex precision)
  totalFixedPayerLots: number;
  totalFixedReceiverLots: number;
  daysToExpiry: number;
  // Notional
  notionalUsd: number;       // USD value
}

export interface RiskOutput {
  score: number;   // 0–100 (100 = most risky)
  reason: string;  // one sentence
  level: "low" | "medium" | "high";
}

const SYSTEM_PROMPT = `You are a DeFi risk analyst for Fundex, a Funding Rate Swap (FRS) protocol on Solana.

In Fundex:
- Fixed Payer (side=0): pays fixed rate, receives variable funding rate. Profits when actual funding rate > fixed rate.
- Fixed Receiver (side=1): receives fixed rate, pays variable funding rate. Profits when actual funding rate < fixed rate.
- marginRatioBps: current collateral / notional in basis points. Below 500bps (~5%) is dangerous, below 200bps is near liquidation.
- Rates shown below are annualized APR (Fundex settles every 8h; APR = per-8h × 1095).
- OI imbalance: large difference between fixedPayerLots and fixedReceiverLots means the protocol may adjust fixed rates.

Evaluate the position risk from 0 (safe) to 100 (about to be liquidated).
Consider: margin ratio, rate direction vs position side, OI imbalance, days to expiry, unrealized PnL trend.`;

const RiskSchema = z.object({
  score: z.number().int().min(0).max(100),
  reason: z.string(),
});

const globalForCache = globalThis as unknown as {
  __fundexRiskCache?: Map<string, { value: RiskOutput; expiresAt: number }>;
};
const riskCache = globalForCache.__fundexRiskCache ?? new Map<string, { value: RiskOutput; expiresAt: number }>();
globalForCache.__fundexRiskCache = riskCache;
const RISK_TTL_MS = 10 * 60 * 1000;

function riskCacheKey(input: RiskInput): string {
  const bucket = (n: number, size: number) => Math.round(n / size) * size;
  const total = input.totalFixedPayerLots + input.totalFixedReceiverLots;
  const payerPctBucket = total > 0
    ? Math.round((input.totalFixedPayerLots / total) * 10)
    : -1;
  return [
    "v2",
    input.side,
    bucket(input.marginRatioBps, 50),
    bucket(input.fixedRate, 1_000_000),
    bucket(input.currentOracleRate, 1_000_000),
    bucket(input.daysToExpiry, 0.5),
    bucket(input.notionalUsd, 100),
    payerPctBucket,
  ].join("|");
}

export async function POST(req: NextRequest) {
  try {
    const input: RiskInput = await req.json();

    const cacheKey = riskCacheKey(input);
    const cached = riskCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.value satisfies RiskOutput);
    }

    const sideLabel = input.side === 0 ? "Fixed Payer" : "Fixed Receiver";
    const pnlUsd = (input.unrealizedPnl / 1_000_000).toFixed(2);
    const collUsd = (input.collateralDeposited / 1_000_000).toFixed(2);
    const marginPct = (input.marginRatioBps / 100).toFixed(1);
    const fixedRateApr = rateToAprPct(input.fixedRate).toFixed(2);
    const oracleApr = rateToAprPct(input.currentOracleRate).toFixed(2);
    const rateVsPosition = input.side === 0
      ? input.currentOracleRate > input.fixedRate ? "favorable" : "unfavorable"
      : input.currentOracleRate < input.fixedRate ? "favorable" : "unfavorable";

    const userMessage = `Position data:
- Side: ${sideLabel}
- Margin ratio: ${marginPct}% (${input.marginRatioBps} bps)
- Unrealized PnL: $${pnlUsd} USDC
- Collateral deposited: $${collUsd} USDC
- Notional: $${input.notionalUsd.toFixed(0)} USDC
- Fixed rate agreed: ${fixedRateApr}% APR
- Current oracle rate: ${oracleApr}% APR (${rateVsPosition} for this position)
- OI: ${input.totalFixedPayerLots} payer lots vs ${input.totalFixedReceiverLots} receiver lots
- Days to expiry: ${input.daysToExpiry.toFixed(1)}

Provide risk score and a one-sentence reason (max 80 chars).`;

    const { output } = await generateText({
      model: MODEL_HAIKU,
      system: SYSTEM_PROMPT,
      prompt: userMessage,
      output: Output.object({ schema: RiskSchema }),
      providerOptions: {
        gateway: {
          tags: ["feature:risk"],
          order: [...GATEWAY_FALLBACK_ORDER],
          cacheControl: "max-age=60",
        },
      },
    });

    const score = Math.max(0, Math.min(100, Math.round(output.score)));
    const reason = output.reason.trim().slice(0, 160);
    const level: RiskOutput["level"] = score >= 61 ? "high" : score >= 31 ? "medium" : "low";

    const result: RiskOutput = { score, reason, level };
    riskCache.set(cacheKey, { value: result, expiresAt: Date.now() + RISK_TTL_MS });
    return NextResponse.json(result satisfies RiskOutput);
  } catch (e) {
    console.error("AI risk error:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "AI unavailable" }, { status: 500 });
  }
}
