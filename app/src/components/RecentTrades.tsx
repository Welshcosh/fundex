"use client";

import { useEffect, useState } from "react";
import { MarketInfo } from "@/lib/constants";
import { OnchainMarketData } from "@/hooks/useMarketData";
import { formatRate } from "@/lib/utils";
import { isDemoMode } from "@/lib/fundex/demo-mode";
import { seedRecentTrades, generateOneTrade, type MockTrade } from "@/lib/demo-fixtures";

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toTimeString().slice(0, 8);
}

export function RecentTrades({
  market,
  onchainData,
}: {
  market: MarketInfo;
  onchainData: OnchainMarketData;
}) {
  const fixedRate = onchainData.fixedRate;
  // Empty initial state so SSR and CSR agree (Date.now() inside the seed
  // would otherwise produce different timestamps server-side vs client-side).
  const [trades, setTrades] = useState<MockTrade[]>([]);

  // Re-seed on the client after mount and whenever the market changes.
  // Intentionally ignore fixedRate to keep the live stream stable across the
  // 60s on-chain refresh.
  useEffect(() => {
    setTrades(seedRecentTrades(market.symbol, fixedRate || 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market.symbol]);

  useEffect(() => {
    if (!isDemoMode() || !onchainData.live || fixedRate <= 0) return;
    let cancelled = false;
    let counter = 0;
    let timer = 0;
    const tick = () => {
      if (cancelled) return;
      counter += 1;
      setTrades((prev) =>
        [generateOneTrade(market.symbol, fixedRate, counter), ...prev].slice(0, 20),
      );
      const delay = 1500 + Math.random() * 1800;
      timer = window.setTimeout(tick, delay);
    };
    timer = window.setTimeout(tick, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [market.symbol, fixedRate, onchainData.live]);

  return (
    <div className="flex flex-col h-full text-xs" style={{ background: "#0d0c1a" }}>
      <div
        className="px-3 py-3 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
      >
        <span className="font-medium" style={{ color: "#6b6890" }}>
          Trades
        </span>
        {isDemoMode() && onchainData.live && (
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ background: "#2dd4bf" }}
            title="Live feed"
          />
        )}
      </div>

      <div
        className="grid grid-cols-3 px-3 py-1.5 flex-shrink-0"
        style={{ color: "#4a4568", fontSize: 10 }}
      >
        <span>Time</span>
        <span className="text-right">Rate</span>
        <span className="text-right">Lots</span>
      </div>

      <div className="flex-1 overflow-hidden">
        {trades.map((t) => (
          <div
            key={t.id}
            className="grid grid-cols-3 px-3 py-[3px] font-mono text-[10.5px]"
            style={{ animation: "tradeIn 0.45s ease-out" }}
          >
            <span style={{ color: "#4a4568" }}>{formatTime(t.ts)}</span>
            <span
              className="text-right"
              style={{ color: t.side === "long" ? "#2dd4bf" : "#f87171" }}
            >
              {formatRate(t.rate)}
            </span>
            <span className="text-right" style={{ color: "#8b87a8" }}>
              {t.lots}
            </span>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes tradeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
