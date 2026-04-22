import { NextRequest, NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { MODEL_HAIKU, GATEWAY_FALLBACK_ORDER } from "@/lib/fundex/ai-models";

export interface PortfolioSummaryInput {
  positions: Array<{
    market: string;         // e.g. "SOL-PERP 30d"
    side: "payer" | "receiver";
    notionalUsd: number;    // USD value
    collateralUsd: number;  // USD value
    unrealizedPnlUsd: number;
    marginRatioBps: number;
    daysToExpiry: number;
    variableRateApr: number;  // %
    fixedRateApr: number;     // %
    settlementsToLiq: number | null;
  }>;
}

export interface PortfolioSummaryOutput {
  summary: string;  // one sentence, <= 140 chars
}

const SYSTEM_PROMPT = `You are a DeFi portfolio analyst for Fundex, a funding rate swap protocol on Solana.

Given a list of open positions, return EXACTLY one sentence (<= 140 chars) that describes the portfolio's current state. Focus on:
- How many positions look favorable (variable rate moving in the right direction for the side) vs unfavorable
- Any position at margin risk (marginRatioBps < 700)
- Near expiry (daysToExpiry < 3)
- Near liquidation (settlementsToLiq non-null and < 5)

Rules:
- Write as if briefing a trader at a glance, not as a formal report
- No emoji, no markdown, no prefix like "Summary:"
- Prefer concrete counts over adjectives ("2 positions" not "a few positions")
- If all positions are safe and favorable, say so plainly
- If zero positions, return "No open positions."
- Max 140 chars`;

const SummarySchema = z.object({
  summary: z.string(),
});

// Simple in-memory cache keyed by a hash of positions. 2 min TTL.
const globalForCache = globalThis as unknown as {
  __fundexSummaryCache?: Map<string, { value: PortfolioSummaryOutput; expiresAt: number }>;
};
const summaryCache = globalForCache.__fundexSummaryCache ?? new Map<string, { value: PortfolioSummaryOutput; expiresAt: number }>();
globalForCache.__fundexSummaryCache = summaryCache;
const TTL_MS = 2 * 60 * 1000;

function cacheKey(input: PortfolioSummaryInput): string {
  // bucket fields so equivalent portfolios share a cache entry
  return input.positions
    .map((p) =>
      [
        p.market,
        p.side,
        Math.round(p.notionalUsd / 100),
        Math.round(p.marginRatioBps / 100),
        Math.round(p.daysToExpiry),
        Math.round(p.variableRateApr),
        Math.round(p.fixedRateApr),
        p.settlementsToLiq ?? -1,
      ].join(":"),
    )
    .sort()
    .join("|");
}

export async function POST(req: NextRequest) {
  try {
    const input: PortfolioSummaryInput = await req.json();
    if (!input.positions || input.positions.length === 0) {
      return NextResponse.json({ summary: "No open positions." } satisfies PortfolioSummaryOutput);
    }

    const key = cacheKey(input);
    const cached = summaryCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.value);
    }

    const lines = input.positions.map(
      (p, i) =>
        `${i + 1}) ${p.market} · ${p.side} · $${p.notionalUsd.toFixed(0)} notional · pnl $${p.unrealizedPnlUsd.toFixed(2)} · margin ${(p.marginRatioBps / 100).toFixed(1)}% · ${p.daysToExpiry.toFixed(1)}d to expiry · fixed ${p.fixedRateApr.toFixed(1)}% APR vs variable ${p.variableRateApr.toFixed(1)}% APR${p.settlementsToLiq != null ? ` · ~${p.settlementsToLiq} settlements to liq` : ""}`,
    );
    const prompt = `Open positions (${input.positions.length}):\n${lines.join("\n")}\n\nReturn one-line portfolio summary (<=140 chars).`;

    const { output } = await generateText({
      model: MODEL_HAIKU,
      system: SYSTEM_PROMPT,
      prompt,
      output: Output.object({ schema: SummarySchema }),
      providerOptions: {
        gateway: {
          tags: ["feature:portfolio-summary"],
          order: [...GATEWAY_FALLBACK_ORDER],
          cacheControl: "max-age=120",
        },
      },
    });

    const cleaned = output.summary.trim().replace(/^(summary:?\s*)/i, "").slice(0, 180);
    const result: PortfolioSummaryOutput = { summary: cleaned };
    summaryCache.set(key, { value: result, expiresAt: Date.now() + TTL_MS });
    return NextResponse.json(result);
  } catch (e) {
    console.error("Portfolio summary error:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Summary unavailable" }, { status: 500 });
  }
}
