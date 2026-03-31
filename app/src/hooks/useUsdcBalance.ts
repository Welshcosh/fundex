"use client";

import { useEffect, useState, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { USDC_MINT } from "@/lib/fundex/constants";

interface UsdcBalance {
  /** raw lamports (6 decimals) */
  lamports: number;
  /** human-readable USDC amount */
  usd: number;
  loading: boolean;
  refresh: () => void;
}

export function useUsdcBalance(): UsdcBalance {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [lamports, setLamports] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    if (!publicKey) { setLamports(0); return; }
    setLoading(true);
    try {
      const ata = getAssociatedTokenAddressSync(USDC_MINT, publicKey);
      const info = await connection.getTokenAccountBalance(ata);
      setLamports(Number(info.value.amount));
    } catch {
      // ATA doesn't exist yet → balance is 0
      setLamports(0);
    } finally {
      setLoading(false);
    }
  }, [connection, publicKey]);

  useEffect(() => { fetch(); }, [fetch]);

  return { lamports, usd: lamports / 1_000_000, loading, refresh: fetch };
}
