/// <reference types="node" />
/**
 * backtest-funding.ts
 *
 * Pull historical funding rate records from Drift Data API and compute
 * the core "why this product makes money" statistics used throughout the
 * Fundex pitch, README, and whitepaper.
 *
 * Usage:
 *   yarn backtest:funding                  # 12 months, SOL + BTC
 *   MONTHS=6 yarn backtest:funding         # last 6 months
 *   MARKETS=SOL-PERP yarn backtest:funding
 *
 * Output:
 *   data/funding/<SYMBOL>.csv              raw hourly records
 *   data/funding/summary.json              computed stats (reused by UI / docs)
 */

import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const httpFetch: (url: string) => Promise<any> = (globalThis as any).fetch;

const BASE = "https://data.api.drift.trade";
const MONTHS_BACK = Number(process.env.MONTHS ?? 12);
const MARKETS = (process.env.MARKETS ?? "SOL-PERP,BTC-PERP").split(",");
const OUT_DIR = path.join(__dirname, "..", "data", "funding");
const REQ_GAP_MS = Number(process.env.REQ_GAP_MS ?? 60);

interface FundingRecord {
  ts: number;
  fundingRate: string;
  fundingRateLong: string;
  fundingRateShort: string;
  oraclePriceTwap: string;
  markPriceTwap: string;
  periodRevenue: string;
}

interface ApiResponse {
  success: boolean;
  records: FundingRecord[];
  meta: { nextPage?: number | null };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url: string, maxRetries = 5): Promise<ApiResponse> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await httpFetch(url);
    if (res.status === 429) {
      const backoff = 500 * 2 ** attempt + Math.random() * 200;
      await sleep(backoff);
      continue;
    }
    if (!res.ok) {
      throw new Error(`${url} → HTTP ${res.status}`);
    }
    return (await res.json()) as ApiResponse;
  }
  throw new Error(`${url} → exhausted retries`);
}

async function fetchDay(
  symbol: string,
  year: number,
  month: number,
  day: number,
): Promise<FundingRecord[]> {
  const out: FundingRecord[] = [];
  let page = 1;
  // Drift settles ~hourly → 24 records/day, max 20 per page → at most 2 pages
  while (true) {
    const url = `${BASE}/market/${symbol}/fundingRates/${year}/${month}/${day}?page=${page}`;
    const body = await fetchJson(url);
    if (!body.records || body.records.length === 0) break;
    out.push(...body.records);
    const next = body.meta?.nextPage;
    if (next && next !== page) {
      page = next;
      await sleep(REQ_GAP_MS);
    } else {
      break;
    }
  }
  return out;
}

function* dayRange(monthsBack: number): Generator<[number, number, number]> {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - monthsBack);
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    yield [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
  }
}

async function fetchMarket(symbol: string): Promise<FundingRecord[]> {
  const all: FundingRecord[] = [];
  let dayCount = 0;
  const totalDays = Math.round(MONTHS_BACK * 30.5);
  console.log(`\n▶ ${symbol}: pulling ~${totalDays} days`);
  for (const [y, m, d] of dayRange(MONTHS_BACK)) {
    try {
      const recs = await fetchDay(symbol, y, m, d);
      all.push(...recs);
    } catch (e) {
      console.warn(`  ! ${symbol} ${y}-${m}-${d}: ${(e as Error).message}`);
    }
    dayCount++;
    if (dayCount % 30 === 0) {
      console.log(
        `  ${symbol}: ${dayCount}/${totalDays} days, ${all.length} records`,
      );
    }
    await sleep(REQ_GAP_MS);
  }
  // De-dupe on ts (archive and pagination can repeat edges) and sort ascending
  const seen = new Set<number>();
  const deduped = all.filter((r) => {
    if (seen.has(r.ts)) return false;
    seen.add(r.ts);
    return true;
  });
  deduped.sort((a, b) => a.ts - b.ts);
  return deduped;
}

interface Summary {
  market: string;
  records: number;
  periodDays: number;
  firstTs: number;
  lastTs: number;
  avgHourlyRatePctOfPrice: number; // fundingRate / oraclePrice × 100, per hour
  avgAnnualizedPct: number; // × 8760
  stdAnnualizedPct: number;
  medianAnnualizedPct: number;
  p05AnnualizedPct: number;
  p95AnnualizedPct: number;
  pctHoursPositive: number;
  // Hedger perspective: how much did a long-side trader pay on a $1 notional position
  // over the full period, holding continuously. Positive = longs paid, negative = longs received.
  realizedLongPnlPerDollarNotional: number;
  realizedLongAprPct: number;
  // Settled dollar volume on Drift itself (sum of periodRevenue) — rough proxy for market size
  totalPeriodRevenueUsd: number;
}

