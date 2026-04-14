"use client";

import { useState, useEffect, useRef } from "react";
import { MarketInfo, DurationVariant } from "@/lib/constants";
import { OnchainMarketData } from "@/hooks/useMarketData";
import { RateAdvisorOutput } from "@/app/api/ai/rate-advisor/route";
import { rateToAprPct } from "@/lib/utils";

const DURATION_LABELS: Record<number, string> = {
  7: "7d",
  30: "30d",
  90: "90d",
  180: "180d",
};

function DirectionIcon({ dir }: { dir: "up" | "down" | "neutral" }) {
  if (dir === "up") return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 3L13 10H3L8 3Z" fill="#2dd4bf" />
    </svg>
  );
  if (dir === "down") return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 13L3 6H13L8 13Z" fill="#f87171" />
    </svg>
  );
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3 8H13M10 5L13 8L10 11" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ConfidencePill({ confidence }: { confidence: "high" | "medium" | "low" }) {
  const colors = {
    high: { bg: "rgba(45,212,191,0.12)", text: "#2dd4bf", border: "rgba(45,212,191,0.25)" },
    medium: { bg: "rgba(251,191,36,0.10)", text: "#fbbf24", border: "rgba(251,191,36,0.25)" },
    low: { bg: "rgba(107,114,128,0.10)", text: "#6b7280", border: "rgba(107,114,128,0.20)" },
  };
  const c = colors[confidence];
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full"
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
      {confidence}
    </span>
  );
}

interface Props {
  market: MarketInfo;
  duration: DurationVariant;
  onchainData: OnchainMarketData;
}

export function RateAdvisor({ market, duration, onchainData }: Props) {
  const [result, setResult] = useState<RateAdvisorOutput | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const fetchedKeyRef = useRef<string>("");

  const oracleRate = onchainData.variableRate;
  const fetchKey = `${market.symbol}-${duration}`;

  useEffect(() => {
    if (!onchainData.live || oracleRate <= 0) return;
    if (fetchedKeyRef.current === fetchKey) return;
    fetchedKeyRef.current = fetchKey;

    let cancelled = false;
    setLoading(true);
    setError(false);
    setResult(null);

    const market_key = market.symbol as "BTC" | "ETH" | "SOL" | "JTO";
    const durMap: Record<number, 7 | 30 | 90 | 180> = { 0: 7, 1: 30, 2: 90, 3: 180 };
    const dur_key = durMap[duration] ?? 30;

    const body = JSON.stringify({ market: market_key, duration: dur_key, currentOracleRate: oracleRate });
    (async () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        if (cancelled) return;
        try {
          const r = await fetch("/api/ai/rate-advisor", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          });
          if (r.status === 429) {
            await new Promise((res) => setTimeout(res, 800 * Math.pow(2, attempt) + Math.random() * 400));
            continue;
          }
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const data = await r.json();
          if (!cancelled) { setResult(data); setLoading(false); }
          return;
        } catch {
          if (!cancelled) { setError(true); setLoading(false); }
          return;
        }
      }
      if (!cancelled) { setError(true); setLoading(false); }
    })();

    return () => { cancelled = true; };
  }, [fetchKey, onchainData.live, oracleRate, market.symbol, duration]);

  const currentApr = rateToAprPct(oracleRate);
  const recommendedApr = result ? rateToAprPct(result.recommendedFixedRate) : null;

  return (
    <div className="px-4 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", background: "#0a0918" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#9945ff" }}>
            AI Rate Advisor
          </span>
          <span className="text-[9px] px-1.5 py-0.5 rounded font-mono"
            style={{ background: "rgba(153,69,255,0.12)", color: "#c4b5fd", border: "1px solid rgba(153,69,255,0.2)" }}>
            {DURATION_LABELS[duration] ?? "30d"}
          </span>
        </div>
        <button
          onClick={() => {
            fetchedKeyRef.current = "";
            setResult(null);
            setError(false);
          }}
          className="text-[10px] font-mono transition-colors"
          style={{ color: "#2d2b45" }}
          onMouseEnter={e => (e.currentTarget.style.color = "#6b7280")}
          onMouseLeave={e => (e.currentTarget.style.color = "#2d2b45")}
        >
          refresh
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-2">
          <div className="w-3 h-3 rounded-full animate-pulse" style={{ background: "#9945ff40" }} />
          <span className="text-[11px] font-mono" style={{ color: "#4a4568" }}>Analyzing {market.symbol} rates…</span>
        </div>
      )}

      {error && (
        <div className="text-[11px] font-mono py-2" style={{ color: "#4a4568" }}>
          Advisor unavailable
        </div>
      )}

      {result && !loading && (
        <div className="space-y-3">
          {/* Direction + Recommended Rate */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DirectionIcon dir={result.direction} />
              <div>
                <div className="text-[10px] mb-0.5" style={{ color: "#4a4568" }}>Recommended Fixed Rate</div>
                <div className="font-mono font-semibold text-sm" style={{
                  color: result.direction === "up" ? "#2dd4bf"
                    : result.direction === "down" ? "#f87171"
                      : "#9ca3af"
                }}>
                  {recommendedApr !== null ? `${recommendedApr.toFixed(2)}% APR` : "—"}
                </div>
              </div>
            </div>
            <ConfidencePill confidence={result.confidence} />
          </div>

          {/* Current vs Recommended */}
          <div className="flex gap-3 text-[10px] font-mono">
            <div>
              <span style={{ color: "#4a4568" }}>Oracle now </span>
              <span style={{ color: "#9ca3af" }}>{currentApr.toFixed(2)}%</span>
            </div>
            <div style={{ color: "#2d2b45" }}>|</div>
            <div>
              <span style={{ color: "#4a4568" }}>Dir acc </span>
              <span style={{ color: "#9ca3af" }}>{(result.dirAccuracy * 100).toFixed(0)}%</span>
            </div>
          </div>

          {/* Reasoning */}
          <div className="text-[11px] leading-relaxed" style={{ color: "#6b7280" }}>
            {result.reasoning}
          </div>
        </div>
      )}

      {!loading && !error && !result && !onchainData.live && (
        <div className="text-[11px] font-mono py-2" style={{ color: "#2d2b45" }}>
          Loading market data…
        </div>
      )}
    </div>
  );
}
