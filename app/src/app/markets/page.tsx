"use client";

import Link from "next/link";
import { TrendingUp, Activity, ArrowUpRight } from "lucide-react";
import { MARKETS, DURATION_LABELS, DurationVariant, MarketInfo } from "@/lib/constants";
import { formatRate, formatRateAnnualized, formatUSD } from "@/lib/utils";
import { useMarketData } from "@/hooks/useMarketData";

const DURATIONS = [DurationVariant.Days7, DurationVariant.Days30, DurationVariant.Days90, DurationVariant.Days180];

function MarketRow({ market }: { market: MarketInfo }) {
  const d7   = useMarketData(market, DurationVariant.Days7);
  const d30  = useMarketData(market, DurationVariant.Days30);
  const d90  = useMarketData(market, DurationVariant.Days90);
  const d180 = useMarketData(market, DurationVariant.Days180);

  const durData = [d7, d30, d90, d180];
  const variableRate = d7.variableRate;
  const live = d7.live;
  const totalOI = durData.reduce((s, d) => s + d.oiUsd, 0);

  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ background: "#0d0c1a", border: "1px solid rgba(255,255,255,0.05)" }}>

      {/* Market header row */}
      <div className="px-6 py-5 flex items-center justify-between"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        <div className="flex items-center gap-4">
          {/* Icon */}
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold"
            style={{
              background: "linear-gradient(135deg, rgba(153,69,255,0.2), rgba(67,180,202,0.2))",
              color: "#c4b5fd",
              border: "1px solid rgba(153,69,255,0.2)",
            }}>
            {market.symbol[0]}
          </div>
          <div>
            <div className="font-bold text-base" style={{ color: "#ede9fe" }}>{market.name}</div>
            <div className="text-xs flex items-center gap-1.5 mt-0.5" style={{ color: "#4a4568" }}>
              <Activity size={10} />
              Funding Rate Swap
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 md:gap-8">
          <div className="text-right">
            <div className="text-[11px] mb-1" style={{ color: "#4a4568" }}>8h Funding</div>
            <div className="font-mono font-bold text-sm flex items-center gap-1 justify-end" style={{ color: "#2dd4bf" }}>
              {live ? (
                <span style={{ color: "#2dd4bf" }}>●</span>
              ) : (
                <TrendingUp size={11} />
              )}
              +{formatRate(variableRate)}
            </div>
          </div>
          <div className="hidden sm:block text-right">
            <div className="text-[11px] mb-1" style={{ color: "#4a4568" }}>APY</div>
            <div className="font-mono font-semibold text-sm" style={{ color: "#c4b5fd" }}>
              +{formatRateAnnualized(variableRate)}
            </div>
          </div>
          <div className="hidden sm:block text-right">
            <div className="text-[11px] mb-1" style={{ color: "#4a4568" }}>Open Interest</div>
            <div className="font-mono text-sm" style={{ color: "#8b87a8" }}>{formatUSD(totalOI)}</div>
          </div>
        </div>
      </div>

      {/* Duration rows */}
      <div className="grid grid-cols-2 sm:grid-cols-4">
        {DURATIONS.map((dur, di) => {
          const durResult = durData[di];
          const fixedRate = live
            ? durResult.fixedRate
            : Math.round(market.baseRate * (0.88 + di * 0.02));
          const spread = variableRate - fixedRate;
          return (
            <Link key={dur} href={`/trade?perp=${market.perpIndex}&dur=${dur}`}
              className="flex items-center justify-between px-6 py-4 group transition-colors"
              style={{ borderRight: di < 3 ? "1px solid rgba(255,255,255,0.04)" : "none" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
              <div>
                <div className="text-xs font-bold mb-1.5" style={{ color: "#ede9fe" }}>
                  {DURATION_LABELS[dur]}
                </div>
                <div className="text-[11px] mb-0.5" style={{ color: "#4a4568" }}>
                  Fixed&nbsp;&nbsp;{formatRate(fixedRate)}
                </div>
                <div className="text-[11px]" style={{ color: spread >= 0 ? "#2dd4bf" : "#f87171" }}>
                  Spread {spread >= 0 ? "+" : ""}{formatRate(spread)}
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ color: "#9945ff" }}>
                <span className="text-[11px] font-medium">Trade</span>
                <ArrowUpRight size={11} />
              </div>
            </Link>
          );
        })}
      </div>

    </div>
  );
}