function computeSummary(market: string, recs: FundingRecord[]): Summary {
  // Drift convention: fundingRate is a dollar amount per base asset per hour.
  // Longs pay fundingRateLong, shorts pay fundingRateShort. We use the avg `fundingRate`
  // normalized by oraclePriceTwap to get a per-hour % of notional, which annualizes cleanly.
  const hourlyPctSeries: number[] = [];
  let longPaidPerDollar = 0;
  for (const r of recs) {
    const rate = Number(r.fundingRate);
    const px = Number(r.oraclePriceTwap);
    if (!px) continue;
    const hourlyPct = (rate / px) * 100;
    hourlyPctSeries.push(hourlyPct);
    // A long with $1 notional holds 1/px base units; pays rate per hour per base.
    // Dollar cost per hour = (1/px) * rate. Accumulate.
    longPaidPerDollar += rate / px;
  }
  const n = hourlyPctSeries.length;
  const mean = hourlyPctSeries.reduce((s, x) => s + x, 0) / n;
  const variance = hourlyPctSeries.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
  const sorted = [...hourlyPctSeries].sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(n - 1, Math.floor(n * p))];
  const firstTs = recs[0].ts;
  const lastTs = recs[recs.length - 1].ts;
  const periodDays = (lastTs - firstTs) / 86400;
  const annualFactor = 8760; // hours in a year
  const periodFactor = 8760 / (periodDays * 24); // scale period P&L → APR
  const totalPeriodRevenueUsd = recs.reduce(
    (s, r) => s + Number(r.periodRevenue),
    0,
  );
  return {
    market,
    records: n,
    periodDays: Number(periodDays.toFixed(2)),
    firstTs,
    lastTs,
    avgHourlyRatePctOfPrice: Number(mean.toFixed(6)),
    avgAnnualizedPct: Number((mean * annualFactor).toFixed(3)),
    stdAnnualizedPct: Number(
      (Math.sqrt(variance) * annualFactor).toFixed(3),
    ),
    medianAnnualizedPct: Number((pct(0.5) * annualFactor).toFixed(3)),
    p05AnnualizedPct: Number((pct(0.05) * annualFactor).toFixed(3)),
    p95AnnualizedPct: Number((pct(0.95) * annualFactor).toFixed(3)),
    pctHoursPositive: Number(
      ((hourlyPctSeries.filter((h) => h > 0).length / n) * 100).toFixed(2),
    ),
    realizedLongPnlPerDollarNotional: Number(longPaidPerDollar.toFixed(6)),
    realizedLongAprPct: Number((longPaidPerDollar * 100 * periodFactor).toFixed(3)),
    totalPeriodRevenueUsd: Number(totalPeriodRevenueUsd.toFixed(2)),
  };
}

function writeCsv(symbol: string, recs: FundingRecord[]) {
  const p = path.join(OUT_DIR, `${symbol}.csv`);
  const header =
    "ts,fundingRate,fundingRateLong,fundingRateShort,oraclePriceTwap,markPriceTwap,periodRevenue";
  const lines = [header];
  for (const r of recs) {
    lines.push(
      [
        r.ts,
        r.fundingRate,
        r.fundingRateLong,
        r.fundingRateShort,
        r.oraclePriceTwap,
        r.markPriceTwap,
        r.periodRevenue,
      ].join(","),
    );
  }
  fs.writeFileSync(p, lines.join("\n"));
  return p;
}

function printSummary(s: Summary) {
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  console.log(`\n═══ ${s.market} ═══`);
  console.log(`  records:              ${s.records}`);
  console.log(`  period:               ${s.periodDays.toFixed(1)} days`);
  console.log(`  avg funding (APR):    ${fmt(s.avgAnnualizedPct)}%`);
  console.log(`  stdev (APR):          ${fmt(s.stdAnnualizedPct)}%`);
  console.log(`  median (APR):         ${fmt(s.medianAnnualizedPct)}%`);
  console.log(
    `  p05 / p95 (APR):      ${fmt(s.p05AnnualizedPct)}% / ${fmt(s.p95AnnualizedPct)}%`,
  );
  console.log(`  % hours positive:     ${s.pctHoursPositive.toFixed(1)}%`);
  console.log(
    `  long pays / unhedged: ${fmt(s.realizedLongAprPct)}% APR realized`,
  );
  console.log(
    `  Drift period revenue: $${fmt(s.totalPeriodRevenueUsd)} (protocol-side, this market)`,
  );
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Fundex backtest-funding`);
  console.log(`  markets:  ${MARKETS.join(", ")}`);
  console.log(`  months:   ${MONTHS_BACK}`);
  console.log(`  output:   ${OUT_DIR}`);

  const summaries: Summary[] = [];
  for (const market of MARKETS) {
    const recs = await fetchMarket(market);
    if (recs.length === 0) {
      console.warn(`  ! ${market}: no records`);
      continue;
    }
    const csvPath = writeCsv(market, recs);
    console.log(`  ✓ saved ${recs.length} records → ${path.relative(process.cwd(), csvPath)}`);
    const s = computeSummary(market, recs);
    summaries.push(s);
    printSummary(s);
  }

  const summaryPath = path.join(OUT_DIR, "summary.json");
  fs.writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        monthsBack: MONTHS_BACK,
        markets: summaries,
      },
      null,
      2,
    ),
  );
  console.log(`\n✓ summary → ${path.relative(process.cwd(), summaryPath)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
