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

function DirectionIcon({ dir, size = 28 }: { dir: "up" | "down" | "neutral"; size?: number }) {
  if (dir === "up") return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M8 3L13 10H3L8 3Z" fill="#2dd4bf" />
    </svg>
  );
  if (dir === "down") return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M8 13L3 6H13L8 13Z" fill="#f87171" />
    </svg>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M3 8H13M10 5L13 8L10 11" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ConfidencePill({ confidence }: { confidence: "high" | "medium" | "low" }) {
  const colors = {
    high: { bg: "rgba(45,212,191,0.15)", text: "#2dd4bf", border: "rgba(45,212,191,0.35)" },
    medium: { bg: "rgba(251,191,36,0.12)", text: "#fbbf24", border: "rgba(251,191,36,0.30)" },
    low: { bg: "rgba(107,114,128,0.12)", text: "#9ca3af", border: "rgba(107,114,128,0.25)" },
  };
  const c = colors[confidence];
  return (
    <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full"
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
      {confidence} conf
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
  const dirLabel = result?.direction === "up" ? "UP" : result?.direction === "down" ? "DOWN" : "NEUTRAL";
  const dirColor =
    result?.direction === "up" ? "#2dd4bf" :
    result?.direction === "down" ? "#f87171" : "#9ca3af";
  const recommendedSide = result?.direction === "up" ? "Fixed Payer" : result?.direction === "down" ? "Fixed Receiver" : "—";

  return (
    <div
      className="px-4 py-4"
      style={{
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        background: "linear-gradient(180deg, rgba(153,69,255,0.06) 0%, #0a0918 70%)",
      }}
    >
      {/* Header — stronger, branded */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center justify-center rounded-md text-[10px] font-bold"
            style={{
              background: "linear-gradient(135deg, #9945ff, #43b4ca)",
              color: "white",
              width: 20,
              height: 20,
            }}
            aria-label="ML"
          >
            🧮
          </span>
          <div className="flex flex-col leading-none">
            <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "#c4b5fd" }}>
              AI Rate Advisor
            </span>
            <span className="text-[9px] font-mono mt-0.5" style={{ color: "#6b6890" }}>
              ML ensemble · {DURATION_LABELS[duration] ?? "30d"} horizon
            </span>
          </div>
        </div>
        <button
          onClick={() => {
            fetchedKeyRef.current = "";
            setResult(null);
            setError(false);
          }}
          className="text-[10px] font-mono transition-colors"
          style={{ color: "#4a4568" }}
          onMouseEnter={e => (e.currentTarget.style.color = "#c4b5fd")}
          onMouseLeave={e => (e.currentTarget.style.color = "#4a4568")}
        >
          ↻
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-6 justify-center">
          <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#9945ff" }} />
          <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#9945ff", animationDelay: "0.15s" }} />
          <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#9945ff", animationDelay: "0.30s" }} />
          <span className="text-[11px] font-mono ml-2" style={{ color: "#6b6890" }}>Analyzing {market.symbol}…</span>
        </div>
      )}

      {error && (
        <div className="text-[11px] font-mono py-4 text-center" style={{ color: "#4a4568" }}>
          Advisor unavailable
        </div>
      )}

      {result && !loading && (
        <div className="space-y-3">
          {/* Hero — direction + confidence */}
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center rounded-xl"
              style={{
                width: 56,
                height: 56,
                background: `${dirColor}12`,
                border: `1px solid ${dirColor}30`,
              }}
            >
              <DirectionIcon dir={result.direction} size={32} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[18px] font-bold leading-none" style={{ color: dirColor, letterSpacing: "-0.5px" }}>
                  {dirLabel}
                </span>
                <ConfidencePill confidence={result.confidence} />
              </div>
              <div className="text-[10px] font-mono mt-1" style={{ color: "#9ca3af" }}>
                Recommended side: <span style={{ color: "#c4b5fd", fontWeight: 600 }}>{recommendedSide}</span>
              </div>
            </div>
          </div>

          {/* Recommended rate — large & prominent */}
          <div
            className="rounded-xl px-3 py-2.5"
            style={{
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: "#6b6890" }}>
                Recommended fixed rate
              </span>
              <span className="text-[9px] font-mono" style={{ color: "#4a4568" }}>
                vs oracle {currentApr.toFixed(2)}%
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-mono font-bold text-2xl leading-none" style={{ color: dirColor, letterSpacing: "-1px" }}>
                {recommendedApr !== null ? `${recommendedApr >= 0 ? "+" : ""}${recommendedApr.toFixed(2)}` : "—"}
              </span>
              <span className="text-[11px] font-mono font-semibold" style={{ color: "#6b6890" }}>% APR</span>
            </div>
          </div>

          {/* Reasoning — Claude */}
          <div
            className="rounded-xl px-3 py-2.5"
            style={{
              background: "rgba(153,69,255,0.04)",
              border: "1px solid rgba(153,69,255,0.08)",
            }}
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-[10px]" aria-label="LLM">💬</span>
              <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "#c4b5fd" }}>
                Claude says
              </span>
            </div>
            <div className="text-[11px] leading-relaxed" style={{ color: "#d1d5db" }}>
              {result.reasoning}
            </div>
          </div>

          {/* Footer stat — dir accuracy for credibility */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: "#4a4568" }}>
              out-of-sample dir acc
            </span>
            <span className="text-[10px] font-mono font-semibold" style={{ color: "#9ca3af" }}>
              {(result.dirAccuracy * 100).toFixed(1)}%
            </span>
          </div>
        </div>
      )}

      {!loading && !error && !result && !onchainData.live && (
        <div className="text-[11px] font-mono py-4 text-center" style={{ color: "#2d2b45" }}>
          Loading market data…
        </div>
      )}
    </div>
  );
}
