"use client";

import { MarketInfo, DurationVariant, DURATION_FULL_LABELS } from "@/lib/constants";
import { OnchainMarketData } from "@/hooks/useMarketData";
import { formatRate, formatRateAnnualized } from "@/lib/utils";

function daysLeft(expiryTs: number): string {
  if (!expiryTs) return "—";
  const diff = expiryTs - Math.floor(Date.now() / 1000);
  if (diff <= 0) return "Expired";
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

interface Props {
  market: MarketInfo;
  duration: DurationVariant;
  onchainData: OnchainMarketData;
  expiryTs?: number;
}

export function MarketStatsBar({ market, duration, onchainData, expiryTs }: Props) {
  const { variableRate, fixedRate, payerLots, receiverLots, live } = onchainData;
  const spread = variableRate - fixedRate;
  const spreadPositive = spread >= 0;

  const totalLots = payerLots + receiverLots;
  const payerPct = totalLots > 0 ? (payerLots / totalLots) * 100 : 50;
  const receiverPct = 100 - payerPct;
  const isBalanced = Math.abs(payerPct - 50) < 5;

  const netLots = Math.abs(payerLots - receiverLots);
  const imbalanceRatio = totalLots > 0 ? Math.min(netLots * 10_000 / totalLots, 10_000) : 0;
  const dynamicFeeBps = payerLots >= receiverLots
    ? 30 + Math.round(imbalanceRatio * 70 / 10_000)
    : 30 + Math.round(imbalanceRatio * 70 / 10_000);

  const stats = [
    {
      label: "Spread",
      value: formatRate(spread),
      sub: `${formatRateAnnualized(spread)} APR`,
      color: spreadPositive ? "#2dd4bf" : "#f87171",
    },
    {
      label: "Variable Rate",
      value: formatRate(variableRate),
      sub: `${formatRateAnnualized(variableRate)} APR`,
      color: variableRate >= 0 ? "#2dd4bf" : "#f87171",
    },
    {
      label: "Fixed Rate",
      value: formatRate(fixedRate),
      sub: DURATION_FULL_LABELS[duration],
      color: "#c4b5fd",
    },
    {
      label: "AMM Fee",
      value: `${(dynamicFeeBps / 100).toFixed(1)}%`,
      sub: isBalanced ? "balanced market" : `${(Math.abs(payerPct - 50)).toFixed(0)}% imbalanced`,
      color: isBalanced ? "#4a4568" : "#fbbf24",
    },
  ];

  return (
    <div className="flex items-stretch border-b"
      style={{ borderColor: "rgba(255,255,255,0.04)", background: "#0a0918" }}>

      {/* Stats */}
      {stats.map((s, i) => (
        <div key={s.label}
          className="flex-1 px-5 py-3"
          style={{ borderRight: i < stats.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
          <div className="text-[10px] mb-1" style={{ color: "#4a4568" }}>{s.label}</div>
          <div className="font-mono font-semibold text-sm" style={{ color: s.color }}>{s.value}</div>
          <div className="text-[10px] mt-0.5" style={{ color: "#2d2b45" }}>{s.sub}</div>
        </div>
      ))}

      {/* Imbalance bar */}
      <div className="flex-1 px-5 py-3"
        style={{ borderLeft: "1px solid rgba(255,255,255,0.04)" }}>
        <div className="text-[10px] mb-1.5" style={{ color: "#4a4568" }}>OI Imbalance</div>
        {live && totalLots > 0 ? (
          <>
            <div className="flex rounded-full overflow-hidden h-1.5 mb-1.5" style={{ background: "rgba(255,255,255,0.06)" }}>
              <div style={{ width: `${payerPct}%`, background: "linear-gradient(90deg, #2dd4bf, #0891b2)", transition: "width 0.5s" }} />
              <div style={{ width: `${receiverPct}%`, background: "linear-gradient(90deg, #9945ff80, #9945ff40)", transition: "width 0.5s" }} />
            </div>
            <div className="flex justify-between text-[10px] font-mono">
              <span style={{ color: "#2dd4bf" }}>{payerLots}P</span>
              <span style={{ color: "#c4b5fd" }}>{receiverLots}R</span>
            </div>
          </>
        ) : (
          <div className="text-[11px] font-mono" style={{ color: "#2d2b45" }}>—</div>
        )}
      </div>

      {/* Expiry */}
      {expiryTs && (
        <div className="flex-1 px-5 py-3"
          style={{ borderLeft: "1px solid rgba(255,255,255,0.04)" }}>
          <div className="text-[10px] mb-1" style={{ color: "#4a4568" }}>Expiry</div>
          <div className="font-mono text-sm" style={{ color: "#8b87a8" }}>{daysLeft(expiryTs)}</div>
          <div className="text-[10px] mt-0.5" style={{ color: "#2d2b45" }}>
            {market.name}
          </div>
        </div>
      )}
    </div>
  );
}
