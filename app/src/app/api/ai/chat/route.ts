import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import MODEL_DATA from "@/lib/fundex/rate-model.json";

const SYSTEM_PROMPT = `You are the Fundex AI Trading Assistant — an expert on funding rate swaps (FRS) on Solana.

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
  const stats = MODEL_DATA.market_stats as Record<string, { current_rate?: number; ma7: number; ma30: number; std30: number }>;
  return Object.entries(stats).map(([m, s]) => {
    return `- ${m}: 7d MA ${s.ma7.toFixed(2)}% APY, 30d MA ${s.ma30.toFixed(2)}% APY, volatility ±${s.std30.toFixed(2)}%`;
  }).join("\n");
})()}

## Guidelines:
- Be concise (2–4 sentences per response unless asked for detail)
- Use plain language, avoid jargon unless the user seems experienced
- When recommending trades, always mention the risk
- You can suggest specific sides (Fixed Payer or Fixed Receiver) and durations
- Reference historical rate stats to support your analysis
- If unsure, say so — never fabricate data
- Format rates as APY percentages for readability
- Do NOT use markdown headers or bullet lists unless the user asks for a detailed breakdown`;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "AI unavailable" }, { status: 500 });
    }
    const client = new Anthropic({ apiKey });

    const { messages, marketContext } = await req.json() as {
      messages: ChatMessage[];
      marketContext?: {
        market: string;
        duration: number;
        variableRate: number;
        fixedRate: number;
        payerLots: number;
        receiverLots: number;
      };
    };

    // Inject live market data if available
    let systemPrompt = SYSTEM_PROMPT;
    if (marketContext) {
      const varApy = (marketContext.variableRate / 1_000_000) * 0.0001 * 24 * 365;
      const fixApy = (marketContext.fixedRate / 1_000_000) * 0.0001 * 24 * 365;
      const total = marketContext.payerLots + marketContext.receiverLots;
      const payerPct = total > 0 ? ((marketContext.payerLots / total) * 100).toFixed(0) : "50";
      systemPrompt += `\n\n## Live market (user is viewing):
- Market: ${marketContext.market}-PERP | Duration: ${marketContext.duration}D
- Variable rate (oracle): ${varApy.toFixed(4)}% APY
- Fixed rate (market): ${fixApy.toFixed(4)}% APY
- OI: ${marketContext.payerLots} payer lots (${payerPct}%) vs ${marketContext.receiverLots} receiver lots
- Spread: ${(varApy - fixApy).toFixed(4)}% APY`;
    }

    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });

    const text = msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
    return NextResponse.json({ reply: text });
  } catch (e) {
    console.error("Chat error:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Chat unavailable" }, { status: 500 });
  }
}
