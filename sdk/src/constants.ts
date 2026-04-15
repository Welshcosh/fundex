import { PublicKey } from "@solana/web3.js";

export const FUNDEX_PROGRAM_ID = new PublicKey(
  "BVyfQfmD6yCXqgqGQm6heYg85WYypqVxLnxb7MrGEKPb"
);

// Seeds
export const SEED_RATE_ORACLE = Buffer.from("rate_oracle");
export const SEED_MARKET = Buffer.from("market");
export const SEED_POSITION = Buffer.from("position");
export const SEED_VAULT = Buffer.from("vault");
export const SEED_POOL = Buffer.from("pool");
export const SEED_POOL_VAULT = Buffer.from("pool_vault");
export const SEED_LP_POSITION = Buffer.from("lp_position");

// On-chain constants
export const INITIAL_MARGIN_BPS = 1_000; // 10%
export const MAINT_MARGIN_BPS = 500;     // 5%
export const LIQUIDATION_REWARD_BPS = 300; // 3%
export const NOTIONAL_PER_LOT = 100_000_000; // 100 USDC (6 decimals)
export const DRIFT_PRICE_PRECISION = 1_000_000;

export enum DurationVariant {
  Days7  = 0,
  Days30 = 1,
  Days90 = 2,
  Days180 = 3,
}

export enum Side {
  FixedPayer    = 0, // pays fixed, receives variable
  FixedReceiver = 1, // receives fixed, pays variable
}

export const DURATION_LABELS: Record<DurationVariant, string> = {
  [DurationVariant.Days7]:   "7 days",
  [DurationVariant.Days30]:  "30 days",
  [DurationVariant.Days90]:  "90 days",
  [DurationVariant.Days180]: "180 days",
};
