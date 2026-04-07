"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { AnchorProvider, Program, EventParser, Wallet } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import { DurationVariant } from "@/lib/constants";
import { FUNDEX_PROGRAM_ID } from "@/lib/fundex/constants";
import { marketPda } from "@/lib/fundex/pda";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const IDL = require("@/lib/fundex/idl.json");

export interface RatePoint {
  ts: number;       // unix timestamp
  actualRate: number;
  fixedRate: number;
}

export function useRateHistory(
  perpIndex: number,
  duration: DurationVariant,
  limit = 60
): { points: RatePoint[]; loading: boolean } {
  const { connection } = useConnection();
  const [points, setPoints] = useState<RatePoint[]>([]);
  const [loading, setLoading] = useState(false);

  const program = useMemo(() => {
    const kp = Keypair.generate();
    const wallet: Wallet = {
      publicKey: kp.publicKey,
      signTransaction: async (tx) => tx,
      signAllTransactions: async (txs) => txs,
      payer: kp,
    };
    return new Program(IDL, new AnchorProvider(connection, wallet, { commitment: "confirmed" }));
  }, [connection]);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const [mkt] = marketPda(perpIndex, duration);

      // Get recent signatures where the market account was written (settleFunding touches it)
      const sigs = await connection.getSignaturesForAddress(mkt, { limit });

      // Fetch all transactions in parallel
      const txResults = await Promise.all(
        sigs.map((s) =>
          connection
            .getTransaction(s.signature, {
              maxSupportedTransactionVersion: 0,
              commitment: "confirmed",
            })
            .then((tx) => ({ blockTime: s.blockTime, tx }))
            .catch(() => null)
        )
      );

      const parser = new EventParser(FUNDEX_PROGRAM_ID, program.coder);
      const collected: RatePoint[] = [];

      for (const item of txResults) {
        if (!item?.tx?.meta?.logMessages) continue;
        for (const event of parser.parseLogs(item.tx.meta.logMessages)) {
          if (event.name === "FundingSettled") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const d = event.data as any;
            collected.push({
              ts: item.blockTime ?? 0,
              actualRate: d.actualRate.toNumber(),
              fixedRate: d.fixedRate.toNumber(),
            });
          }
        }
      }

      // Sort oldest → newest
      setPoints(collected.sort((a, b) => a.ts - b.ts));
    } catch {
      // silently keep last known state
    } finally {
      setLoading(false);
    }
  }, [connection, program, perpIndex, duration, limit]);

  useEffect(() => { fetch(); }, [fetch]);

  // Refresh every 60s
  useEffect(() => {
    const id = setInterval(fetch, 60_000);
    return () => clearInterval(id);
  }, [fetch]);

  return { points, loading };
}
