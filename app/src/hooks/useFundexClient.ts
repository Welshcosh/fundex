"use client";

import { useMemo } from "react";
import { AnchorProvider } from "@coral-xyz/anchor";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { FundexClient } from "@/lib/fundex/client";
import { getProviderCommitment } from "@/lib/fundex/demo-mode";

export function useFundexClient(): FundexClient | null {
  const { connection } = useConnection();
  const wallet = useWallet();

  return useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) return null;

    const provider = new AnchorProvider(
      connection,
      {
        publicKey: wallet.publicKey,
        signTransaction: wallet.signTransaction,
        signAllTransactions: wallet.signAllTransactions,
      },
      { commitment: getProviderCommitment() }
    );

    return new FundexClient(provider);
  }, [connection, wallet.publicKey, wallet.signTransaction, wallet.signAllTransactions]);
}
