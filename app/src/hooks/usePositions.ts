"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { MARKETS, DurationVariant, Side } from "@/lib/constants";
import { DRIFT_PRICE_PRECISION, MAINT_MARGIN_BPS } from "@/lib/fundex/constants";
import { PositionWithPnl } from "@/lib/fundex/client";
import { useFundexClient } from "./useFundexClient";

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

/** Dispatch this to trigger an immediate refresh from anywhere (e.g. after
 *  `openPosition` confirms). The hook listens for it and skips the 60s wait. */
export const POSITIONS_REFRESH_EVENT = "fundex:positions:refresh";

export function usePositions(): PositionsState {
  const client = useFundexClient();
  const { publicKey } = useWallet();
  const [positions, setPositions] = useState<OnchainPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const inFlightRef = useRef(false);

  const fetch = useCallback(async () => {
    if (!client || !publicKey) {
      setPositions([]);
      return;
    }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      // 1) All user's Position accounts in one RPC (getProgramAccounts + memcmp).
      const userPositions = await client.fetchUserPositions(publicKey);
      if (userPositions.length === 0) {
        setPositions([]);
        return;
      }

      // 2) Unique market PDAs → single batched fetch.
      const uniqueMarketKeys = Array.from(
        new Set(userPositions.map((p) => p.market.toBase58())),
      );
      const uniqueMarketPdas = uniqueMarketKeys.map(
        (s) => userPositions.find((p) => p.market.toBase58() === s)!.market,
      );
      const marketStates = await client.fetchMarketsMulti(uniqueMarketPdas);

      const marketByKey = new Map(
        uniqueMarketKeys.map((k, i) => [k, marketStates[i]] as const),
      );

      // 3) Unique perp indices → single batched oracle fetch.
      const uniquePerpIndices = Array.from(
        new Set(
          marketStates
            .filter((m): m is NonNullable<typeof m> => m !== null)
            .map((m) => m.perpIndex),
        ),
      );
      const oracles = await client.fetchOraclesMulti(uniquePerpIndices);

      // 4) Assemble display rows (mirrors prior PnL math).
      const results: OnchainPosition[] = [];
      for (const p of userPositions) {
        const market = marketByKey.get(p.market.toBase58());
        if (!market) continue;
        // Derive ATA from THIS market's actual on-chain collateral mint, not
        // the global USDC_MINT constant. Markets created across different
        // USDC mock mints (e.g. after setup-devnet rotates the mint) would
        // otherwise hit `ConstraintTokenMint` (Anchor 2014) at close time.
        const ata = getAssociatedTokenAddressSync(market.collateralMint, publicKey);
        const marketMeta = MARKETS.find((mm) => mm.perpIndex === market.perpIndex);
        if (!marketMeta) continue;
        const duration = market.durationVariant as DurationVariant;

        const variableRate =
          oracles[market.perpIndex]?.emaFundingRate ?? marketMeta.baseRate;

        const actualDelta = market.cumulativeActualIndex - p.entryActualIndex;
        const fixedDelta = market.cumulativeFixedIndex - p.entryFixedIndex;
        const netDelta = actualDelta - fixedDelta;
        const rawPnl = (netDelta * p.lots * market.notionalPerLot) / DRIFT_PRICE_PRECISION;
        const unrealizedPnl = p.side === Side.FixedPayer ? rawPnl : -rawPnl;
        const notional = market.notionalPerLot * p.lots;
        const effective = p.collateralDeposited + unrealizedPnl;
        const marginRatioBps =
          notional > 0 ? Math.floor((Math.max(effective, 0) * 10_000) / notional) : 99_999;

        const pnlPerSettlement =
          ((variableRate - market.fixedRate) * p.lots * market.notionalPerLot) /
          DRIFT_PRICE_PRECISION;
        const adjPnl = p.side === Side.FixedPayer ? pnlPerSettlement : -pnlPerSettlement;
        const maintMargin = (p.lots * market.notionalPerLot * MAINT_MARGIN_BPS) / 10_000;
        const maxLossBuffer = p.collateralDeposited + unrealizedPnl - maintMargin;
        const settlementsToLiq =
          adjPnl < 0 && maxLossBuffer > 0 ? Math.floor(maxLossBuffer / Math.abs(adjPnl)) : null;

        results.push({
          address: p.pda,
          market: p.market,
          side: p.side,
          lots: p.lots,
          collateralDeposited: p.collateralDeposited,
          entryActualIndex: p.entryActualIndex,
          entryFixedIndex: p.entryFixedIndex,
          openTs: p.openTs,
          unrealizedPnl,
          marginRatioBps,
          expiryTs: market.expiryTs,
          fixedRate: market.fixedRate,
          notionalPerLot: market.notionalPerLot,
          perpIndex: market.perpIndex,
          duration,
          marketName: marketMeta.name,
          userTokenAccount: ata,
          settlementsToLiq,
        });
      }
      // Stable order (getProgramAccounts returns in arbitrary order).
      results.sort((a, b) => a.perpIndex - b.perpIndex || a.duration - b.duration);
      setPositions(results);
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }, [client, publicKey]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  // Manual refresh trigger via window event (fired by OrderPanel etc.
  // after a successful openPosition / closePosition — no 60s wait).
  useEffect(() => {
    const handler = () => fetch();
    window.addEventListener(POSITIONS_REFRESH_EVENT, handler);
    return () => window.removeEventListener(POSITIONS_REFRESH_EVENT, handler);
  }, [fetch]);

  // Background auto-refresh every 60s.
  useEffect(() => {
    const id = setInterval(fetch, 60_000);
    return () => clearInterval(id);
  }, [fetch]);

  return { positions, loading, refresh: fetch };
}