function SummaryStats() {
  // Aggregate live data across all 16 markets
  const btcD7  = useMarketData(MARKETS[0], DurationVariant.Days7);
  const btcD30 = useMarketData(MARKETS[0], DurationVariant.Days30);
  const btcD90 = useMarketData(MARKETS[0], DurationVariant.Days90);
  const btcD180= useMarketData(MARKETS[0], DurationVariant.Days180);
  const ethD7  = useMarketData(MARKETS[1], DurationVariant.Days7);
  const ethD30 = useMarketData(MARKETS[1], DurationVariant.Days30);
  const ethD90 = useMarketData(MARKETS[1], DurationVariant.Days90);
  const ethD180= useMarketData(MARKETS[1], DurationVariant.Days180);
  const solD7  = useMarketData(MARKETS[2], DurationVariant.Days7);
  const solD30 = useMarketData(MARKETS[2], DurationVariant.Days30);
  const solD90 = useMarketData(MARKETS[2], DurationVariant.Days90);
  const solD180= useMarketData(MARKETS[2], DurationVariant.Days180);
  const jtoD7  = useMarketData(MARKETS[3], DurationVariant.Days7);
  const jtoD30 = useMarketData(MARKETS[3], DurationVariant.Days30);
  const jtoD90 = useMarketData(MARKETS[3], DurationVariant.Days90);
  const jtoD180= useMarketData(MARKETS[3], DurationVariant.Days180);

  const all = [btcD7, btcD30, btcD90, btcD180, ethD7, ethD30, ethD90, ethD180,
               solD7, solD30, solD90, solD180, jtoD7, jtoD30, jtoD90, jtoD180];
  const liveCount = all.filter((d) => d.live).length;
  const totalOI = all.reduce((s, d) => s + d.oiUsd, 0);
  const anyLive = liveCount > 0;

  const stats = [
    {
      label: "Active Markets",
      value: anyLive ? `${liveCount} / 16` : "16",
      delta: "4 perps × 4 durations",
    },
    {
      label: "Total Open Interest",
      value: anyLive ? formatUSD(totalOI) : "—",
      delta: anyLive ? "Live on-chain data" : "Loading…",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
      {stats.map((s) => (
        <div key={s.label} className="p-5 rounded-2xl"
          style={{ background: "#0d0c1a", border: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="text-xs mb-4" style={{ color: "#4a4568" }}>{s.label}</div>
          <div className="text-2xl font-bold font-mono mb-1.5" style={{ color: "#ede9fe" }}>{s.value}</div>
          <div className="text-xs font-medium" style={{ color: "#4a4568" }}>{s.delta}</div>
        </div>
      ))}
    </div>
  );
}

export default function MarketsPage() {
  return (
    <div style={{ minHeight: "calc(100vh - 56px)", background: "#08090e" }}>
      <div className="max-w-6xl mx-auto px-8 py-12">

        {/* Page header */}
        <div className="mb-10">
          <h1 className="text-3xl font-bold mb-2" style={{ color: "#ede9fe" }}>Markets</h1>
          <p className="text-sm" style={{ color: "#6b6890" }}>
            Trade funding rate swaps on Solana — go long or short on perpetual funding rates.
          </p>
        </div>

        <SummaryStats />

        {/* Market list */}
        <div className="space-y-3">
          {MARKETS.map((market) => (
            <MarketRow key={market.perpIndex} market={market} />
          ))}
        </div>

      </div>
    </div>
  );
}
