import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import MODEL_DATA from "@/lib/fundex/rate-model.json";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export interface RateAdvisorInput {
  market: "BTC" | "ETH" | "SOL" | "JTO";
  duration: 7 | 30 | 90 | 180;
  currentOracleRate: number;   // Drift precision (1e6 = 0.0001%/hr)
}

export interface RateAdvisorOutput {
  predictedRatePerHour: number;   // Drift precision
  recommendedFixedRate: number;   // Drift precision
  direction: "up" | "down" | "neutral";
  confidence: "high" | "medium" | "low";
  dirAccuracy: number;            // historical directional accuracy (0–1)
  reasoning: string;
}

// ── JS inference helpers ─────────────────────────────────────────────────────

const MARKET_LIST = ["BTC", "ETH", "SOL"];
const THRESHOLD   = (MODEL_DATA as { ensemble_threshold: number }).ensemble_threshold ?? 0.65;

type EnsembleModel = {
  type: "ensemble";
  scaler_mean: number[];
  scaler_std: number[];
  ridge_coef: number[];
  ridge_intercept: number;
  logit_coef: number[];
  logit_intercept: number;
  threshold: number;
  ridge_skill: number;
  ensemble_dir_acc: number;
};

type StatModel = {
  type: "stat";
  market_stats: Record<string, { mean: number; std: number; recent_mean: number; recent_std: number }>;
};

function sigmoid(x: number) { return 1 / (1 + Math.exp(-x)); }

function scaleFeatures(feat: number[], mean: number[], std: number[]) {
  return feat.map((v, i) => (v - mean[i]) / (std[i] + 1e-9));
}

function dotProduct(a: number[], b: number[]) {
  return a.reduce((s, v, i) => s + v * b[i], 0);
}

/** Build the same feature vector as the Python training script. */
function buildFeatures(
  currentApy: number,
  ms: { ma7: number; ma30: number; std30: number },
  market: string,
  btcMs: { ma7: number; ma30: number; std30: number; current_rate: number }
): number[] {
  const { ma7, ma30, std30 } = ms;
  const std7 = std30 * 0.7 + 1e-9;

  const z7   = (currentApy - ma7)  / std7;
  const z30  = (currentApy - ma30) / (std30 + 1e-9);
  const mom5 = 0;    // can't compute without time series — neutral
  const mom14 = 0;
  const lag1 = 0; const lag3 = 0; const lag7 = 0;
  const volRatio = std7 / (std30 + 1e-9);
  const trend = (ma7 - ma30) / (ma30 + 1e-9);
  const accel = 0;

  const btcMom1 = (btcMs.current_rate - btcMs.ma7) / (btcMs.ma7 + 1e-9);
  const btcMom7 = btcMom1;
  const btcZ30  = (btcMs.current_rate - btcMs.ma30) / (btcMs.std30 + 1e-9);

  const base = [
    Math.log(currentApy + 0.01), z7, z30, mom5, mom14,
    volRatio, trend, lag1, lag3, lag7,
    std7 / (currentApy + 1e-9), std30 / (currentApy + 1e-9), accel,
    btcMom1, btcMom7, btcZ30,
  ];

  const ohe = MARKET_LIST.map((m) => (m === market ? 1 : 0));
  return [...base, ...ohe];
}

function driftToApy(drift: number): number {
  // Drift: 1_000_000 = 0.0001%/hr → annualized APY
  return (drift / 1_000_000) * 0.0001 * 24 * 365;
}
function apyToDrift(apy: number): number {
  return Math.round((apy / (24 * 365)) / 0.0001 * 1_000_000);
}

interface Prediction {
  predictedDrift: number;
  direction: "up" | "down" | "neutral";
  confidence: "high" | "medium" | "low";
  dirAccuracy: number;
}

