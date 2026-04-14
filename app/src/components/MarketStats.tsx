"use client";

import { MarketInfo } from "@/lib/constants";
import { formatRate, formatRateAnnualized } from "@/lib/utils";

interface Props {
  market: MarketInfo;
}

const stats = (market: MarketInfo) => [
  {
    label: "Current 8h Rate",
    value: formatRate(market.baseRate),
    sub: "Drift Protocol",
    color: "#4ade80",
  },
  {
    label: "Annualized Rate",
    value: formatRateAnnualized(market.baseRate),
    sub: "APR equivalent",
    color: "#00d4ff",
  },
  {
    label: "Fixed Rate (30D)",
    value: formatRate(Math.round(market.baseRate * 0.92)),
    sub: "EMA oracle",
    color: "#a78bfa",
  },
  {
    label: "Open Interest",
    value: "$2.4M",
    sub: "Total notional",
    color: "#94a3b8",
  },
  {
    label: "24h Volume",
    value: "$840K",
    sub: "Settled today",
    color: "#94a3b8",
  },
  {
    label: "Total Positions",
    value: "142",
    sub: "Active",
    color: "#94a3b8",
  },
];

export function MarketStats({ market }: Props) {
  return (
    <div className="grid grid-cols-6 gap-0"
      style={{ background: "#0d0f18", borderBottom: "1px solid #1e2231" }}>
      {stats(market).map((s, i) => (
        <div
          key={i}
          className="px-5 py-3"
          style={{ borderRight: i < 5 ? "1px solid #1e2231" : "none" }}>
          <div className="text-xs mb-1" style={{ color: "#475569" }}>{s.label}</div>
          <div className="text-sm font-mono font-semibold" style={{ color: s.color }}>{s.value}</div>
          <div className="text-[10px]" style={{ color: "#475569" }}>{s.sub}</div>
        </div>
      ))}
    </div>
  );
}
