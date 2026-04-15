import { PublicKey } from "@solana/web3.js";

export const FUNDEX_PROGRAM_ID = new PublicKey("BVyfQfmD6yCXqgqGQm6heYg85WYypqVxLnxb7MrGEKPb");

/** 100 USDC in lamports (6 decimals) */
export const NOTIONAL_PER_LOT_LAMPORTS = 100_000_000;

export const INITIAL_MARGIN_BPS = 1_000;
export const MAINT_MARGIN_BPS = 500;
export const DRIFT_PRICE_PRECISION = 1_000_000;

/**
 * Devnet USDC mint — set NEXT_PUBLIC_USDC_MINT env var to override.
 * Default: Circle devnet USDC
 */
export const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);
