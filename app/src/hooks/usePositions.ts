"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { MARKETS, DurationVariant } from "@/lib/constants";
import { USDC_MINT, DRIFT_PRICE_PRECISION, MAINT_MARGIN_BPS } from "@/lib/fundex/constants";
import { PositionWithPnl } from "@/lib/fundex/client";
import { useFundexClient } from "./useFundexClient";

const ALL_DURATIONS = [
  DurationVariant.Days7,
  DurationVariant.Days30,
  DurationVariant.Days90,
  DurationVariant.Days180,
];

export interface OnchainPosition extends PositionWithPnl {
  perpIndex: number;
  duration: DurationVariant;
  marketName: string;
  userTokenAccount: ReturnType<typeof getAssociatedTokenAddressSync>;
  /** Settlements to liquidation at current oracle rate (null = safe / no risk) */
  settlementsToLiq: number | null;
}

interface PositionsState {
  positions: OnchainPosition[];
  loading: boolean;
  refresh: () => void;
}

export function usePositions(): PositionsState {
  const client = useFundexClient();
  const { publicKey } = useWallet();
  const [positions, setPositions] = useState<OnchainPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const inFlightRef = useRef(false);

  const fetch = useCallback(async () => {
    if (!client || !publicKey) { setPositions([]); return; }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      // Fetch oracles sequentially to stagger RPC burst
      const oracleRates: Record<number, number> = {};
      for (const m of MARKETS) {
        const oracle = await client.fetchOracle(m.perpIndex);
        oracleRates[m.perpIndex] = oracle?.emaFundingRate ?? m.baseRate;
      }

      // Fetch positions sequentially per market (4 at a time max) to avoid RPC burst
      const results: (OnchainPosition | null)[] = [];
      for (const market of MARKETS) {
        const batch = await Promise.all(
          ALL_DURATIONS.map(async (duration) => {
            const pos = await client.fetchPosition(publicKey, market.perpIndex, duration);
            if (!pos) return null;

            const variableRate = oracleRates[market.perpIndex] ?? market.baseRate;
            const pnlPerSettlement =
              (variableRate - pos.fixedRate) * pos.lots * pos.notionalPerLot / DRIFT_PRICE_PRECISION;
            const adjPnl = pos.side === 0 ? pnlPerSettlement : -pnlPerSettlement;
            const maintMargin = (pos.lots * pos.notionalPerLot * MAINT_MARGIN_BPS) / 10_000;
            const maxLossBuffer = pos.collateralDeposited + pos.unrealizedPnl - maintMargin;
            const settlementsToLiq =
              adjPnl < 0 && maxLossBuffer > 0
                ? Math.floor(maxLossBuffer / Math.abs(adjPnl))
                : null;

            return {
              ...pos,
              perpIndex: market.perpIndex,
              duration,
              marketName: market.name,
              userTokenAccount: getAssociatedTokenAddressSync(USDC_MINT, publicKey),
              settlementsToLiq,
            } satisfies OnchainPosition;
          })
        );
        results.push(...batch);
      }
      setPositions(results.filter((p): p is OnchainPosition => p !== null));
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }, [client, publicKey]);

  useEffect(() => { fetch(); }, [fetch]);

  // Auto-refresh every 60s
  useEffect(() => {
    const id = setInterval(fetch, 60_000);
    return () => clearInterval(id);
  }, [fetch]);

  return { positions, loading, refresh: fetch };
}
