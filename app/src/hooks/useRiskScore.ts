"use client";

import { useState, useEffect, useRef } from "react";
import type { RiskInput, RiskOutput } from "@/app/api/ai/risk/route";
import type { OnchainPosition } from "./usePositions";
import { NOTIONAL_PER_LOT_LAMPORTS } from "@/lib/fundex/constants";

export type RiskState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; data: RiskOutput }
  | { status: "error" };

let riskQueue: Promise<unknown> = Promise.resolve();

async function fetchRiskQueued(input: RiskInput, signal: { cancelled: boolean }): Promise<RiskOutput> {
  const run = async (): Promise<RiskOutput> => {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (signal.cancelled) throw new Error("cancelled");
      const r = await fetch("/api/ai/risk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (r.status === 429) {
        const backoff = 500 * Math.pow(2, attempt) + Math.random() * 300;
        await new Promise((res) => setTimeout(res, backoff));
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as RiskOutput;
    }
    throw new Error("rate limited");
  };
  const next = riskQueue.then(run, run);
  riskQueue = next.catch(() => undefined);
  return next;
}

export interface RiskOi {
  payerLots: number;
  receiverLots: number;
}

export function useRiskScore(
  pos: OnchainPosition,
  oracleRate: number | undefined,
  oi?: RiskOi
): RiskState {
  const [state, setState] = useState<RiskState>({ status: "idle" });
  const cancelSignal = useRef<{ cancelled: boolean } | null>(null);

  // Bucket inputs at the same granularity the server uses for its cache key,
  // so the effect only refetches when the LLM would actually return a new answer.
  const rate = oracleRate ?? 0;
  const now = Math.floor(Date.now() / 1000);
  const daysToExpiry = Math.max(0, (pos.expiryTs - now) / 86400);
  const notionalUsd = (pos.lots * NOTIONAL_PER_LOT_LAMPORTS) / 1_000_000;
  const payerLots = oi?.payerLots ?? 0;
  const receiverLots = oi?.receiverLots ?? 0;

  const bucketKey = [
    pos.address.toString(),
    pos.side,
    Math.round(pos.marginRatioBps / 50),
    Math.round(pos.fixedRate / 1_000_000),
    Math.round(rate / 1_000_000),
    Math.round(daysToExpiry * 2),
    Math.round(notionalUsd / 100),
    // OI imbalance ratio (not rate): flips sides at 10% buckets — enough to move reasoning.
    payerLots + receiverLots > 0
      ? Math.round((payerLots / (payerLots + receiverLots)) * 10)
      : -1,
  ].join("|");

  useEffect(() => {
    let cancelled = false;

    setState({ status: "loading" });

    const delay = Math.random() * 500;
    const timer = setTimeout(() => {
      if (cancelled) return;

      const input: RiskInput = {
        side: pos.side,
        marginRatioBps: pos.marginRatioBps,
        unrealizedPnl: pos.unrealizedPnl,
        collateralDeposited: pos.collateralDeposited,
        fixedRate: pos.fixedRate,
        currentOracleRate: rate,
        totalFixedPayerLots: payerLots,
        totalFixedReceiverLots: receiverLots,
        daysToExpiry,
        notionalUsd,
      };

      const signal = { cancelled: false };
      cancelSignal.current = signal;

      fetchRiskQueued(input, signal)
        .then((data) => {
          if (cancelled) return;
          setState({ status: "done", data });
        })
        .catch(() => {
          if (!cancelled) setState({ status: "error" });
        });
    }, delay);

    return () => {
      cancelled = true;
      if (cancelSignal.current) cancelSignal.current.cancelled = true;
      clearTimeout(timer);
    };
  }, [bucketKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}