function runEnsemble(
  model: EnsembleModel,
  feat: number[],
  currentDrift: number
): Prediction {
  const scaled = scaleFeatures(feat, model.scaler_mean, model.scaler_std);

  // Ridge → log-ratio → predicted drift
  const logRatio = dotProduct(scaled, model.ridge_coef) + model.ridge_intercept;
  const predictedDrift = Math.max(0, Math.round(currentDrift * Math.exp(logRatio)));

  // Logistic → P(up)
  const logit = dotProduct(scaled, model.logit_coef) + model.logit_intercept;
  const pUp = sigmoid(logit);
  const conf = Math.max(pUp, 1 - pUp);

  const ridgeDir = logRatio > 0 ? "up" : "down";
  const logitDir = pUp >= 0.5 ? "up" : "down";

  let direction: "up" | "down" | "neutral";
  let confidence: "high" | "medium" | "low";

  if (conf >= (model.threshold ?? THRESHOLD) && ridgeDir === logitDir) {
    direction  = ridgeDir;
    confidence = conf >= 0.70 ? "high" : "medium";
  } else {
    direction  = "neutral";
    confidence = "low";
  }

  return {
    predictedDrift,
    direction,
    confidence,
    dirAccuracy: model.ensemble_dir_acc,
  };
}

function runStat(
  model: StatModel,
  market: string,
  currentDrift: number
): Prediction {
  const stats = model.market_stats[market] ?? model.market_stats["BTC"];
  const currentApy = driftToApy(currentDrift);
  // Blend recent + long-term mean
  const predictedApy = stats.recent_mean * 0.6 + stats.mean * 0.4;
  const direction: "up" | "down" | "neutral" =
    predictedApy > currentApy * 1.05 ? "up"
    : predictedApy < currentApy * 0.95 ? "down"
    : "neutral";
  return {
    predictedDrift: apyToDrift(predictedApy),
    direction,
    confidence: "low",
    dirAccuracy: 0.5,
  };
}

// ── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const input: RateAdvisorInput = await req.json();
    const { market, duration, currentOracleRate } = input;

    const baseMarket = market === "JTO" ? "SOL" : market;
    const currentApy = driftToApy(currentOracleRate);

    const allStats = MODEL_DATA.market_stats as unknown as Record<string, {
      current_rate: number; ma7: number; ma30: number; std30: number;
    }>;
    const ms     = allStats[baseMarket] ?? allStats["BTC"];
    const btcMs  = allStats["BTC"];

    const feat = buildFeatures(currentApy, ms, baseMarket, btcMs);

    const models = MODEL_DATA.models as Record<string, EnsembleModel | StatModel>;
    const model  = models[String(duration)];

    let pred: Prediction;
    if (model.type === "ensemble") {
      pred = runEnsemble(model, feat, currentOracleRate);
    } else {
      pred = runStat(model as StatModel, baseMarket, currentOracleRate);
    }

    const { predictedDrift, direction, confidence, dirAccuracy } = pred;

    // Claude: explain the recommendation
    const prompt = `You are a DeFi funding rate advisor for Fundex on Solana.

Market: ${market}-PERP | Duration: ${duration}d
Current oracle rate: ${currentApy.toFixed(4)}% APY
Historical ${baseMarket} stats (DeFiLlama GMX perps, winsorized):
  7d MA: ${ms.ma7.toFixed(2)}%  |  30d MA: ${ms.ma30.toFixed(2)}%  |  30d StdDev: ±${ms.std30.toFixed(2)}%
ML ensemble prediction:
  Direction: ${direction}  |  Confidence: ${confidence}  |  Historical dir accuracy: ${(dirAccuracy * 100).toFixed(0)}%
  Predicted avg rate over ${duration}d: ${driftToApy(predictedDrift).toFixed(4)}% APY
  Recommended fixed rate: ${driftToApy(predictedDrift).toFixed(4)}% APY

Write 1–2 sentences (max 80 chars each) explaining: why this rate/direction and what drives it.
Respond ONLY with JSON: {"reasoning": "<explanation>"}`;

    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      messages: [{ role: "user", content: prompt }],
    });

    const raw  = msg.content[0].type === "text" ? msg.content[0].text.trim() : "{}";
    const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const { reasoning } = JSON.parse(text) as { reasoning: string };

    return NextResponse.json({
      predictedRatePerHour:  predictedDrift,
      recommendedFixedRate:  predictedDrift,
      direction,
      confidence,
      dirAccuracy,
      reasoning,
    } satisfies RateAdvisorOutput);
  } catch (e) {
    console.error("Rate advisor error:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Rate advisor unavailable" }, { status: 500 });
  }
}
