import { streamText, convertToModelMessages, type UIMessage } from "ai";
import MODEL_DATA from "@/lib/fundex/rate-model.json";
import { MODEL_HAIKU, GATEWAY_FALLBACK_ORDER } from "@/lib/fundex/ai-models";
import { rateToAprPct } from "@/lib/utils";

export const maxDuration = 30;

interface MarketContext {
  market: string;
  duration: number;
  variableRate: number;
  fixedRate: number;
  payerLots: number;
  receiverLots: number;
}

const BASE_SYSTEM_PROMPT = `You are the Fundex AI Trading Assistant — an expert on funding rate swaps (FRS) on Solana.

## What is Fundex?
Fundex is a fully on-chain funding rate swap market. Traders can go long or short on perpetual funding rates across 4 perps (BTC, ETH, SOL, JTO) × 4 durations (7D, 30D, 90D, 180D) = 16 markets.

## How FRS works:
- **Fixed Payer (Long)**: Pays fixed rate, receives variable rate → profits when funding rates RISE
- **Fixed Receiver (Short)**: Receives fixed rate, pays variable rate → profits when funding rates FALL (natural hedge for perp longs)
- PnL settles hourly: PnL = (variable_rate − fixed_rate) × notional
- 10% initial margin (10x leverage), 5% maintenance margin
- LP Pool absorbs net imbalance, earns dynamic 0.3–1.0% fees

## Market context:
${(() => {
  // market_stats values are Binance fundingRate as decimal per 8h settlement.
  // Annualize to APR percent: rate * 1095 (8h periods/yr) * 100.
  const per8hToAprPct = (r: number) => r * 1095 * 100;
  const stats = MODEL_DATA.market_stats as Record<string, { current_rate?: number; ma7: number; ma30: number; std30: number }>;
  return Object.entries(stats).map(([m, s]) => {
    return `- ${m}: 7d MA ${per8hToAprPct(s.ma7).toFixed(2)}% APR, 30d MA ${per8hToAprPct(s.ma30).toFixed(2)}% APR, volatility ±${per8hToAprPct(s.std30).toFixed(2)}%`;
  }).join("\n");
})()}

## Guidelines:
- Be concise (2–4 sentences per response unless asked for detail)
- Use plain language, avoid jargon unless the user seems experienced
- When recommending trades, always mention the risk
- You can suggest specific sides (Fixed Payer or Fixed Receiver) and durations
- Reference historical rate stats to support your analysis
- If unsure, say so — never fabricate data
- Format rates as APR percentages for readability
- Do NOT use markdown headers or bullet lists unless the user asks for a detailed breakdown`;

function buildSystemPrompt(ctx?: MarketContext): string {
  if (!ctx) return BASE_SYSTEM_PROMPT;
  const varApr = rateToAprPct(ctx.variableRate);
  const fixApr = rateToAprPct(ctx.fixedRate);
  const total = ctx.payerLots + ctx.receiverLots;
  const payerPct = total > 0 ? ((ctx.payerLots / total) * 100).toFixed(0) : "50";
  return `${BASE_SYSTEM_PROMPT}

## Live market (user is viewing):
- Market: ${ctx.market}-PERP | Duration: ${ctx.duration}D
- Variable rate (oracle): ${varApr.toFixed(2)}% APR
- Fixed rate (market): ${fixApr.toFixed(2)}% APR
- OI: ${ctx.payerLots} payer lots (${payerPct}%) vs ${ctx.receiverLots} receiver lots
- Spread: ${(varApr - fixApr).toFixed(2)}% APR`;
}

export async function POST(req: Request) {
  const { messages, marketContext } = await req.json() as {
    messages: UIMessage[];
    marketContext?: MarketContext;
  };

  const result = streamText({
    model: MODEL_HAIKU,
    system: buildSystemPrompt(marketContext),
    messages: await convertToModelMessages(messages),
    providerOptions: {
      gateway: {
        tags: ["feature:chat"],
        order: [...GATEWAY_FALLBACK_ORDER],
      },
    },
  });

  return result.toUIMessageStreamResponse();
}
