"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TradeHeader } from "@/components/TradeHeader";
import { RateChart } from "@/components/RateChart";
import { OrderPanel } from "@/components/OrderPanel";
import { PositionsTable } from "@/components/PositionsTable";
import { RateBook } from "@/components/RateBook";
import { MarketStatsBar } from "@/components/MarketStatsBar";
import { MARKETS, DurationVariant } from "@/lib/constants";
import { useMarketData } from "@/hooks/useMarketData";
import { formatRate } from "@/lib/utils";

function ImbalanceWidget({ payerLots, receiverLots, live }: { payerLots: number; receiverLots: number; live: boolean }) {
  const total = payerLots + receiverLots;
  const payerPct = total > 0 ? (payerLots / total) * 100 : 50;
  const netLots = Math.abs(payerLots - receiverLots);
  const imbalanceRatio = total > 0 ? Math.min(netLots * 10_000 / total, 10_000) : 0;
  const feeBps = 30 + Math.round(imbalanceRatio * 70 / 10_000);
  const isBalanced = Math.abs(payerPct - 50) < 8;

  return (
    <div className="px-4 py-3 text-xs" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", background: "#0a0918" }}>
      <div className="flex items-center justify-between mb-2">
        <span style={{ color: "#4a4568" }}>Market Imbalance</span>
        <span className="font-mono font-semibold"
          style={{ color: isBalanced ? "#4a4568" : "#fbbf24" }}>
          AMM fee {(feeBps / 100).toFixed(1)}%
        </span>
      </div>

      {live && total > 0 ? (
        <>
          <div className="flex rounded-full overflow-hidden mb-1.5" style={{ height: 5, background: "rgba(255,255,255,0.05)" }}>
            <div style={{
              width: `${payerPct}%`,
              background: "linear-gradient(90deg, #2dd4bf, #0891b2)",
              transition: "width 0.6s",
            }} />
            <div style={{
              width: `${100 - payerPct}%`,
              background: "linear-gradient(90deg, #9945ff60, #9945ff30)",
              transition: "width 0.6s",
            }} />
          </div>
          <div className="flex justify-between font-mono" style={{ color: "#4a4568", fontSize: 10 }}>
            <span style={{ color: "#2dd4bf" }}>Payer {payerLots} lots ({payerPct.toFixed(0)}%)</span>
            <span style={{ color: "#c4b5fd" }}>Receiver {receiverLots} lots</span>
          </div>
          {!isBalanced && (
            <div className="mt-1.5 text-[10px] leading-relaxed" style={{ color: "#4a4568" }}>
              {payerLots > receiverLots ? "More payers — opening receiver reduces your fee to 0.3%" : "More receivers — opening payer reduces your fee to 0.3%"}
            </div>
          )}
        </>
      ) : (
        <div className="font-mono text-[11px]" style={{ color: "#2d2b45" }}>
          {live ? "Balanced" : "Loading…"}
        </div>
      )}
    </div>
  );
}

function TradePageInner() {
  const params = useSearchParams();
  const perpParam = Number(params.get("perp") ?? 2);
  const durParam = Number(params.get("dur") ?? DurationVariant.Days30) as DurationVariant;

  const [market, setMarket] = useState(MARKETS.find((m) => m.perpIndex === perpParam) ?? MARKETS[2]);
  const [duration, setDuration] = useState<DurationVariant>(durParam);

  useEffect(() => {
    const m = MARKETS.find((m) => m.perpIndex === perpParam);
    if (m) setMarket(m);
    setDuration(durParam);
  }, [perpParam, durParam]);

  const onchainData = useMarketData(market, duration);

  return (
    <div style={{ minHeight: "calc(100vh - 56px)", display: "flex", flexDirection: "column", background: "#0d0c1a" }}>
      <TradeHeader
        market={market} duration={duration}
        onchainData={onchainData}
        onMarketChange={setMarket} onDurationChange={setDuration}
      />

      <div className="flex flex-col md:flex-row flex-1 md:overflow-hidden justify-center">
        <div className="w-full md:max-w-[1280px] flex flex-col md:flex-row md:overflow-hidden">

          {/* Chart + Stats + Positions */}
          <div className="flex flex-col md:flex-1 md:overflow-hidden">
            <RateChart market={market} onchainData={onchainData} duration={duration} />
            <MarketStatsBar market={market} duration={duration} onchainData={onchainData} />
            <div className="md:flex-1 md:overflow-auto">
              <PositionsTable />
            </div>
          </div>

          {/* Sidebar */}
          <div className="flex flex-col md:overflow-hidden"
            style={{ borderLeft: "1px solid rgba(255,255,255,0.05)" }}>
            <style>{`@media (min-width: 768px) { .sidebar-inner { width: 340px; flex-shrink: 0; } }`}</style>
            <div className="sidebar-inner flex flex-col md:overflow-hidden">
              <div style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <RateBook market={market} onchainData={onchainData} />
              </div>
              <ImbalanceWidget
                payerLots={onchainData.payerLots}
                receiverLots={onchainData.receiverLots}
                live={onchainData.live}
              />
              <div className="md:overflow-auto">
                <OrderPanel market={market} duration={duration} onchainData={onchainData} />
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

export default function TradePage() {
  return (
    <Suspense>
      <TradePageInner />
    </Suspense>
  );
}
