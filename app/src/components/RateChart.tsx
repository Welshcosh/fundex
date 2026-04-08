"use client";

import { useMemo, useState } from "react";
import { MarketInfo, DurationVariant } from "@/lib/constants";
import { OnchainMarketData } from "@/hooks/useMarketData";
import { useRateHistory, RatePoint } from "@/hooks/useRateHistory";
import { formatRate } from "@/lib/utils";

type ChartType = "line" | "candles";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sma(data: number[], window: number): (number | null)[] {
  return data.map((_, i) =>
    i < window - 1 ? null : data.slice(i - window + 1, i + 1).reduce((a, b) => a + b, 0) / window
  );
}

// ─── Mock fallback (used when no on-chain history yet) ────────────────────────

function generateMockLine(currentRate: number, points: number, seed: number): number[] {
  const out: number[] = [];
  let cur = currentRate;
  let rng = seed;
  for (let i = 0; i < points; i++) {
    rng = (rng * 1664525 + 1013904223) & 0xffffffff;
    cur = Math.max(500, Math.min(25000, cur + ((rng >>> 0) / 0xffffffff - 0.45) * 900));
    out.push(Math.round(cur));
  }
  out[out.length - 1] = currentRate;
  return out;
}

interface Candle { o: number; h: number; l: number; c: number }

function toCandles(data: number[]): Candle[] {
  const size = Math.max(1, Math.floor(data.length / 30));
  const candles: Candle[] = [];
  for (let i = 0; i < data.length; i += size) {
    const slice = data.slice(i, i + size);
    if (!slice.length) continue;
    candles.push({ o: slice[0], h: Math.max(...slice), l: Math.min(...slice), c: slice[slice.length - 1] });
  }
  return candles;
}

// ─── SVG Charts ───────────────────────────────────────────────────────────────

function LineChart({
  actual,
  fixed,
  color,
  gradId,
}: {
  actual: number[];
  fixed: number[];
  color: string;
  gradId: string;
}) {
  const W = 600; const H = 170; const pad = 8;
  const allVals = [...actual, ...fixed].filter(Boolean);
  if (!allVals.length) return null;
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const range = max - min || 1;

  const toCoords = (data: number[]): [number, number][] =>
    data.map((v, i) => [
      (i / Math.max(data.length - 1, 1)) * W,
      pad + (H - pad * 2) - ((v - min) / range) * (H - pad * 2),
    ]);

  const pathStr = (coords: [number, number][]) =>
    "M" + coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L");

  const actualCoords = toCoords(actual);
  const fixedCoords = toCoords(fixed);
  const pathD = pathStr(actualCoords);
  const areaD = pathD + ` L${W},${H} L0,${H} Z`;
  const [lx, ly] = actualCoords[actualCoords.length - 1] ?? [W, H / 2];

  const maVals = sma(actual, Math.min(7, actual.length));
  const maCoords = maVals
    .map((v, i) => (v == null ? null : [actualCoords[i][0], pad + (H - pad * 2) - ((v - min) / range) * (H - pad * 2)] as [number, number]))
    .filter((v): v is [number, number] => v !== null);
  const maPath = maCoords.length > 1 ? pathStr(maCoords) : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#${gradId})`} />
      <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      {/* Fixed rate line */}
      {fixedCoords.length > 1 && (
        <path d={pathStr(fixedCoords)} fill="none" stroke="#c4b5fd" strokeWidth="1"
          strokeDasharray="4,3" opacity="0.6" />
      )}
      {maPath && (
        <path d={maPath} fill="none" stroke="#fbbf24" strokeWidth="1"
          strokeDasharray="3,3" opacity="0.6" />
      )}
      <circle cx={lx} cy={ly} r="3" fill={color} style={{ filter: `drop-shadow(0 0 4px ${color}80)` }} />
    </svg>
  );
}

