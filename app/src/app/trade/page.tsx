"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TradeHeader } from "@/components/TradeHeader";
import { RateChart } from "@/components/RateChart";
import { OrderPanel } from "@/components/OrderPanel";
import { PositionsTable } from "@/components/PositionsTable";
import { RateBook } from "@/components/RateBook";
import { MarketStatsBar } from "@/components/MarketStatsBar";
import { RateAdvisor } from "@/components/RateAdvisor";
import { TradingAssistant } from "@/components/TradingAssistant";
import { MARKETS, DurationVariant } from "@/lib/constants";
import { useMarketData } from "@/hooks/useMarketData";
import { formatRate } from "@/lib/utils";

function ImbalanceWidget({
  payerLots, receiverLots, skewK, lastSettledTs, live,
}: {
  payerLots: number; receiverLots: number; skewK: number; lastSettledTs: number; live: boolean;
}) {
  const total = payerLots + receiverLots;
  const payerPct = total > 0 ? (payerLots / total) * 100 : 50;
  const netLots = Math.abs(payerLots - receiverLots);
  const imbalanceRatio = total > 0 ? Math.min(netLots * 10_000 / total, 10_000) : 0;
  const feeBps = 30 + Math.round(imbalanceRatio * 70 / 10_000);
  const isBalanced = Math.abs(payerPct - 50) < 8;

  // β: signed skew premium quoted to a NEW position right now.
  // Mirrors MarketState::current_skew_premium() in programs/fundex/src/state.rs.
  // skewPremiumE6 is the rate adjustment in 1e6/h units; positive when payer-heavy.
  const signedImbE6 = total > 0
    ? Math.max(-1_000_000, Math.min(1_000_000, ((payerLots - receiverLots) * 1_000_000) / total))
    : 0;
  const skewPremiumE6 = (skewK * signedImbE6) / 1_000_000;
  const skewPremiumPctPerHr = skewPremiumE6 / 10_000; // 1e6 unit = 100%/h → /10_000 = %/h
  const skewMagBps = Math.abs(Math.round(skewPremiumE6 / 100)); // 1e6 = 10_000 bps/h

  // α: time elapsed in current funding interval — used to surface that
  // mid-interval opens accrue only the (1 - frac) tail of the next rate.
  const FUNDING_INTERVAL = 3600;
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 5_000);
    return () => clearInterval(id);
  }, []);
  const elapsed = lastSettledTs > 0
    ? Math.max(0, Math.min(FUNDING_INTERVAL, nowSec - lastSettledTs))
    : 0;
  const fracE6 = lastSettledTs > 0 ? (elapsed * 1_000_000) / FUNDING_INTERVAL : 0;
  const tailPct = 100 - (fracE6 / 10_000);

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
          {live ? "Balanced" : "Awaiting on-chain data"}
        </div>
      )}

      {/* β: Skew premium quoted to new entrants. Both sides see the same biased rate;
          heavy side pays more, light side receives more — pushes book toward balance. */}
      <div className="mt-2 pt-2 flex items-center justify-between font-mono text-[10px]"
        style={{ borderTop: "1px dashed rgba(255,255,255,0.04)" }}>
        <span style={{ color: "#4a4568" }}>Skew premium (β)</span>
        <span style={{
          color: skewMagBps === 0 ? "#4a4568" : skewPremiumE6 > 0 ? "#fbbf24" : "#a78bfa",
        }}>
          {skewPremiumE6 === 0
            ? "0.000%/h"
            : `${skewPremiumPctPerHr >= 0 ? "+" : ""}${skewPremiumPctPerHr.toFixed(3)}%/h`}
          {skewPremiumE6 !== 0 && (
            <span style={{ color: "#4a4568", marginLeft: 6 }}>
              ({skewPremiumE6 > 0 ? "payer-heavy" : "receiver-heavy"})
            </span>
          )}
        </span>
      </div>

      {/* α: Time-weighted PnL — how much of the next interval this position earns. */}
      <div className="mt-1 flex items-center justify-between font-mono text-[10px]">
        <span style={{ color: "#4a4568" }}>Time-weighted PnL (α)</span>
        <span style={{ color: lastSettledTs > 0 ? "#a7f3d0" : "#2d2b45" }}>
          {lastSettledTs > 0
            ? `next interval ~${tailPct.toFixed(0)}% (elapsed ${(elapsed / 60).toFixed(0)}m)`
            : "—"}
        </span>
      </div>
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
              {/* AI Rate Advisor — elevated to top of sidebar for visibility */}
              <RateAdvisor market={market} duration={duration} onchainData={onchainData} />
              <div style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <RateBook market={market} onchainData={onchainData} />
              </div>
              <ImbalanceWidget
                payerLots={onchainData.payerLots}
                receiverLots={onchainData.receiverLots}
                skewK={onchainData.skewK}
                lastSettledTs={onchainData.lastSettledTs}
                live={onchainData.live}
              />
              <div className="md:overflow-auto">
                <OrderPanel market={market} duration={duration} onchainData={onchainData} />
              </div>
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
