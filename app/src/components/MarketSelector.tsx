"use client";

import { useState } from "react";
import { ChevronDown, TrendingUp, TrendingDown } from "lucide-react";
import { MARKETS, DURATION_LABELS, DurationVariant, MarketInfo } from "@/lib/constants";
import { formatRate } from "@/lib/utils";

interface Props {
  selectedMarket: MarketInfo;
  selectedDuration: DurationVariant;
  onMarketChange: (m: MarketInfo) => void;
  onDurationChange: (d: DurationVariant) => void;
}

const DURATIONS = [
  DurationVariant.Days7,
  DurationVariant.Days30,
  DurationVariant.Days90,
  DurationVariant.Days180,
];

export function MarketSelector({ selectedMarket, selectedDuration, onMarketChange, onDurationChange }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center gap-4">
      {/* Market dropdown */}
      <div className="relative">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
          style={{
            background: "rgba(15,17,23,0.9)",
            border: "1px solid #1e2231",
            color: "#e2e8f0",
          }}
        >
          <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
            style={{ background: "rgba(0,212,255,0.15)", color: "#00d4ff" }}>
            {selectedMarket.symbol[0]}
          </span>
          <span>{selectedMarket.name}</span>
          <ChevronDown size={14} style={{ color: "#94a3b8", transform: open ? "rotate(180deg)" : "none", transition: "0.2s" }} />
        </button>

        {open && (
          <div className="absolute top-full mt-2 left-0 w-56 rounded-xl overflow-hidden z-50"
            style={{ background: "#0f1117", border: "1px solid #1e2231", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
            {MARKETS.map((m) => (
              <button
                key={m.perpIndex}
                onClick={() => { onMarketChange(m); setOpen(false); }}
                className="w-full flex items-center justify-between px-4 py-3 text-sm transition-all"
                style={{
                  background: selectedMarket.perpIndex === m.perpIndex ? "rgba(0,212,255,0.06)" : "transparent",
                  color: "#e2e8f0",
                  borderBottom: "1px solid #1e2231",
                }}>
                <div className="flex items-center gap-2.5">
                  <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{ background: "rgba(0,212,255,0.12)", color: "#00d4ff" }}>
                    {m.symbol[0]}
                  </span>
                  <div className="text-left">
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs" style={{ color: "#94a3b8" }}>Funding Rate Swap</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-mono" style={{ color: m.baseRate > 8000 ? "#4ade80" : "#94a3b8" }}>
                    {formatRate(m.baseRate)}
                  </div>
                  <div className="text-[10px]" style={{ color: "#475569" }}>8h rate</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Duration tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl"
        style={{ background: "#0d0f18", border: "1px solid #1e2231" }}>
        {DURATIONS.map((d) => (
          <button
            key={d}
            onClick={() => onDurationChange(d)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{
              background: selectedDuration === d ? "rgba(0,212,255,0.12)" : "transparent",
              color: selectedDuration === d ? "#00d4ff" : "#94a3b8",
              border: selectedDuration === d ? "1px solid rgba(0,212,255,0.2)" : "1px solid transparent",
            }}>
            {DURATION_LABELS[d]}
          </button>
        ))}
      </div>

      {/* Live rate display */}
      <div className="flex items-center gap-2 px-4 py-2 rounded-xl"
        style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.15)" }}>
        <TrendingUp size={13} style={{ color: "#4ade80" }} />
        <div>
          <span className="text-xs" style={{ color: "#94a3b8" }}>8h Rate </span>
          <span className="text-sm font-mono font-semibold" style={{ color: selectedMarket.baseRate >= 0 ? "#4ade80" : "#f87171" }}>
            {formatRate(selectedMarket.baseRate)}
          </span>
        </div>
      </div>
    </div>
  );
}
