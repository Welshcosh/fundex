"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { FUNDEX_PROGRAM_ID } from "@/lib/fundex/constants";
import { oraclePda } from "@/lib/fundex/pda";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const IDL = require("@/lib/fundex/idl.json");

/** perpIndex → live EMA funding rate */
export type OracleRateMap = Record<number, number>;

export function useOracleRates(perpIndices: number[]): OracleRateMap {
  const { connection } = useConnection();
  const [rates, setRates] = useState<OracleRateMap>({});
  const inFlightRef = useRef(false);

  const program = useMemo(() => {
    const dummyKp = Keypair.generate();
    const dummyWallet: Wallet = {
      publicKey: dummyKp.publicKey,
      signTransaction: async (tx) => tx,
      signAllTransactions: async (txs) => txs,
      payer: dummyKp,
    };
    const provider = new AnchorProvider(connection, dummyWallet, { commitment: "confirmed" });
    return new Program(IDL, provider);
  }, [connection]);

  const fetch = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const entries: [number, number][] = [];
      for (const idx of perpIndices) {
        const [pda] = oraclePda(idx);
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const acc = await (program.account as any).rateOracle.fetch(pda);
          entries.push([idx, acc.emaFundingRate.toNumber()]);
        } catch {
          entries.push([idx, 0]);
        }
      }
      setRates(Object.fromEntries(entries));
    } finally {
      inFlightRef.current = false;
    }
  }, [program, perpIndices.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetch(); }, [fetch]);
  useEffect(() => {
    const id = setInterval(fetch, 60_000);
    return () => clearInterval(id);
  }, [fetch]);

  return rates;
}
