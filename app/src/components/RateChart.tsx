"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MarketInfo, DurationVariant } from "@/lib/constants";
import { OnchainMarketData } from "@/hooks/useMarketData";
import { useRateHistory } from "@/hooks/useRateHistory";
import { formatRate } from "@/lib/utils";
import { isDemoMode } from "@/lib/fundex/demo-mode";
import {
  generateChartTick,
  generateTimeframeSeries,
  generateTimeframeCandles,
  isLiveTimeframe,
  TIMEFRAMES,
  type Timeframe,
  type DemoCandle,
} from "@/lib/demo-fixtures";

const DEMO_TICK_WINDOW = 80;

const TF_SECONDS: Record<Timeframe, number> = {
  "1s": 1, "15s": 15, "1m": 60, "5m": 300, "1h": 3600, "4h": 14400, "1d": 86400,
};

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function formatTimeLabel(ts: number, tf: Timeframe): string {
  const d = new Date(ts * 1000);
  if (tf === "1d") return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
  if (tf === "4h" || tf === "1h")
    return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}h`;
  if (tf === "5m" || tf === "1m") return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function computeTimeLabels(candleCount: number, timeframe: Timeframe, count: number) {
  const sec = TF_SECONDS[timeframe];
  const now = Math.floor(Date.now() / 1000);
  const out: { idx: number; text: string }[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.round((i / Math.max(count - 1, 1)) * Math.max(candleCount - 1, 1));
    const ts = now - (candleCount - 1 - idx) * sec;
    out.push({ idx, text: formatTimeLabel(ts, timeframe) });
  }
  return out;
}

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

function CandleChart({
  candles,
  gradId,
  timeframe,
  mounted,
}: {
  candles: DemoCandle[];
  gradId: string;
  timeframe: Timeframe;
  mounted: boolean;
}) {
  const W = 600;
  const H = 200;
  const PRICE_TOP = 4;
  const PRICE_BOT = 130;
  const VOL_TOP = 142;
  const VOL_BOT = 184;
  const TIME_Y = 196;

  const allHL = candles.flatMap((c) => [c.h, c.l]);
  if (!allHL.length) return null;
  const min = Math.min(...allHL);
  const max = Math.max(...allHL);
  const range = max - min || 1;
  const toY = (v: number) =>
    PRICE_TOP + (PRICE_BOT - PRICE_TOP) - ((v - min) / range) * (PRICE_BOT - PRICE_TOP);

  const maxVol = Math.max(...candles.map((c) => c.v), 1);
  const toVolH = (v: number) => (v / maxVol) * (VOL_BOT - VOL_TOP);

  const step = W / candles.length;
  const candleW = Math.max(1, step * 0.65);

  const closes = candles.map((c) => c.c);
  const maVals = sma(closes, Math.min(7, closes.length));
  const maPoints = maVals
    .map((v, i) => (v == null ? null : ([step * i + step / 2, toY(v)] as [number, number])))
    .filter((v): v is [number, number] => v !== null);
  const maPath =
    maPoints.length > 1
      ? "M" + maPoints.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L")
      : null;

  const gridLevels = [min, min + range / 3, min + (range * 2) / 3, max];
  const timeLabels = mounted ? computeTimeLabels(candles.length, timeframe, 5) : [];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.02)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>

      {/* Price grid */}
      {gridLevels.map((p, i) => (
        <g key={`grid-${i}`}>
          <line
            x1={0}
            y1={toY(p)}
            x2={W}
            y2={toY(p)}
            stroke="rgba(255,255,255,0.04)"
            strokeWidth="0.5"
            strokeDasharray="2,3"
          />
          <text
            x={W - 2}
            y={toY(p) - 1.5}
            fill="#3a3856"
            fontSize="7.5"
            textAnchor="end"
            fontFamily="ui-monospace, SFMono-Regular, monospace"
          >
            {formatRate(Math.round(p))}
          </text>
        </g>
      ))}

      {/* Candles */}
      {candles.map((c, i) => {
        const cx = step * i + step / 2;
        const bullish = c.c >= c.o;
        const color = bullish ? "#2dd4bf" : "#f87171";
        const bodyTop = toY(Math.max(c.o, c.c));
        const bodyBot = toY(Math.min(c.o, c.c));
        const bodyH = Math.max(1, bodyBot - bodyTop);
        return (
          <g key={`c-${i}`}>
            <line
              x1={cx}
              y1={toY(c.h)}
              x2={cx}
              y2={toY(c.l)}
              stroke={color}
              strokeWidth="0.8"
              opacity="0.85"
            />
            <rect
              x={cx - candleW / 2}
              y={bodyTop}
              width={candleW}
              height={bodyH}
              fill={bullish ? color : "transparent"}
              stroke={color}
              strokeWidth="0.8"
              opacity="0.9"
            />
          </g>
        );
      })}

      {/* MA overlay */}
      {maPath && (
        <path
          d={maPath}
          fill="none"
          stroke="#fbbf24"
          strokeWidth="1.2"
          strokeDasharray="3,2"
          opacity="0.7"
        />
      )}

      {/* Volume separator + label */}
      <line
        x1={0}
        y1={VOL_TOP - 6}
        x2={W}
        y2={VOL_TOP - 6}
        stroke="rgba(255,255,255,0.05)"
        strokeWidth="0.5"
      />
      <text
        x={2}
        y={VOL_TOP - 1.5}
        fill="#3a3856"
        fontSize="7"
        textAnchor="start"
        fontFamily="ui-monospace, SFMono-Regular, monospace"
      >
        Vol
      </text>

      {/* Volume bars */}
      {candles.map((c, i) => {
        const cx = step * i + step / 2;
        const bullish = c.c >= c.o;
        const color = bullish ? "#2dd4bf" : "#f87171";
        const h = toVolH(c.v);
        return (
          <rect
            key={`v-${i}`}
            x={cx - candleW / 2}
            y={VOL_BOT - h}
            width={candleW}
            height={h}
            fill={color}
            opacity="0.4"
          />
        );
      })}

      {/* Time labels */}
      {timeLabels.map((label, i) => (
        <text
          key={`t-${i}`}
          x={(label.idx / Math.max(candles.length - 1, 1)) * W}
          y={TIME_Y}
          fill="#3a3856"
          fontSize="7.5"
          textAnchor={i === 0 ? "start" : i === timeLabels.length - 1 ? "end" : "middle"}
          fontFamily="ui-monospace, SFMono-Regular, monospace"
        >
          {label.text}
        </text>
      ))}
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
  const [timeframe, setTimeframe] = useState<Timeframe>("1s");
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const { points, loading: histLoading } = useRateHistory(market.perpIndex, duration);

  const hasHistory = points.length >= 2;
  const currentRate = onchainData.variableRate;
  const fixedRateNow = onchainData.fixedRate;

  // Live demo ticks — append to the right edge so the chart visibly "trades".
  // ref pattern avoids restarting the timer every 60s when currentRate refreshes.
  const [liveTicks, setLiveTicks] = useState<number[]>([]);
  const currentRateRef = useRef(currentRate);
  useEffect(() => { currentRateRef.current = currentRate; }, [currentRate]);

  useEffect(() => { setLiveTicks([]); }, [market.perpIndex, duration]);

  useEffect(() => {
    if (!isDemoMode() || !onchainData.live) return;
    let cancelled = false;
    let counter = 0;
    let timer = 0;
    const tick = () => {
      if (cancelled) return;
      counter += 1;
      setLiveTicks((prev) => {
        const last = prev[prev.length - 1] ?? currentRateRef.current ?? 1000;
        const next = generateChartTick(last, counter);
        return [...prev, next].slice(-DEMO_TICK_WINDOW);
      });
      timer = window.setTimeout(tick, 1200 + Math.random() * 1500);
    };
    timer = window.setTimeout(tick, 1200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [onchainData.live, market.perpIndex, duration]);

  // Build chart data:
  //   • Live timeframes (1s/15s) → real on-chain history + appended demo ticks
  //   • Higher timeframes        → deterministic mock series scaled to currentRate
  const { actualData, fixedData, candleData } = useMemo(() => {
    let actualData: number[];
    let fixedData: number[];

    if (isLiveTimeframe(timeframe)) {
      if (hasHistory) {
        actualData = points.map((p) => p.actualRate);
        fixedData = points.map((p) => p.fixedRate);
      } else {
        const seed = currentRate * 31 + 60;
        actualData = generateMockLine(currentRate, 60, seed);
        fixedData = [];
      }
      if (liveTicks.length > 0) {
        const lastFixed = fixedData[fixedData.length - 1];
        actualData = [...actualData, ...liveTicks].slice(-DEMO_TICK_WINDOW);
        if (lastFixed !== undefined) {
          // Hold the latest fixed rate flat across the new ticks (fixed updates
          // only at settlement, not at every tick — keeps the dashed line honest).
          fixedData = [...fixedData, ...new Array(liveTicks.length).fill(lastFixed)].slice(-DEMO_TICK_WINDOW);
        }
      }
    } else {
      actualData = generateTimeframeSeries(market.symbol, timeframe, currentRate || 1000);
      fixedData = fixedRateNow > 0 ? new Array(actualData.length).fill(fixedRateNow) : [];
    }

    // Candles are sourced from a dedicated OHLCV generator so wicks and volume
    // are meaningful (using `toCandles(actualData)` would flatten wicks since
    // adjacent closes in our line series are usually near-monotonic).
    const candleData = generateTimeframeCandles(market.symbol, timeframe, currentRate || 1000);
    return { actualData, fixedData, candleData };
  }, [timeframe, points, hasHistory, currentRate, liveTicks, market.symbol, fixedRateNow]);

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
          {/* Timeframe selector — DEX classic */}
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg overflow-x-auto"
            style={{ background: "rgba(255,255,255,0.03)" }}>
            {TIMEFRAMES.map((tf) => {
              const active = timeframe === tf;
              const live = isLiveTimeframe(tf);
              return (
                <button key={tf} onClick={() => setTimeframe(tf)}
                  className="px-2 py-1 rounded-md text-[11px] font-medium transition-all flex items-center gap-1"
                  style={{
                    background: active ? "rgba(45,212,191,0.18)" : "transparent",
                    color: active ? "#2dd4bf" : "#4a4568",
                  }}>
                  {tf}
                  {live && active && (
                    <span className="w-1 h-1 rounded-full" style={{ background: "#2dd4bf" }} />
                  )}
                </button>
              );
            })}
          </div>

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
      <div style={{ height: chartType === "candles" ? "210px" : "170px" }}>
        {chartType === "line"
          ? <LineChart actual={actualData} fixed={fixedData} color={color} gradId={gradId} />
          : <CandleChart candles={candleData} gradId={gradId} timeframe={timeframe} mounted={mounted} />}
      </div>
    </div>
  );
}
