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

export function useRiskScore(
  pos: OnchainPosition,
  oracleRate: number | undefined
): RiskState {
  const [state, setState] = useState<RiskState>({ status: "idle" });
  const oracleRateRef = useRef(oracleRate);

  useEffect(() => {
    oracleRateRef.current = oracleRate;
  });

  useEffect(() => {
    let cancelled = false;

    setState({ status: "loading" });

    const delay = Math.random() * 500;
    const timer = setTimeout(() => {
      if (cancelled) return;

      const rate = oracleRateRef.current ?? 0;
      const now = Math.floor(Date.now() / 1000);
      const daysToExpiry = Math.max(0, (pos.expiryTs - now) / 86400);
      const notionalUsd = (pos.lots * NOTIONAL_PER_LOT_LAMPORTS) / 1_000_000;

      const input: RiskInput = {
        side: pos.side,
        marginRatioBps: pos.marginRatioBps,
        unrealizedPnl: pos.unrealizedPnl,
        collateralDeposited: pos.collateralDeposited,
        fixedRate: pos.fixedRate,
        currentOracleRate: rate,
        totalFixedPayerLots: 0,
        totalFixedReceiverLots: 0,
        daysToExpiry,
        notionalUsd,
      };

      fetch("/api/ai/risk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((data) => {
          if (cancelled) return;
          if (data.error) setState({ status: "error" });
          else setState({ status: "done", data: data as RiskOutput });
        })
        .catch(() => {
          if (!cancelled) setState({ status: "error" });
        });
    }, delay);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pos.address.toString()]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}
