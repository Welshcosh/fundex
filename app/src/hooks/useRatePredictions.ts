"use client";

import { useEffect, useState } from "react";
import { MarketInfo, DurationVariant } from "@/lib/constants";
import type { RateAdvisorOutput } from "@/app/api/ai/rate-advisor/route";

const DURATIONS: DurationVariant[] = [
  DurationVariant.Days7,
  DurationVariant.Days30,
  DurationVariant.Days90,
  DurationVariant.Days180,
];
const DUR_DAYS: Record<DurationVariant, 7 | 30 | 90 | 180> = {
  [DurationVariant.Days7]: 7,
  [DurationVariant.Days30]: 30,
  [DurationVariant.Days90]: 90,
  [DurationVariant.Days180]: 180,
};

export interface RatePredictions {
  /** One entry per DURATIONS index. null = not yet available. */
  predictions: (number | null)[];
  loading: boolean;
}

/**
 * Fetch ML rate-advisor predictions for a market across all four durations.
 * Reuses the existing `/api/ai/rate-advisor` endpoint (server caches 15min).
 * Used by Markets page to overlay ML predicted rates onto the term-structure curve.
 */
export function useRatePredictions(market: MarketInfo, oracleRate: number, enabled: boolean): RatePredictions {
  const [predictions, setPredictions] = useState<(number | null)[]>([null, null, null, null]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || oracleRate <= 0) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      const results = await Promise.all(
        DURATIONS.map(async (dur) => {
          try {
            const r = await fetch("/api/ai/rate-advisor", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                market: market.symbol as "BTC" | "ETH" | "SOL" | "JTO",
                duration: DUR_DAYS[dur],
                currentOracleRate: oracleRate,
              }),
            });
            if (!r.ok) return null;
            const data = (await r.json()) as RateAdvisorOutput;
            return data.recommendedFixedRate;
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      setPredictions(results);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [market.symbol, oracleRate, enabled]);

  return { predictions, loading };
}
