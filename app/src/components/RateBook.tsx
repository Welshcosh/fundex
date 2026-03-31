"use client";

import { useMemo, useState } from "react";
import { MarketInfo } from "@/lib/constants";
import { OnchainMarketData } from "@/hooks/useMarketData";
import { formatRate } from "@/lib/utils";

type Filter = "All" | "Asks" | "Bids";

function generateBook(fixedRate: number, variableRate: number) {
  // Asks: fixed rates above current fixedRate (receivers want more)
  const asks = Array.from({ length: 8 }, (_, i) => ({
    rate: Math.round(fixedRate * (1 + 0.015 + i * 0.012)),
    size: ((fixedRate * (i + 1) * 17) % 18 | 0) + 2,
  })).reverse();
  // Bids: fixed rates below current fixedRate (payers want less)
  const bids = Array.from({ length: 8 }, (_, i) => ({
    rate: Math.round(fixedRate * (1 - 0.015 - i * 0.012)),
    size: ((fixedRate * (i + 1) * 13) % 18 | 0) + 2,
  }));
  const spread = asks[asks.length - 1].rate - bids[0].rate;
  return { asks, bids, spread, mid: fixedRate, variableRate };
}

export function RateBook({ market, onchainData }: { market: MarketInfo; onchainData: OnchainMarketData }) {
  const [filter, setFilter] = useState<Filter>("All");

  const fixedRate = onchainData.fixedRate;
  const variableRate = onchainData.variableRate;

  const { asks, bids, spread } = useMemo(
    () => generateBook(fixedRate, variableRate),
    [fixedRate, variableRate]
  );
  const maxSize = Math.max(...asks.map((a) => a.size), ...bids.map((b) => b.size));

  return (
    <div className="flex flex-col h-full text-xs" style={{ background: "#0d0c1a" }}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        <div className="flex items-center gap-2">
          <span className="font-medium" style={{ color: "#6b6890" }}>Order Book</span>
          {onchainData.live && (
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: "#2dd4bf", opacity: 0.7 }} />
          )}
        </div>
        <div className="flex gap-0.5 p-0.5 rounded-lg" style={{ background: "rgba(255,255,255,0.03)" }}>
          {(["All", "Bids", "Asks"] as Filter[]).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className="px-2 py-0.5 rounded-md text-[11px] font-medium transition-all"
              style={{
                background: filter === f ? "rgba(153,69,255,0.15)" : "transparent",
                color: filter === f ? "#c4b5fd" : "#4a4568",
              }}>
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 px-4 py-2" style={{ color: "#4a4568" }}>
        <span>Rate</span><span className="text-right">Lots</span>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        {filter !== "Bids" && (
          <div className="flex-1 flex flex-col justify-end">
            {asks.map((a, i) => (
              <div key={`ask-${i}`} className="relative grid grid-cols-2 px-4 py-[3.5px] cursor-pointer">
                <div className="absolute inset-0" style={{ background: `linear-gradient(to left, rgba(248,113,113,0.08) ${(a.size / maxSize) * 100}%, transparent ${(a.size / maxSize) * 100}%)` }} />
                <span className="font-mono relative" style={{ color: "#f87171" }}>+{formatRate(a.rate)}</span>
                <span className="text-right font-mono relative" style={{ color: "#4a4568" }}>{a.size}</span>
              </div>
            ))}
          </div>
        )}

        {filter === "All" && (
          <div className="flex items-center justify-between px-4 py-1.5 my-0.5"
            style={{ background: "rgba(255,255,255,0.02)" }}>
            <div className="flex items-center gap-2">
              <span style={{ color: "#4a4568" }}>Fixed</span>
              <span className="font-mono font-semibold" style={{ color: "#ede9fe" }}>
                +{formatRate(fixedRate)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span style={{ color: "#4a4568" }}>Spread</span>
              <span className="font-mono" style={{ color: "#6b6890" }}>{formatRate(spread)}</span>
            </div>
          </div>
        )}

        {filter !== "Asks" && (
          <div className="flex-1">
            {bids.map((b, i) => (
              <div key={`bid-${i}`} className="relative grid grid-cols-2 px-4 py-[3.5px] cursor-pointer">
                <div className="absolute inset-0" style={{ background: `linear-gradient(to left, rgba(45,212,191,0.08) ${(b.size / maxSize) * 100}%, transparent ${(b.size / maxSize) * 100}%)` }} />
                <span className="font-mono relative" style={{ color: "#2dd4bf" }}>+{formatRate(b.rate)}</span>
                <span className="text-right font-mono relative" style={{ color: "#4a4568" }}>{b.size}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
