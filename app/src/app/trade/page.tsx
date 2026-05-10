"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TradeHeader } from "@/components/TradeHeader";
import { RateChart } from "@/components/RateChart";
import { OrderPanel } from "@/components/OrderPanel";
import { PositionsTable } from "@/components/PositionsTable";
import { RateBook } from "@/components/RateBook";
import { RecentTrades } from "@/components/RecentTrades";
import { MarketStatsBar } from "@/components/MarketStatsBar";
import { RateAdvisorBanner } from "@/components/RateAdvisorBanner";
import { TradingAssistant } from "@/components/TradingAssistant";
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

  const onchainData = useMarketData(market, duration);

  return (
    <div style={{ minHeight: "calc(100vh - 56px)", display: "flex", flexDirection: "column", background: "#0d0c1a" }}>
      <TradeHeader
        market={market} duration={duration}
        onchainData={onchainData}
        onMarketChange={setMarket} onDurationChange={setDuration}
      />

      <RateAdvisorBanner market={market} duration={duration} onchainData={onchainData} />

      <div className="flex flex-col md:flex-row flex-1 md:overflow-hidden justify-center">
        <div className="w-full md:max-w-[1440px] flex flex-col md:flex-row md:overflow-hidden">

          {/* Center column: Chart + Stats + Positions */}
          <div className="flex flex-col md:flex-1 md:min-w-0 md:overflow-hidden">
            <RateChart market={market} onchainData={onchainData} duration={duration} />
            <MarketStatsBar market={market} duration={duration} onchainData={onchainData} />
            <div className="md:flex-1 md:overflow-auto">
              <PositionsTable />
            </div>
          </div>

          {/* Right cluster: Book | Trades | OrderPanel */}
          <div
            className="flex flex-col md:flex-row md:overflow-hidden flex-shrink-0"
            style={{ borderLeft: "1px solid rgba(255,255,255,0.05)" }}
          >
            <style>{`
              @media (min-width: 768px) {
                .col-book { width: 158px; flex-shrink: 0; }
                .col-trades { width: 178px; flex-shrink: 0; }
                .col-order { width: 312px; flex-shrink: 0; }
              }
            `}</style>
            <div className="col-book md:overflow-hidden" style={{ borderRight: "1px solid rgba(255,255,255,0.05)" }}>
              <RateBook market={market} onchainData={onchainData} />
            </div>
            <div className="col-trades md:overflow-hidden" style={{ borderRight: "1px solid rgba(255,255,255,0.05)" }}>
              <RecentTrades market={market} onchainData={onchainData} />
            </div>
            <div className="col-order md:overflow-auto">
              <OrderPanel market={market} duration={duration} onchainData={onchainData} />
            </div>
          </div>

        </div>
      </div>

      <TradingAssistant market={market} duration={duration} onchainData={onchainData} />
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
