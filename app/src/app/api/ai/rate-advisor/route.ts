import { NextRequest, NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import type * as ort from "onnxruntime-node";
import { join } from "path";

// Lazy-loaded so a missing native binary (happens on some serverless targets)
// falls back to Logistic-only inference instead of crashing the module.
let ortModulePromise: Promise<typeof ort | null> | null = null;
function loadOrt(): Promise<typeof ort | null> {
  if (!ortModulePromise) {
    ortModulePromise = import("onnxruntime-node").catch((e) => {
      console.warn("onnxruntime-node unavailable, falling back to Logistic:", e instanceof Error ? e.message : e);
      return null;
    });
  }
  return ortModulePromise;
}
import MODEL_DATA from "@/lib/fundex/rate-model.json";
import { MODEL_HAIKU, GATEWAY_FALLBACK_ORDER } from "@/lib/fundex/ai-models";
import { rateToAprPct, truncateError } from "@/lib/utils";

const ReasoningSchema = z.object({
  reasoning: z.string(),
});

const globalForAdvisor = globalThis as unknown as {
  __fundexAdvisorCache?: Map<string, { value: RateAdvisorOutput; expiresAt: number }>;
};
const advisorCache = globalForAdvisor.__fundexAdvisorCache ?? new Map<string, { value: RateAdvisorOutput; expiresAt: number }>();
globalForAdvisor.__fundexAdvisorCache = advisorCache;
const ADVISOR_TTL_MS = 15 * 60 * 1000;

export interface RateAdvisorInput {
  market: "BTC" | "ETH" | "SOL" | "JTO";
  duration: 7 | 30 | 90 | 180;
  currentOracleRate: number;   // Fundex precision (1e6 = 100% per hour interval)
}

export interface RateAdvisorOutput {
  predictedRatePerHour: number;
  recommendedFixedRate: number;
  direction: "up" | "down" | "neutral";
  confidence: "high" | "medium" | "low";
  dirAccuracy: number;
  reasoning: string;
}

// ── JS inference helpers ─────────────────────────────────────────────────────

const MARKET_LIST = ["BTC", "ETH", "SOL"];

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
  has_onnx?: boolean;
  onnx_file?: string;
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

/** Build the v2 feature vector (24 features). */
function buildFeatures(
  currentApy: number,
  ms: { ma7: number; ma30: number; std30: number },
  market: string,
  btcMs: { ma7: number; ma30: number; std30: number; current_rate: number },
  extra: { fng_current: number; fng_ma7: number; btc_price: number },
): number[] {
  const { ma7, ma30, std30 } = ms;
  const std7 = std30 * 0.7 + 1e-9;

  const z7   = (currentApy - ma7)  / std7;
  const z30  = (currentApy - ma30) / (std30 + 1e-9);
  const mom5 = 0;
  const mom14 = 0;
  const lag1 = 0; const lag3 = 0; const lag7 = 0;
  const volRatio = std7 / (std30 + 1e-9);
  const trend = (ma7 - ma30) / (ma30 + 1e-9);
  const accel = 0;

  const logCur = Math.log(Math.abs(currentApy) + 1e-6) * Math.sign(currentApy);

  const btcMom1 = (btcMs.current_rate - btcMs.ma7) / (Math.abs(btcMs.ma7) + 1e-9);
  const btcMom7 = btcMom1;
  const btcZ30  = (btcMs.current_rate - btcMs.ma30) / (btcMs.std30 + 1e-9);

  // BTC price momentum (approximate from extra data)
  const priceRet7  = 0;  // no historical price series — neutral
  const priceRet30 = 0;
  const priceVol30 = 0;

  // Fear & Greed
  const fngNorm  = (extra.fng_current - 50) / 50.0;
  const fngTrend = (extra.fng_current - extra.fng_ma7) / 100.0;

  const base = [
    logCur, z7, z30, mom5, mom14,
    volRatio, trend, lag1, lag3, lag7,
    std7 / (Math.abs(currentApy) + 1e-9), std30 / (Math.abs(currentApy) + 1e-9), accel,
    btcMom1, btcMom7, btcZ30,
    priceRet7, priceRet30, priceVol30,
    fngNorm, fngTrend,
  ];

  const ohe = MARKET_LIST.map((m) => (m === market ? 1 : 0));
  return [...base, ...ohe];
}

interface Prediction {
  predictedDrift: number;
  direction: "up" | "down" | "neutral";
  confidence: "high" | "medium" | "low";
  dirAccuracy: number;
}

// ── ONNX LightGBM inference ────────────────────────────────────────────────

const onnxSessions: Record<string, ort.InferenceSession> = {};

async function getOnnxSession(duration: number): Promise<ort.InferenceSession | null> {
  const key = String(duration);
  if (onnxSessions[key]) return onnxSessions[key];

  const models = MODEL_DATA.models as Record<string, EnsembleModel | StatModel>;
  const model = models[key];
  if (!model || model.type !== "ensemble" || !(model as EnsembleModel).has_onnx) return null;

  const ortModule = await loadOrt();
  if (!ortModule) return null;

  try {
    const onnxFile = (model as EnsembleModel).onnx_file!;
    const onnxPath = join(process.cwd(), "src/lib/fundex", onnxFile);
    const session = await ortModule.InferenceSession.create(onnxPath);
    onnxSessions[key] = session;
    return session;
  } catch (e) {
    console.warn("ONNX load failed, falling back to Logistic:", e instanceof Error ? e.message : e);
    return null;
  }
}

async function runLgbInference(session: ort.InferenceSession, feat: number[]): Promise<number> {
  const ortModule = await loadOrt();
  if (!ortModule) return 0.5;
  const inputTensor = new ortModule.Tensor("float32", Float32Array.from(feat), [1, feat.length]);
  const results = await session.run({ input: inputTensor });
  // LightGBM ONNX outputs: "label" (int64) and "probabilities" (float32 [1, 2])
  const probKey = Object.keys(results).find(k => k.includes("prob")) ?? "probabilities";
  const probs = results[probKey];
  if (probs && probs.data) {
    const data = probs.data as Float32Array;
    return data[1];  // P(class=1) = P(up)
  }
  return 0.5;
}

// ── Ensemble with ONNX ──────────────────────────────────────────────────────

async function runEnsemble(
  model: EnsembleModel,
  feat: number[],
  currentDrift: number,
  duration: number,
): Promise<Prediction> {
  const scaled = scaleFeatures(feat, model.scaler_mean, model.scaler_std);

  // Ridge → log-ratio → predicted rate (same unit as currentDrift).
  // Sign-preserving multiplicative update so negative rates can stay negative.
  const logRatio = dotProduct(scaled, model.ridge_coef) + model.ridge_intercept;
  const predictedDrift = Math.round(currentDrift * Math.exp(logRatio));

  // Logistic → P(up)
  const logit = dotProduct(scaled, model.logit_coef) + model.logit_intercept;
  const pLogistic = sigmoid(logit);

  // LightGBM → P(up) via ONNX (best effort; falls back to logistic if ONNX fails)
  let pLgb = pLogistic;
  const session = await getOnnxSession(duration);
  if (session) {
    try {
      pLgb = await runLgbInference(session, feat);
    } catch (e) {
      console.warn("ONNX inference failed, using logistic only:", e instanceof Error ? e.message : e);
    }
  }

  // Average classifier probabilities
  const pAvg = (pLogistic + pLgb) / 2;
  const conf = Math.max(pAvg, 1 - pAvg);

  const ridgeDir = logRatio > 0 ? "up" : "down";
  const clsDir = pAvg >= 0.5 ? "up" : "down";

  let direction: "up" | "down" | "neutral";
  let confidence: "high" | "medium" | "low";

  if (conf >= (model.threshold ?? 0.70) && ridgeDir === clsDir) {
    direction  = ridgeDir;
    confidence = conf >= 0.75 ? "high" : "medium";
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
  currentRatePer8h: number   // decimal per 8h (matches training units)
): Prediction {
  const stats = model.market_stats[market] ?? model.market_stats["BTC"];
  const predictedRatePer8h = stats.recent_mean * 0.6 + stats.mean * 0.4;
  const direction: "up" | "down" | "neutral" =
    predictedRatePer8h > currentRatePer8h * 1.05 ? "up"
    : predictedRatePer8h < currentRatePer8h * 0.95 ? "down"
    : "neutral";
  return {
    // Convert decimal-per-8h to Fundex 1e6/1h precision: (per8h / 8) × 1e6.
    predictedDrift: Math.round((predictedRatePer8h / 8) * 1_000_000),
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

    // Bucket at 100 Fundex units (~0.01% per hour, ~88% APR granularity).
    const bucketedRate = Math.round(currentOracleRate / 100) * 100;
    const cacheKey = `v2|${market}|${duration}|${bucketedRate}`;
    const cached = advisorCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.value satisfies RateAdvisorOutput);
    }

    const baseMarket = market === "JTO" ? "SOL" : market;

    // Training features use "decimal per 8h" — Binance fundingRate raw format.
    // Fundex now stores 1e6/1h precision (settles hourly), so convert per-hour
    // Fundex rate to per-8h decimal: (rate × 8) / 1_000_000.
    const currentRatePer8h = (currentOracleRate * 8) / 1_000_000;

    const allStats = MODEL_DATA.market_stats as unknown as Record<string, {
      current_rate: number; ma7: number; ma30: number; std30: number;
    }>;
    const ms    = allStats[baseMarket] ?? allStats["BTC"];
    const btcMs = allStats["BTC"];
    const extra = MODEL_DATA.extra as { fng_current: number; fng_ma7: number; btc_price: number };

    const feat = buildFeatures(currentRatePer8h, ms, baseMarket, btcMs, extra);

    const models = MODEL_DATA.models as Record<string, EnsembleModel | StatModel>;
    const model  = models[String(duration)];

    let pred: Prediction;
    if (model.type === "ensemble") {
      // runEnsemble uses currentDrift only as a ratio multiplier (exp(logRatio)),
      // so passing Fundex units in means Fundex units out.
      pred = await runEnsemble(model as EnsembleModel, feat, currentOracleRate, duration);
    } else {
      pred = runStat(model as StatModel, baseMarket, currentRatePer8h);
    }

    const predictedFundex = pred.predictedDrift;
    const { direction, confidence, dirAccuracy } = pred;

    // Display values for the LLM prompt — correct Fundex unit math.
    const currentAprDisplay = rateToAprPct(currentOracleRate);
    const predictedAprDisplay = rateToAprPct(predictedFundex);

    const prompt = `You are a DeFi funding rate advisor for Fundex on Solana.

Market: ${market}-PERP | Duration: ${duration}d
Current oracle rate: ${currentAprDisplay.toFixed(2)}% APR
Historical ${baseMarket} stats (Binance perp funding rates, per-8h decimal):
  7d MA: ${ms.ma7.toFixed(6)}  |  30d MA: ${ms.ma30.toFixed(6)}  |  30d StdDev: ±${ms.std30.toFixed(6)}
Fear & Greed Index: ${extra.fng_current}/100
ML ensemble prediction (Ridge + Logistic + LightGBM):
  Direction: ${direction}  |  Confidence: ${confidence}  |  Historical dir accuracy: ${(dirAccuracy * 100).toFixed(0)}%
  Predicted avg rate over ${duration}d: ${predictedAprDisplay.toFixed(2)}% APR
  Recommended fixed rate: ${predictedAprDisplay.toFixed(2)}% APR

Write 1–2 sentences (max 80 chars each) explaining: why this rate/direction and what drives it.`;

    const { output } = await generateText({
      model: MODEL_HAIKU,
      prompt,
      output: Output.object({ schema: ReasoningSchema }),
      providerOptions: {
        gateway: {
          tags: ["feature:advisor"],
          order: [...GATEWAY_FALLBACK_ORDER],
          cacheControl: "max-age=120",
        },
      },
    });
    const reasoning = truncateError(output.reasoning.trim(), 280);

    const result: RateAdvisorOutput = {
      predictedRatePerHour: predictedFundex,
      recommendedFixedRate: predictedFundex,
      direction,
      confidence,
      dirAccuracy,
      reasoning,
    };
    advisorCache.set(cacheKey, { value: result, expiresAt: Date.now() + ADVISOR_TTL_MS });
    return NextResponse.json(result satisfies RateAdvisorOutput);
  } catch (e) {
    console.error("Rate advisor error:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Rate advisor unavailable" }, { status: 500 });
  }
}
