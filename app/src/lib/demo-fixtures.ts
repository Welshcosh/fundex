import { isDemoMode } from "./fundex/demo-mode";

// Deterministic PRNG so the seeded backlog and live ticks look "realistic"
// (clustered, not uniform) and stay stable across re-renders for the same seed.
function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFor(symbol: string): number {
  let h = 2166136261;
  for (let i = 0; i < symbol.length; i++) {
    h ^= symbol.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface MockTrade {
  id: string;
  ts: number;
  side: "long" | "short";
  lots: number;
  rate: number;
}

export function seedRecentTrades(symbol: string, fixedRate: number, count = 16): MockTrade[] {
  const rng = mulberry32(seedFor(symbol));
  const now = Math.floor(Date.now() / 1000);
  const out: MockTrade[] = [];
  for (let i = 0; i < count; i++) {
    const r = rng();
    const side: "long" | "short" = r < 0.52 ? "long" : "short";
    const lots = Math.max(1, Math.round(rng() * 25));
    const drift = (rng() - 0.5) * 0.04;
    const rate = Math.round(fixedRate * (1 + drift));
    out.push({
      id: `seed-${i}`,
      ts: now - i * (3 + Math.round(rng() * 6)),
      side,
      lots,
      rate,
    });
  }
  return out;
}

export function generateOneTrade(symbol: string, fixedRate: number, idx: number): MockTrade {
  const rng = mulberry32(seedFor(symbol) ^ ((idx * 0x9e3779b1) >>> 0));
  const r = rng();
  const side: "long" | "short" = r < 0.52 ? "long" : "short";
  const lots = Math.max(1, Math.round(rng() * 25));
  const drift = (rng() - 0.5) * 0.04;
  const rate = Math.round(fixedRate * (1 + drift));
  return {
    id: `live-${idx}`,
    ts: Math.floor(Date.now() / 1000),
    side,
    lots,
    rate,
  };
}

/**
 * Generate the next chart tick from the previous value, with a small drift
 * and rare ±5% spikes to make the line feel alive (real funding feeds have
 * occasional jumps when leverage flips).
 */
export function generateChartTick(prevRate: number, idx: number): number {
  const rng = mulberry32(((prevRate | 0) * 7919) ^ ((idx * 0x9e3779b1) >>> 0));
  const r = rng();
  const spike = rng() < 0.07; // ~7% chance of bigger move
  const drift = spike
    ? (rng() - 0.5) * 0.10
    : (r - 0.5) * 0.025;
  const next = Math.round(prevRate * (1 + drift));
  return Math.max(500, Math.min(25000, Math.abs(next)));
}

/**
 * Multiplier for order-book row sizes that changes pseudo-randomly with each
 * `idx` tick. Range ~0.55x–1.55x. Pure math (no PRNG state) so it stays cheap
 * inside `useMemo`.
 */
export function bookSizeJitter(rowIndex: number, idx: number): number {
  const k = ((idx + rowIndex * 3) * 13 + rowIndex * 7) % 31;
  return 0.55 + (k / 31) * 1.0;
}

export type Timeframe = "1s" | "15s" | "1m" | "5m" | "1h" | "4h" | "1d";

export const TIMEFRAMES: Timeframe[] = ["1s", "15s", "1m", "5m", "1h", "4h", "1d"];

/** Live timeframes have their last bucket continuously updated by the tick stream. */
export function isLiveTimeframe(tf: Timeframe): boolean {
  return tf === "1s" || tf === "15s";
}

interface TimeframeShape {
  points: number;
  volatility: number;
  trendStrength: number;
}

const TF_CONFIG: Record<Timeframe, TimeframeShape> = {
  "1s": { points: 80, volatility: 0.003, trendStrength: 0.0008 },
  "15s": { points: 80, volatility: 0.008, trendStrength: 0.002 },
  "1m": { points: 80, volatility: 0.014, trendStrength: 0.005 },
  "5m": { points: 80, volatility: 0.022, trendStrength: 0.009 },
  "1h": { points: 72, volatility: 0.038, trendStrength: 0.018 },
  "4h": { points: 64, volatility: 0.062, trendStrength: 0.028 },
  "1d": { points: 60, volatility: 0.105, trendStrength: 0.045 },
};

/**
 * Deterministic price series for a given (symbol, timeframe). Uses a
 * scaled random walk so that the last point exactly equals `currentRate`,
 * preserving the "chart end = current price" exchange convention while
 * keeping the historical shape stable across timeframe toggles.
 */
export function generateTimeframeSeries(
  symbol: string,
  timeframe: Timeframe,
  currentRate: number,
): number[] {
  const cfg = TF_CONFIG[timeframe];
  const safeBase = Math.max(500, Math.abs(currentRate || 1000));
  const seed = seedFor(symbol + ":" + timeframe);
  const rng = mulberry32(seed);

  // Build a cumulative log-walk so the resulting price is always positive.
  const walk: number[] = [0];
  for (let i = 1; i < cfg.points; i++) {
    const trend = (rng() - 0.5) * cfg.trendStrength;
    const noise = (rng() - 0.5) * cfg.volatility;
    walk.push(walk[i - 1] + trend + noise);
  }
  const last = walk[walk.length - 1];
  return walk.map((x) =>
    Math.max(500, Math.min(25000, Math.round(safeBase * Math.exp(x - last)))),
  );
}

export interface DemoCandle {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/**
 * Deterministic OHLCV candles per (symbol, timeframe). Each candle's open
 * equals the previous close (continuity), wicks are sampled around the body
 * with a magnitude proportional to the timeframe volatility, and volume
 * scales with the absolute body size to mimic the trend/volume coupling
 * seen on real exchanges.
 */
export function generateTimeframeCandles(
  symbol: string,
  timeframe: Timeframe,
  currentRate: number,
): DemoCandle[] {
  const cfg = TF_CONFIG[timeframe];
  const safeBase = Math.max(500, Math.abs(currentRate || 1000));
  const seed = seedFor(symbol + ":candles:" + timeframe);
  const rng = mulberry32(seed);

  const walk: number[] = [0];
  for (let i = 1; i < cfg.points; i++) {
    const trend = (rng() - 0.5) * cfg.trendStrength;
    const noise = (rng() - 0.5) * cfg.volatility;
    walk.push(walk[i - 1] + trend + noise);
  }
  const last = walk[walk.length - 1];
  const closes = walk.map((x) =>
    Math.max(500, Math.min(25000, safeBase * Math.exp(x - last))),
  );

  const candles: DemoCandle[] = [];
  for (let i = 0; i < cfg.points; i++) {
    const c = closes[i];
    const o = i === 0
      ? c * (1 + (rng() - 0.5) * cfg.volatility * 0.3)
      : closes[i - 1];
    const bodyTop = Math.max(o, c);
    const bodyBot = Math.min(o, c);
    const wickRange = Math.max(bodyTop - bodyBot, c * cfg.volatility * 0.55);
    const h = bodyTop + wickRange * rng() * 0.65;
    const l = bodyBot - wickRange * rng() * 0.65;

    const moveRatio = bodyTop > 0 ? Math.abs(c - o) / bodyTop : 0;
    const baseVol = 40 + rng() * 80;
    const v = Math.round(baseVol * (1 + moveRatio * 25));

    candles.push({
      o: Math.round(o),
      h: Math.round(h),
      l: Math.round(Math.max(500, l)),
      c: Math.round(c),
      v,
    });
  }
  return candles;
}

const DEMO_VOLUME_24H_USD: Record<string, number> = {
  BTC: 8_420_000,
  ETH: 3_180_000,
  SOL: 2_140_000,
  JTO: 420_000,
};

export function getDemoVolume24h(symbol: string): number | null {
  if (!isDemoMode()) return null;
  const base = DEMO_VOLUME_24H_USD[symbol] ?? 800_000;
  const minutes = Math.floor(Date.now() / 60_000);
  const wobble = Math.sin(minutes / 7) * 0.015 + 1;
  return Math.round(base * wobble);
}
