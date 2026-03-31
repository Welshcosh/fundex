"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { MarketInfo, DurationVariant } from "@/lib/constants";
import { FUNDEX_PROGRAM_ID, NOTIONAL_PER_LOT_LAMPORTS } from "@/lib/fundex/constants";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const IDL = require("@/lib/fundex/idl.json");
import { oraclePda, marketPda } from "@/lib/fundex/pda";

export interface OnchainMarketData {
  /** Variable rate — oracle EMA funding rate (Drift units) */
  variableRate: number;
  /** Fixed rate — market's fixed leg (Drift units) */
  fixedRate: number;
  /** Open interest in USD (matched lots × $100) */
  oiUsd: number;
  /** Whether on-chain data loaded successfully */
  live: boolean;
  loading: boolean;
  refresh: () => void;
}

/** Read-only Anchor program (no wallet needed) */
function useReadonlyProgram() {
  const { connection } = useConnection();
  return useMemo(() => {
    const dummyKeypair = Keypair.generate();
    const dummyWallet: Wallet = {
      publicKey: dummyKeypair.publicKey,
      signTransaction: async (tx) => tx,
      signAllTransactions: async (txs) => txs,
      payer: dummyKeypair,
    };
    const provider = new AnchorProvider(connection, dummyWallet, { commitment: "confirmed" });
    return new Program(IDL, provider);
  }, [connection]);
}

export function useMarketData(market: MarketInfo, duration: DurationVariant): OnchainMarketData {
  const program = useReadonlyProgram();
  const [data, setData] = useState<Omit<OnchainMarketData, "loading" | "refresh">>({
    variableRate: market.baseRate,
    fixedRate: Math.round(market.baseRate * 0.92),
    oiUsd: 0,
    live: false,
  });
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const [oraclePubkey] = oraclePda(market.perpIndex);
      const [marketPubkey] = marketPda(market.perpIndex, duration);

      const [oracleAcc, marketAcc] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (program.account as any).rateOracle.fetch(oraclePubkey).catch(() => null),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (program.account as any).marketState.fetch(marketPubkey).catch(() => null),
      ]);

      if (!oracleAcc || !marketAcc) {
        // On-chain accounts not found — keep fallback values
        setData((prev) => ({ ...prev, live: false }));
        return;
      }

      const variableRate: number = oracleAcc.emaFundingRate.toNumber();
      const fixedRate: number = marketAcc.fixedRate.toNumber();
      const payerLots: number = marketAcc.totalFixedPayerLots.toNumber();
      const receiverLots: number = marketAcc.totalFixedReceiverLots.toNumber();
      const matchedLots = Math.min(payerLots, receiverLots);
      const oiUsd = (matchedLots * NOTIONAL_PER_LOT_LAMPORTS) / 1_000_000;

      setData({ variableRate, fixedRate, oiUsd, live: true });
    } catch {
      setData((prev) => ({ ...prev, live: false }));
    } finally {
      setLoading(false);
    }
  }, [program, market.perpIndex, duration]);

  useEffect(() => { fetch(); }, [fetch]);

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(fetch, 30_000);
    return () => clearInterval(id);
  }, [fetch]);

  return { ...data, loading, refresh: fetch };
}
