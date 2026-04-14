"use client";

import { FC, ReactNode, useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";

interface Props {
  children: ReactNode;
}

/** Global RPC gate: max 4 concurrent, min 80ms gap between requests, retry once on 429 */
function createLimitedFetch(concurrency = 4, minGapMs = 80) {
  let active = 0;
  let lastStart = 0;
  const waiters: (() => void)[] = [];

  const release = () => {
    active--;
    const next = waiters.shift();
    if (next) next();
  };

  const acquire = () =>
    new Promise<void>((resolve) => {
      const tryRun = () => {
        if (active < concurrency) {
          active++;
          const now = Date.now();
          const wait = Math.max(0, lastStart + minGapMs - now);
          lastStart = now + wait;
          if (wait > 0) setTimeout(resolve, wait);
          else resolve();
        } else {
          waiters.push(tryRun);
        }
      };
      tryRun();
    });

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    await acquire();
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch(input, init);
        if (res.status === 429) {
          const backoff = 400 * Math.pow(2, attempt) + Math.random() * 200;
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        return res;
      }
      return await fetch(input, init);
    } finally {
      release();
    }
  };
}

export const WalletContextProvider: FC<Props> = ({ children }) => {
  const endpoint = useMemo(
    () => process.env.NEXT_PUBLIC_RPC_URL ?? clusterApiUrl("devnet"),
    []
  );

  const config = useMemo(
    () => ({ commitment: "confirmed" as const, fetch: createLimitedFetch() }),
    []
  );

  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint} config={config}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};
