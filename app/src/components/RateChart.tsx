"use client";

import { useMemo, useState } from "react";
import { MarketInfo } from "@/lib/constants";
import { OnchainMarketData } from "@/hooks/useMarketData";
import { formatRate } from "@/lib/utils";

type Timeframe = "1H" | "4H" | "8H" | "1D";
const TF_POINTS: Record<Timeframe, number> = { "1H": 12, "4H": 24, "8H": 48, "1D": 96 };

function generateData(currentRate: number, points: number, seed: number) {
  const out: number[] = [];
  // Walk backwards from currentRate so the last point = currentRate
  let cur = currentRate;
  let rng = seed;
  for (let i = 0; i < points; i++) {
    rng = (rng * 1664525 + 1013904223) & 0xffffffff;
    cur = Math.max(500, Math.min(25000, cur + ((rng >>> 0) / 0xffffffff - 0.45) * 900));
    out.push(Math.round(cur));
  }
  // Pin the last point to exact currentRate
  out[out.length - 1] = currentRate;
  return out;
}

export function RateChart({ market, onchainData }: { market: MarketInfo; onchainData: OnchainMarketData }) {
  const [tf, setTf] = useState<Timeframe>("8H");
  const pts = TF_POINTS[tf];

  // Use real variableRate as current; seed changes when rate changes so chart updates
  const currentRate = onchainData.variableRate;
  const data = useMemo(
    () => generateData(currentRate, pts, currentRate * 31 + pts),
    [currentRate, pts]
  );

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const W = 600; const H = 120; const pad = 10;

  const coords = data.map((v, i): [number, number] => [
    (i / (data.length - 1)) * W,
    pad + (H - pad * 2) - ((v - min) / range) * (H - pad * 2),
  ]);

  const pathD = "M" + coords.map(([x, y]) => `${x},${y}`).join(" L");
  const areaD = pathD + ` L${W},${H} L0,${H} Z`;
  const [lx, ly] = coords[coords.length - 1];
  const isUp = data[data.length - 1] >= (data[data.length - 2] ?? data[data.length - 1]);
  const color = isUp ? "#2dd4bf" : "#f87171";
  const gradId = `g${market.perpIndex}${tf}`;

  return (
    <div className="px-5 pt-4 pb-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium" style={{ color: "#6b6890" }}>Funding Rate</span>
          <span className="text-xs font-mono font-semibold" style={{ color }}>
            {isUp ? "▲" : "▼"} {formatRate(data[data.length - 1])}
          </span>
          {onchainData.live && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ background: "rgba(45,212,191,0.1)", color: "#2dd4bf" }}>
              LIVE
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg"
          style={{ background: "rgba(255,255,255,0.03)" }}>
          {(["1H", "4H", "8H", "1D"] as Timeframe[]).map((t) => (
            <button key={t} onClick={() => setTf(t)}
              className="px-2.5 py-1 rounded-md text-xs font-medium transition-all"
              style={{
                background: tf === t ? "rgba(153,69,255,0.15)" : "transparent",
                color: tf === t ? "#c4b5fd" : "#4a4568",
              }}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div style={{ height: "120px" }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaD} fill={`url(#${gradId})`} />
          <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
          <circle cx={lx} cy={ly} r="3" fill={color}
            style={{ filter: `drop-shadow(0 0 4px ${color}80)` }} />
        </svg>
      </div>
    </div>
  );
}
