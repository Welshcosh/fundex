import { DurationVariant } from "./constants";

export interface MockPosition {
  id: string;
  market: string;
  duration: DurationVariant;
  side: "Fixed Payer" | "Fixed Receiver";
  lots: number;
  notional: number;
  collateral: number;
  pnl: number;
  marginRatio: number;
  entryRate: number;
  currentRate: number;
  openTs: number;
}

export const MOCK_POSITIONS: MockPosition[] = [
  {
    id: "1",
    market: "SOL-PERP",
    duration: DurationVariant.Days30,
    side: "Fixed Payer",
    lots: 10,
    notional: 1000,
    collateral: 100,
    pnl: 12.45,
    marginRatio: 1123,
    entryRate: 8200,
    currentRate: 12100,
    openTs: Date.now() - 86400000 * 2,
  },
  {
    id: "2",
    market: "BTC-PERP",
    duration: DurationVariant.Days90,
    side: "Fixed Receiver",
    lots: 5,
    notional: 500,
    collateral: 50,
    pnl: -3.22,
    marginRatio: 934,
    entryRate: 9100,
    currentRate: 8500,
    openTs: Date.now() - 86400000,
  },
];
