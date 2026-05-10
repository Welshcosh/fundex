"use client";

import {
  ComputeBudgetProgram,
  type Commitment,
  type ConfirmOptions,
  type TransactionInstruction,
} from "@solana/web3.js";

// Toggled by NEXT_PUBLIC_DEMO_MODE=true. Affects only how transactions are
// sent — never the on-chain program, math, or rate model. Off by default so
// production never silently inherits demo-only relaxations (skipPreflight).
const DEMO_PRIORITY_PRICE_MICROLAMPORTS = 100_000;
const DEMO_COMPUTE_UNIT_LIMIT = 400_000;

export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}

export function getDemoPriorityIxs(): TransactionInstruction[] {
  if (!isDemoMode()) return [];
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: DEMO_COMPUTE_UNIT_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: DEMO_PRIORITY_PRICE_MICROLAMPORTS,
    }),
  ];
}

export function getDemoSendOpts(): ConfirmOptions | undefined {
  if (!isDemoMode()) return undefined;
  return {
    skipPreflight: true,
    commitment: "processed",
    preflightCommitment: "processed",
  };
}

export function getProviderCommitment(): Commitment {
  return isDemoMode() ? "processed" : "confirmed";
}
