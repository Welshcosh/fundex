import { PublicKey } from "@solana/web3.js";

export const FUNDEX_PROGRAM_ID = new PublicKey(
  "BVyfQfmD6yCXqgqGQm6heYg85WYypqVxLnxb7MrGEKPb"
);

export const NOTIONAL_PER_LOT = 100; // 100 USDC per lot
export const INITIAL_MARGIN_BPS = 1000; // 10%
export const MAINT_MARGIN_BPS = 500; // 5%
export const DRIFT_PRICE_PRECISION = 1_000_000;

export enum DurationVariant {
  Days7 = 0,
  Days30 = 1,
  Days90 = 2,
  Days180 = 3,
}

export enum Side {
  FixedPayer = 0,
  FixedReceiver = 1,
}

export const DURATION_LABELS: Record<DurationVariant, string> = {
  [DurationVariant.Days7]: "7D",
  [DurationVariant.Days30]: "30D",
  [DurationVariant.Days90]: "90D",
  [DurationVariant.Days180]: "180D",
};

export const DURATION_FULL_LABELS: Record<DurationVariant, string> = {
  [DurationVariant.Days7]: "7 Days",
  [DurationVariant.Days30]: "30 Days",
  [DurationVariant.Days90]: "90 Days",
  [DurationVariant.Days180]: "180 Days",
};

export interface MarketInfo {
  perpIndex: number;
  name: string;
  symbol: string;
  baseRate: number; // simulated current funding rate (bps)
}

export const MARKETS: MarketInfo[] = [
  { perpIndex: 0, name: "BTC-PERP", symbol: "BTC", baseRate: 8500 },
  { perpIndex: 1, name: "ETH-PERP", symbol: "ETH", baseRate: 5200 },
  { perpIndex: 2, name: "SOL-PERP", symbol: "SOL", baseRate: 12100 },
  { perpIndex: 3, name: "JTO-PERP", symbol: "JTO", baseRate: 3300 },
];
