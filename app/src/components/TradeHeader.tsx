"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { MARKETS, DURATION_LABELS, DurationVariant, MarketInfo } from "@/lib/constants";
import { formatRate, formatRateAnnualized, formatUSD } from "@/lib/utils";
import { OnchainMarketData } from "@/hooks/useMarketData";

interface Props {
  market: MarketInfo;
  duration: DurationVariant;
  onchainData: OnchainMarketData;
  onMarketChange: (m: MarketInfo) => void;
  onDurationChange: (d: DurationVariant) => void;
}

const DURATIONS = [DurationVariant.Days7, DurationVariant.Days30, DurationVariant.Days90, DurationVariant.Days180];

export function TradeHeader({ market, duration, onchainData, onMarketChange, onDurationChange }: Props) {
  const [open, setOpen] = useState(false);

  const variableRate = onchainData.variableRate;
  const fixedRate = onchainData.fixedRate;

  return (
    <div className="flex items-center gap-3 md:gap-6 px-4 md:px-6 h-14 flex-shrink-0 relative overflow-x-auto"
      style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>

      {/* Market picker */}
      <div className="relative">
        <button onClick={() => setOpen(!open)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className="flex items-center gap-2.5 h-9 px-3.5 rounded-xl transition-all"
          style={{ background: open ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="w-5 h-5 rounded-lg flex items-center justify-center text-[10px] font-bold"
            style={{ background: "linear-gradient(135deg, #9945ff, #43b4ca)", color: "#fff" }}>
            {market.symbol[0]}
          </div>
          <span className="text-sm font-semibold" style={{ color: "#ede9fe" }}>{market.name}</span>
          <ChevronDown size={13} style={{ color: "#6b6890", transform: open ? "rotate(180deg)" : "none", transition: "0.15s" }} />
        </button>

        {open && (
          <div className="absolute top-full left-0 mt-2 w-52 rounded-2xl overflow-hidden z-50"
            style={{ background: "#1a1830", border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 20px 60px rgba(0,0,0,0.7)" }}>
            {MARKETS.map((m) => {
              const active = market.perpIndex === m.perpIndex;
              return (
                <button key={m.perpIndex}
                  onClick={() => { onMarketChange(m); setOpen(false); }}
                  className="w-full flex items-center justify-between px-4 py-3 transition-colors"
                  style={{ background: active ? "rgba(153,69,255,0.08)" : "transparent" }}>
                  <div className="flex items-center gap-2.5">
                    <div className="w-6 h-6 rounded-lg flex items-center justify-center text-[9px] font-bold"
                      style={{ background: "linear-gradient(135deg, #9945ff40, #43b4ca40)", color: "#c4b5fd" }}>
                      {m.symbol[0]}
                    </div>
                    <span className="text-sm font-medium" style={{ color: active ? "#ede9fe" : "#8b87a8" }}>{m.name}</span>
                  </div>
                  <span className="text-xs font-mono" style={{ color: m.baseRate >= 0 ? "#2dd4bf" : "#f87171" }}>{formatRate(m.baseRate)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 md:gap-6 text-sm">
        <div className="whitespace-nowrap">
          <span style={{ color: "#4a4568" }}>8h </span>
          <span className="font-mono font-semibold" style={{ color: variableRate >= 0 ? "#2dd4bf" : "#f87171" }}>
            {formatRate(variableRate)}
          </span>
          {onchainData.live && (
            <span className="ml-1 w-1.5 h-1.5 rounded-full inline-block" style={{ background: variableRate >= 0 ? "#2dd4bf" : "#f87171", opacity: 0.8 }} />
          )}
        </div>
        <div className="hidden sm:block whitespace-nowrap">
          <span style={{ color: "#4a4568" }}>APR </span>
          <span className="font-mono font-semibold" style={{ color: "#c4b5fd" }}>
            {formatRateAnnualized(variableRate)}
          </span>
        </div>
        <div className="hidden md:block whitespace-nowrap">
          <span style={{ color: "#4a4568" }}>Fixed </span>
          <span className="font-mono" style={{ color: "#6b6890" }}>{formatRate(fixedRate)}</span>
        </div>
        <div className="hidden md:block whitespace-nowrap">
          <span style={{ color: "#4a4568" }}>OI </span>
          <span className="font-mono" style={{ color: "#6b6890" }}>
            {onchainData.oiUsd > 0 ? formatUSD(onchainData.oiUsd) : "—"}
          </span>
        </div>
      </div>

      {/* Duration */}
      <div className="ml-auto flex items-center gap-1 p-1 rounded-xl"
        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.04)" }}>
        {DURATIONS.map((d) => (
          <button key={d} onClick={() => onDurationChange(d)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{
              background: duration === d ? "rgba(153,69,255,0.18)" : "transparent",
              color: duration === d ? "#c4b5fd" : "#4a4568",
            }}>
            {DURATION_LABELS[d]}
          </button>
        ))}
      </div>
    </div>
  );
}
