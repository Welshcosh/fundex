"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TradeHeader } from "@/components/TradeHeader";
import { RateChart } from "@/components/RateChart";
import { OrderPanel } from "@/components/OrderPanel";
import { PositionsTable } from "@/components/PositionsTable";
import { RateBook } from "@/components/RateBook";
import { MARKETS, DurationVariant } from "@/lib/constants";
import { useMarketData } from "@/hooks/useMarketData";

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

  // Fetch real on-chain data — falls back to mock values if not available
  const onchainData = useMarketData(market, duration);

  return (
    <div style={{ minHeight: "calc(100vh - 56px)", display: "flex", flexDirection: "column", background: "#0d0c1a" }}>
      <TradeHeader
        market={market} duration={duration}
        onchainData={onchainData}
        onMarketChange={setMarket} onDurationChange={setDuration}
      />

      {/* Desktop: side-by-side | Mobile: stacked */}
      <div className="flex flex-col md:flex-row flex-1 md:overflow-hidden justify-center">
        <div className="w-full md:max-w-[1280px] flex flex-col md:flex-row md:overflow-hidden">

          {/* Chart + Positions */}
          <div className="flex flex-col md:flex-1 md:overflow-hidden"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <RateChart market={market} onchainData={onchainData} />
            <div className="md:flex-1 md:overflow-auto">
              <PositionsTable />
            </div>
          </div>

          {/* Sidebar: Rate Book + Order Panel */}
          <div className="flex flex-col md:overflow-hidden"
            style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
            // eslint-disable-next-line react/forbid-dom-props
          >
            <style>{`@media (min-width: 768px) { .sidebar-inner { width: 340px; flex-shrink: 0; } }`}</style>
            <div className="sidebar-inner flex flex-col md:overflow-hidden">
              <div style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <RateBook market={market} onchainData={onchainData} />
              </div>
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