function CandleChart({ candles, gradId }: { candles: Candle[]; gradId: string }) {
  const W = 600; const H = 170; const pad = 8;
  const allVals = candles.flatMap(c => [c.h, c.l]);
  if (!allVals.length) return null;
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const range = max - min || 1;
  const toY = (v: number) => pad + (H - pad * 2) - ((v - min) / range) * (H - pad * 2);
  const step = W / candles.length;
  const candleW = step * 0.6;

  const closes = candles.map(c => c.c);
  const maVals = sma(closes, Math.min(7, closes.length));
  const maPoints = maVals
    .map((v, i) => v == null ? null : [step * i + step / 2, toY(v)] as [number, number])
    .filter((v): v is [number, number] => v !== null);
  const maPath = maPoints.length > 1
    ? "M" + maPoints.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L")
    : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.03)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>
      {candles.map((c, i) => {
        const cx = step * i + step / 2;
        const bullish = c.c >= c.o;
        const color = bullish ? "#2dd4bf" : "#f87171";
        const bodyTop = toY(Math.max(c.o, c.c));
        const bodyBot = toY(Math.min(c.o, c.c));
        const bodyH = Math.max(1, bodyBot - bodyTop);
        return (
          <g key={i}>
            <line x1={cx} y1={toY(c.h)} x2={cx} y2={toY(c.l)} stroke={color} strokeWidth="0.8" opacity="0.7" />
            <rect x={cx - candleW / 2} y={bodyTop} width={candleW} height={bodyH}
              fill={bullish ? color : "transparent"} stroke={color} strokeWidth="0.8" opacity="0.85" />
          </g>
        );
      })}
      {maPath && (
        <path d={maPath} fill="none" stroke="#fbbf24" strokeWidth="1.2" strokeDasharray="3,2" opacity="0.7" />
      )}
    </svg>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function RateChart({
  market,
  onchainData,
  duration,
}: {
  market: MarketInfo;
  onchainData: OnchainMarketData;
  duration: DurationVariant;
}) {
  const [chartType, setChartType] = useState<ChartType>("line");
  const { points, loading: histLoading } = useRateHistory(market.perpIndex, duration);

  const hasHistory = points.length >= 2;
  const currentRate = onchainData.variableRate;

  // Build chart data from on-chain history or mock fallback
  const { actualData, fixedData, candleData } = useMemo(() => {
    if (hasHistory) {
      const actualData = points.map(p => p.actualRate);
      const fixedData = points.map(p => p.fixedRate);
      const candleData = toCandles(actualData);
      return { actualData, fixedData, candleData };
    }
    // Mock fallback
    const seed = currentRate * 31 + 60;
    const actualData = generateMockLine(currentRate, 60, seed);
    return { actualData, fixedData: [] as number[], candleData: toCandles(actualData) };
  }, [points, hasHistory, currentRate]);

  const lastVal = actualData[actualData.length - 1] ?? currentRate;
  const prevVal = actualData[actualData.length - 2] ?? lastVal;
  const isUp = lastVal >= prevVal;
  const color = isUp ? "#2dd4bf" : "#f87171";
  const gradId = `g${market.perpIndex}${duration}${chartType}`;

  return (
    <div className="px-5 pt-4 pb-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium" style={{ color: "#6b6890" }}>Funding Rate</span>
          <span className="text-xs font-mono font-semibold" style={{ color }}>
            {isUp ? "▲" : "▼"} {formatRate(lastVal)}
          </span>
          {onchainData.live && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ background: "rgba(45,212,191,0.1)", color: "#2dd4bf" }}>
              LIVE
            </span>
          )}
          {histLoading && (
            <span className="w-2.5 h-2.5 border border-white/20 border-t-white/60 rounded-full animate-spin" />
          )}
          {!hasHistory && !histLoading && (
            <span className="text-[10px]" style={{ color: "#4a4568" }}>preview</span>
          )}
          {/* Legend */}
          <span className="text-[10px] flex items-center gap-1" style={{ color: "#fbbf24", opacity: 0.7 }}>
            <span className="inline-block w-4 border-t border-dashed" style={{ borderColor: "#fbbf24" }} />
            MA7
          </span>
          {hasHistory && fixedData.length > 0 && (
            <span className="text-[10px] flex items-center gap-1" style={{ color: "#c4b5fd", opacity: 0.7 }}>
              <span className="inline-block w-4 border-t border-dashed" style={{ borderColor: "#c4b5fd" }} />
              Fixed
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg"
            style={{ background: "rgba(255,255,255,0.03)" }}>
            {(["line", "candles"] as ChartType[]).map((t) => (
              <button key={t} onClick={() => setChartType(t)}
                className="px-2.5 py-1 rounded-md text-xs font-medium transition-all capitalize"
                style={{
                  background: chartType === t ? "rgba(153,69,255,0.2)" : "transparent",
                  color: chartType === t ? "#c4b5fd" : "#4a4568",
                }}>
                {t === "line" ? "Line" : "Candles"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart */}
      <div style={{ height: "170px" }}>
        {chartType === "line"
          ? <LineChart actual={actualData} fixed={fixedData} color={color} gradId={gradId} />
          : <CandleChart candles={candleData} gradId={gradId} />}
      </div>
    </div>
  );
}
