import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export interface RiskInput {
  // Position
  side: number;              // 0 = Fixed Payer, 1 = Fixed Receiver
  marginRatioBps: number;    // current margin ratio in bps
  unrealizedPnl: number;     // USDC lamports
  collateralDeposited: number; // USDC lamports
  fixedRate: number;         // fixed rate in Drift precision (1e6 = 0.0001%)
  // Market
  currentOracleRate: number; // current EMA funding rate
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
- fixedRate and currentOracleRate are in Drift precision where 1,000,000 = 0.0001% per hour.
- OI imbalance: large difference between fixedPayerLots and fixedReceiverLots means the protocol may adjust fixed rates.

Evaluate the position risk from 0 (safe) to 100 (about to be liquidated).
Consider: margin ratio, rate direction vs position side, OI imbalance, days to expiry, unrealized PnL trend.

Respond with ONLY valid JSON in this exact format:
{"score": <integer 0-100>, "reason": "<one sentence, max 80 chars>"}`;

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error("AI risk error: ANTHROPIC_API_KEY not set");
      return NextResponse.json({ error: "AI unavailable" }, { status: 500 });
    }
    const client = new Anthropic({ apiKey });
    const input: RiskInput = await req.json();

    const sideLabel = input.side === 0 ? "Fixed Payer" : "Fixed Receiver";
    const pnlUsd = (input.unrealizedPnl / 1_000_000).toFixed(2);
    const collUsd = (input.collateralDeposited / 1_000_000).toFixed(2);
    const marginPct = (input.marginRatioBps / 100).toFixed(1);
    const fixedRatePct = (input.fixedRate / 1_000_000 * 100).toFixed(4);
    const oraclePct = (input.currentOracleRate / 1_000_000 * 100).toFixed(4);
    const rateVsPosition = input.side === 0
      ? input.currentOracleRate > input.fixedRate ? "favorable" : "unfavorable"
      : input.currentOracleRate < input.fixedRate ? "favorable" : "unfavorable";

    const userMessage = `Position data:
- Side: ${sideLabel}
- Margin ratio: ${marginPct}% (${input.marginRatioBps} bps)
- Unrealized PnL: $${pnlUsd} USDC
- Collateral deposited: $${collUsd} USDC
- Notional: $${input.notionalUsd.toFixed(0)} USDC
- Fixed rate agreed: ${fixedRatePct}%/hr
- Current oracle rate: ${oraclePct}%/hr (${rateVsPosition} for this position)
- OI: ${input.totalFixedPayerLots} payer lots vs ${input.totalFixedReceiverLots} receiver lots
- Days to expiry: ${input.daysToExpiry.toFixed(1)}

Provide risk score and reason.`;

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 100,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const raw = message.content[0].type === "text" ? message.content[0].text.trim() : "";
    // Strip markdown code fences if present
    const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

    // Parse JSON response
    const parsed = JSON.parse(text) as { score: number; reason: string };
    const score = Math.max(0, Math.min(100, Math.round(parsed.score)));
    const level: RiskOutput["level"] = score >= 61 ? "high" : score >= 31 ? "medium" : "low";

    return NextResponse.json({ score, reason: parsed.reason, level } satisfies RiskOutput);
  } catch (e) {
    console.error("AI risk error:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "AI unavailable" }, { status: 500 });
  }
}
