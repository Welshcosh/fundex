"use client";

import { useEffect, useMemo, useState } from "react";
import { MarketInfo } from "@/lib/constants";
import { OnchainMarketData } from "@/hooks/useMarketData";
import { formatRate } from "@/lib/utils";
import { isDemoMode } from "@/lib/fundex/demo-mode";
import { bookSizeJitter } from "@/lib/demo-fixtures";

function generateBook(fixedRate: number, noiseIdx: number) {
  const asks = Array.from({ length: 7 }, (_, i) => {
    const baseSize = ((fixedRate * (i + 1) * 17) % 18 | 0) + 2;
    return {
      rate: Math.round(fixedRate * (1 + 0.015 + i * 0.012)),
      size: Math.max(1, Math.round(baseSize * bookSizeJitter(i, noiseIdx))),
    };
  }).reverse();
  const bids = Array.from({ length: 7 }, (_, i) => {
    const baseSize = ((fixedRate * (i + 1) * 13) % 18 | 0) + 2;
    return {
      rate: Math.round(fixedRate * (1 - 0.015 - i * 0.012)),
      size: Math.max(1, Math.round(baseSize * bookSizeJitter(i + 100, noiseIdx))),
    };
  });
  const spread = asks[asks.length - 1].rate - bids[0].rate;
  return { asks, bids, spread };
}

export function RateBook({ market: _market, onchainData }: { market: MarketInfo; onchainData: OnchainMarketData }) {
  const fixedRate = onchainData.fixedRate;
  const [noiseIdx, setNoiseIdx] = useState(0);

  // Demo: nudge sizes every 2.2~3.7s so the book breathes. No real RPC pressure.
  useEffect(() => {
    if (!isDemoMode() || !onchainData.live) return;
    let cancelled = false;
    let timer = 0;
    const tick = () => {
      if (cancelled) return;
      setNoiseIdx((n) => n + 1);
      timer = window.setTimeout(tick, 2200 + Math.random() * 1500);
    };
    timer = window.setTimeout(tick, 2200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [onchainData.live]);

  const { asks, bids, spread } = useMemo(
    () => generateBook(fixedRate, noiseIdx),
    [fixedRate, noiseIdx],
  );
  const maxSize = Math.max(...asks.map((a) => a.size), ...bids.map((b) => b.size));

  return (
    <div className="flex flex-col h-full text-xs" style={{ background: "#0d0c1a" }}>
      <div
        className="px-3 py-3 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
      >
        <span className="font-medium" style={{ color: "#6b6890" }}>
          Book
        </span>
        {onchainData.live && (
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#2dd4bf", opacity: 0.7 }} />
        )}
      </div>

      <div className="grid grid-cols-2 px-3 py-1.5 flex-shrink-0" style={{ color: "#4a4568", fontSize: 10 }}>
        <span>Rate</span>
        <span className="text-right">Lots</span>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex flex-col justify-end">
          {asks.map((a, i) => (
            <div key={`ask-${i}`} className="relative grid grid-cols-2 px-3 py-[3px]">
              <div
                className="absolute inset-0"
                style={{
                  background: `linear-gradient(to left, rgba(248,113,113,0.08) ${(a.size / maxSize) * 100}%, transparent ${(a.size / maxSize) * 100}%)`,
                }}
              />
              <span className="font-mono relative text-[10.5px]" style={{ color: "#f87171" }}>
                {formatRate(a.rate)}
              </span>
              <span className="text-right font-mono relative text-[10.5px]" style={{ color: "#4a4568" }}>
                {a.size}
              </span>
            </div>
          ))}
        </div>

        <div
          className="flex items-center justify-between px-3 py-1 my-0.5 flex-shrink-0"
          style={{ background: "rgba(255,255,255,0.02)" }}
        >
          <span className="font-mono font-semibold text-[11px]" style={{ color: "#ede9fe" }}>
            {formatRate(fixedRate)}
          </span>
          <span className="font-mono text-[10px]" style={{ color: "#6b6890" }}>
            {formatRate(spread)}
          </span>
        </div>

        <div>
          {bids.map((b, i) => (
            <div key={`bid-${i}`} className="relative grid grid-cols-2 px-3 py-[3px]">
              <div
                className="absolute inset-0"
                style={{
                  background: `linear-gradient(to left, rgba(45,212,191,0.08) ${(b.size / maxSize) * 100}%, transparent ${(b.size / maxSize) * 100}%)`,
                }}
              />
              <span className="font-mono relative text-[10.5px]" style={{ color: "#2dd4bf" }}>
                {formatRate(b.rate)}
              </span>
              <span className="text-right font-mono relative text-[10.5px]" style={{ color: "#4a4568" }}>
                {b.size}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
