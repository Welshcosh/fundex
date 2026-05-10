"use client";

import { useEffect, useRef, useState } from "react";
import { MarketInfo, DurationVariant } from "@/lib/constants";
import { OnchainMarketData } from "@/hooks/useMarketData";
import { RateAdvisorOutput } from "@/app/api/ai/rate-advisor/route";
import { rateToAprPct } from "@/lib/utils";

const DUR_LABEL: Record<number, string> = { 0: "7d", 1: "30d", 2: "90d", 3: "180d" };

const CONF_COLOR = {
  high: "#2dd4bf",
  medium: "#fbbf24",
  low: "#9ca3af",
} as const;

interface Props {
  market: MarketInfo;
  duration: DurationVariant;
  onchainData: OnchainMarketData;
}

export function RateAdvisorBanner({ market, duration, onchainData }: Props) {
  const [result, setResult] = useState<RateAdvisorOutput | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchedKeyRef = useRef<string>("");

  const oracleRate = onchainData.variableRate;
  const fetchKey = `${market.symbol}-${duration}`;

  useEffect(() => {
    if (!onchainData.live || oracleRate <= 0) return;
    if (fetchedKeyRef.current === fetchKey) return;
    fetchedKeyRef.current = fetchKey;

    let cancelled = false;
    setLoading(true);
    setResult(null);

    const market_key = market.symbol as "BTC" | "ETH" | "SOL" | "JTO";
    const durMap: Record<number, 7 | 30 | 90 | 180> = { 0: 7, 1: 30, 2: 90, 3: 180 };
    const body = JSON.stringify({
      market: market_key,
      duration: durMap[duration] ?? 30,
      currentOracleRate: oracleRate,
    });

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
            await new Promise((res) =>
              setTimeout(res, 800 * Math.pow(2, attempt) + Math.random() * 400),
            );
            continue;
          }
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const data = await r.json();
          if (!cancelled) {
            setResult(data);
            setLoading(false);
          }
          return;
        } catch {
          if (!cancelled) setLoading(false);
          return;
        }
      }
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchKey, onchainData.live, oracleRate, market.symbol, duration]);

  const dirColor =
    result?.direction === "up" ? "#2dd4bf"
    : result?.direction === "down" ? "#f87171"
    : "#9ca3af";
  const dirGlyph = result?.direction === "up" ? "▲" : result?.direction === "down" ? "▼" : "◆";
  const dirLabel = result?.direction === "up" ? "UP" : result?.direction === "down" ? "DOWN" : "NEUTRAL";
  const recommendedApr = result ? rateToAprPct(result.recommendedFixedRate) : null;
  const sideHint =
    result?.direction === "up" ? "Fixed Payer"
    : result?.direction === "down" ? "Fixed Receiver"
    : "—";

  return (
    <div
      className="flex items-center gap-4 px-5 h-[68px] flex-shrink-0 overflow-hidden"
      style={{
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        background:
          "linear-gradient(90deg, rgba(153,69,255,0.08) 0%, rgba(67,180,202,0.04) 50%, transparent 100%)",
      }}
    >
      <div className="flex items-center gap-2 flex-shrink-0">
        <span
          className="inline-flex items-center justify-center rounded-md text-[10px] font-bold"
          style={{
            background: "linear-gradient(135deg, #9945ff, #43b4ca)",
            color: "white",
            width: 22,
            height: 22,
          }}
          aria-label="ML"
        >
          🧮
        </span>
        <div className="flex flex-col leading-tight">
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#c4b5fd" }}>
            AI Rate Advisor
          </span>
          <span className="text-[9px] font-mono" style={{ color: "#6b6890" }}>
            ML · {DUR_LABEL[duration] ?? "30d"} horizon
          </span>
        </div>
      </div>

      <div className="h-8 w-px flex-shrink-0" style={{ background: "rgba(255,255,255,0.06)" }} />

      {loading || !result ? (
        <div className="flex items-center gap-2 text-[11px] font-mono" style={{ color: "#6b6890" }}>
          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#9945ff" }} />
          Analyzing {market.symbol}…
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className="font-bold text-base leading-none" style={{ color: dirColor, letterSpacing: "-0.3px" }}>
              {dirGlyph} {dirLabel}
            </span>
            <div className="flex flex-col leading-tight">
              <span className="text-[9px] uppercase tracking-wider" style={{ color: "#6b6890" }}>
                Rec. fixed rate
              </span>
              <span className="font-mono font-bold text-sm" style={{ color: dirColor }}>
                {recommendedApr !== null
                  ? `${recommendedApr >= 0 ? "+" : ""}${recommendedApr.toFixed(2)}% APR`
                  : "—"}
              </span>
            </div>
            <span
              className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
              style={{
                background: `${CONF_COLOR[result.confidence]}20`,
                color: CONF_COLOR[result.confidence],
                border: `1px solid ${CONF_COLOR[result.confidence]}40`,
              }}
            >
              {result.confidence}
            </span>
            <div className="hidden md:flex flex-col leading-tight">
              <span className="text-[9px] uppercase tracking-wider" style={{ color: "#6b6890" }}>
                Side hint
              </span>
              <span className="text-[11px] font-semibold" style={{ color: "#c4b5fd" }}>
                {sideHint}
              </span>
            </div>
          </div>

          <div className="hidden md:block h-8 w-px flex-shrink-0" style={{ background: "rgba(255,255,255,0.06)" }} />

          <div className="hidden md:flex items-center gap-1.5 flex-1 min-w-0">
            <span className="text-[10px] flex-shrink-0">💬</span>
            <span
              className="text-[11px] truncate leading-snug"
              style={{ color: "#d1d5db" }}
              title={result.reasoning}
            >
              {result.reasoning}
            </span>
          </div>

          <div className="hidden lg:flex flex-col items-end leading-tight flex-shrink-0">
            <span className="text-[9px] uppercase tracking-wider" style={{ color: "#4a4568" }}>
              OOS dir acc
            </span>
            <span className="font-mono text-[11px] font-semibold" style={{ color: "#9ca3af" }}>
              {(result.dirAccuracy * 100).toFixed(1)}%
            </span>
          </div>
        </>
      )}
    </div>
  );
}
