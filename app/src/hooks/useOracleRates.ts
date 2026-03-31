"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
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
    const entries = await Promise.all(
      perpIndices.map(async (idx) => {
        const [pda] = oraclePda(idx);
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const acc = await (program.account as any).rateOracle.fetch(pda);
          return [idx, acc.emaFundingRate.toNumber()] as const;
        } catch {
          return [idx, 0] as const;
        }
      })
    );
    setRates(Object.fromEntries(entries));
  }, [program, perpIndices.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetch(); }, [fetch]);
  useEffect(() => {
    const id = setInterval(fetch, 30_000);
    return () => clearInterval(id);
  }, [fetch]);

  return rates;
}
