/// <reference types="node" />
/**
 * backtest-swaps.ts
 *
 * Replay the CSV data from backtest-funding.ts through a simulated
 * 30-day fixed-for-floating swap market. Produces the core numbers for
 * the Fundex pitch:
 *
 *   Hedger (Fixed Payer) perspective
 *     - Unhedged vs hedged realized cost (mean + stdev)
 *     - Variance reduction %
 *
 *   LP (Fixed Receiver) perspective
 *     - Realized APR under multiple fixed-rate policies
 *     - Sharpe, max drawdown, win rate, correlation to mark price
 *
 * Usage:
 *   yarn backtest:swaps
 *   WINDOW_DAYS=14 PREMIUM_BPS=150 yarn backtest:swaps
 */

import * as fs from "fs";
import * as path from "path";

interface Row {
  ts: number;
  fundingRate: number;
  oraclePrice: number;
  markPrice: number;
}

interface WindowResult {
  startTs: number;
  endTs: number;
  hours: number;
  fixedRateAprPct: number; // quoted at entry
  realizedFloatAprPct: number; // realized annualized
  hedgerPnlPctOfNotional: number; // (realizedFloat - fixed) × duration
  lpPnlPctOfNotional: number; // (fixed - realizedFloat) × duration
  markPriceReturnPct: number; // price change over window
}

interface PolicyStats {
  policy: string;
  windows: number;
  realizedAprPct: number;
  stdevAnnualizedPct: number;
  sharpe: number;
  maxDrawdownPct: number;
  winRatePct: number;
  correlationToPrice: number;
}

interface HedgerStats {
  /** Long-side realized funding cost averaged across all windows (APR %) */
  meanCostAprPct: number;
  /** Hourly funding cost volatility annualized (intra-window, realized) */
  hourlyVolAnnualizedPct: number;
  /** Worst single 30-day window's realized APR */
  worstMonthCostAprPct: number;
  /** Best single 30-day window's realized APR */
  bestMonthCostAprPct: number;
  /** Worst-case 30-day "surprise" vs. trailing-mean fair fixed quote (APR %) */
  worstSurpriseAprPct: number;
  /** Avg absolute 30-day surprise vs. trailing-mean fair fixed quote (APR %) */
  avgAbsSurpriseAprPct: number;
  /** $10k notional: worst-month dollar surprise that a hedge would have eliminated */
  worstMonthDollarSurpriseOn10k: number;
  /** $10k notional: avg monthly dollar surprise a hedge would have eliminated */
  avgMonthDollarSurpriseOn10k: number;
}

const WINDOW_DAYS = Number(process.env.WINDOW_DAYS ?? 30);
const WINDOW_HOURS = WINDOW_DAYS * 24;
const TRAILING_DAYS = Number(process.env.TRAILING_DAYS ?? 30);
const TRAILING_HOURS = TRAILING_DAYS * 24;
const PREMIUM_BPS = Number(process.env.PREMIUM_BPS ?? 200); // 2.00% default
const DATA_DIR = path.join(__dirname, "..", "data", "funding");
const MARKETS = (process.env.MARKETS ?? "SOL-PERP,BTC-PERP").split(",");

function loadCsv(symbol: string): Row[] {
  const csv = fs.readFileSync(path.join(DATA_DIR, `${symbol}.csv`), "utf8");
  const [header, ...lines] = csv.trim().split("\n");
  const cols = header.split(",");
  const idx = (name: string) => cols.indexOf(name);
  const iTs = idx("ts");
  const iRate = idx("fundingRate");
  const iOracle = idx("oraclePriceTwap");
  const iMark = idx("markPriceTwap");
  return lines
    .map((l) => {
      const p = l.split(",");
      return {
        ts: Number(p[iTs]),
        fundingRate: Number(p[iRate]),
        oraclePrice: Number(p[iOracle]),
        markPrice: Number(p[iMark]),
      };
    })
    .filter((r) => r.oraclePrice > 0);
}

/** Annualized funding APR (%) for a single hourly record */
function hourlyAsAnnualPct(r: Row): number {
  return (r.fundingRate / r.oraclePrice) * 8760 * 100;
}

/** Realized mean APR over a slice [start, end) */
function realizedAprPct(rows: Row[], start: number, end: number): number {
  if (end <= start) return 0;
  let sum = 0;
  let n = 0;
  for (let i = start; i < end; i++) {
    sum += hourlyAsAnnualPct(rows[i]);
    n++;
  }
  return n ? sum / n : 0;
}

/** Policy: trailing N-day mean as fair fixed rate */
function policyTrailingMean(
  rows: Row[],
  entryIdx: number,
  premiumBps: number,
): number {
  const start = Math.max(0, entryIdx - TRAILING_HOURS);
  return realizedAprPct(rows, start, entryIdx) + premiumBps / 100;
}

/** Simulate one 30-day window starting at entryIdx with a given fixed rate */
function simulateWindow(
  rows: Row[],
  entryIdx: number,
  fixedRateAprPct: number,
): WindowResult {
  const end = Math.min(rows.length, entryIdx + WINDOW_HOURS);
  const hours = end - entryIdx;
  if (hours < WINDOW_HOURS) {
    return {
      startTs: rows[entryIdx].ts,
      endTs: rows[end - 1]?.ts ?? rows[entryIdx].ts,
      hours,
      fixedRateAprPct,
      realizedFloatAprPct: 0,
      hedgerPnlPctOfNotional: 0,
      lpPnlPctOfNotional: 0,
      markPriceReturnPct: 0,
    };
  }
  const realized = realizedAprPct(rows, entryIdx, end);
  const durationFraction = hours / 8760;
  // Fixed receiver (LP) gains (fixed - realized) over the window
  // Fixed payer (hedger) gains (realized - fixed) over the window
  // These are net funding flows after netting the direct perp position
  const lpPnl = (fixedRateAprPct - realized) * durationFraction;
  const hedgerPnl = (realized - fixedRateAprPct) * durationFraction;
  const markStart = rows[entryIdx].markPrice;
  const markEnd = rows[end - 1].markPrice;
  const markReturn = markStart > 0 ? ((markEnd - markStart) / markStart) * 100 : 0;
  return {
    startTs: rows[entryIdx].ts,
    endTs: rows[end - 1].ts,
    hours,
    fixedRateAprPct,
    realizedFloatAprPct: realized,
    hedgerPnlPctOfNotional: hedgerPnl,
    lpPnlPctOfNotional: lpPnl,
    markPriceReturnPct: markReturn,
  };
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

function correlation(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 2) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return dx === 0 || dy === 0 ? 0 : num / Math.sqrt(dx * dy);
}

function maxDrawdown(returns: number[]): number {
  // Equity curve starting at 1
  let equity = 1;
  let peak = 1;
  let maxDD = 0;
  for (const r of returns) {
    equity *= 1 + r / 100; // returns are in pct
    if (equity > peak) peak = equity;
    const dd = ((equity - peak) / peak) * 100;
    if (dd < maxDD) maxDD = dd;
  }
  return maxDD;
}

function computePolicyStats(
  name: string,
  windows: WindowResult[],
  lpSide: boolean,
): PolicyStats {
  const pnlSeries = windows.map((w) =>
    lpSide ? w.lpPnlPctOfNotional : w.hedgerPnlPctOfNotional,
  );
  const priceSeries = windows.map((w) => w.markPriceReturnPct);
  const windowsPerYear = 8760 / WINDOW_HOURS;
  const meanR = mean(pnlSeries);
  const stdR = stdev(pnlSeries);
  const realizedApr = meanR * windowsPerYear;
  const stdevAnnual = stdR * Math.sqrt(windowsPerYear);
  const sharpe = stdR > 0 ? (meanR / stdR) * Math.sqrt(windowsPerYear) : 0;
  const maxDD = maxDrawdown(pnlSeries);
  const winRate =
    (pnlSeries.filter((r) => r > 0).length / pnlSeries.length) * 100;
  const corr = correlation(pnlSeries, priceSeries);
  return {
    policy: name,
    windows: pnlSeries.length,
    realizedAprPct: realizedApr,
    stdevAnnualizedPct: stdevAnnual,
    sharpe,
    maxDrawdownPct: maxDD,
    winRatePct: winRate,
    correlationToPrice: corr,
  };
}

function runNonOverlapping(
  rows: Row[],
  premiumBps: number,
): WindowResult[] {
  // Start after initial trailing-window buffer so we always have a trailing mean
  const windows: WindowResult[] = [];
  let i = TRAILING_HOURS;
  while (i + WINDOW_HOURS <= rows.length) {
    const fixedRate = policyTrailingMean(rows, i, premiumBps);
    windows.push(simulateWindow(rows, i, fixedRate));
    i += WINDOW_HOURS;
  }
  return windows;
}

function computeHedgerStats(
  rows: Row[],
  windows: WindowResult[],
): HedgerStats {
  const realizedPerWindow = windows.map((w) => w.realizedFloatAprPct);
  const fixedPerWindow = windows.map((w) => w.fixedRateAprPct);
  const surprises = windows.map(
    (w) => w.realizedFloatAprPct - w.fixedRateAprPct,
  );
  const absSurprises = surprises.map(Math.abs);
  const meanCost = mean(realizedPerWindow);

  // Intra-window hourly volatility → annualized, averaged across all hours
  const hourlySeries: number[] = [];
  for (const r of rows) hourlySeries.push(hourlyAsAnnualPct(r));
  const hourlyVol = stdev(hourlySeries); // already annualized via hourlyAsAnnualPct

  const worstMonth = Math.max(...realizedPerWindow);
  const bestMonth = Math.min(...realizedPerWindow);
  const worstSurprise = Math.max(...absSurprises);
  const avgAbsSurprise = mean(absSurprises);

  // Dollarize on $10k notional held over 30 days
  // APR pct × (30/365) × 10000 / 100
  const dollar = (aprPct: number) => (aprPct * (30 / 365) * 10000) / 100;
  return {
    meanCostAprPct: meanCost,
    hourlyVolAnnualizedPct: hourlyVol,
    worstMonthCostAprPct: worstMonth,
    bestMonthCostAprPct: bestMonth,
    worstSurpriseAprPct: worstSurprise,
    avgAbsSurpriseAprPct: avgAbsSurprise,
    worstMonthDollarSurpriseOn10k: dollar(worstSurprise),
    avgMonthDollarSurpriseOn10k: dollar(avgAbsSurprise),
  };
}

function fmtPct(n: number, digits = 2): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function printMarket(symbol: string, rows: Row[]) {
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  ${symbol} — ${WINDOW_DAYS}-day swap backtest`);
  console.log(`═══════════════════════════════════════════`);
  console.log(`  data records:   ${rows.length}`);
  console.log(
    `  data period:    ${((rows[rows.length - 1].ts - rows[0].ts) / 86400).toFixed(1)} days`,
  );

  // Fair policy (no premium) — used to compute hedger variance reduction
  const fair = runNonOverlapping(rows, 0);
  if (fair.length === 0) {
    console.log("  ! not enough data for a full window");
    return;
  }
  const hedger = computeHedgerStats(rows, fair);
  const lpFair = computePolicyStats("fair (no premium)", fair, true);

  // LP-favorable policy (with risk premium)
  const priced = runNonOverlapping(rows, PREMIUM_BPS);
  const lpPriced = computePolicyStats(
    `trailing mean + ${PREMIUM_BPS}bps premium`,
    priced,
    true,
  );

  console.log(`  windows:        ${fair.length} non-overlapping`);
  console.log("");
  console.log(`  ┌─ HEDGER (long on Drift, wants to cap funding cost) ─┐`);
  console.log(
    `  │ Mean realized cost (APR):     ${fmtPct(hedger.meanCostAprPct).padStart(8)}       │`,
  );
  console.log(
    `  │ Hourly vol (annualized):      ${fmtPct(hedger.hourlyVolAnnualizedPct).padStart(8)}       │`,
  );
  console.log(
    `  │ Worst / best month (APR):     ${fmtPct(hedger.worstMonthCostAprPct).padStart(7)} / ${fmtPct(hedger.bestMonthCostAprPct)}  │`,
  );
  console.log(
    `  │ Worst 30D surprise vs quote:  ${fmtPct(hedger.worstSurpriseAprPct).padStart(8)}       │`,
  );
  console.log(
    `  │ Avg  30D surprise vs quote:   ${fmtPct(hedger.avgAbsSurpriseAprPct).padStart(8)}       │`,
  );
  console.log(`  │                                                      │`);
  console.log(`  │ Impact on $10,000 long (per 30 days):                │`);
  console.log(
    `  │   Worst-month surprise eliminated by hedge: $${hedger.worstMonthDollarSurpriseOn10k.toFixed(2).padStart(7)}   │`,
  );
  console.log(
    `  │   Avg-month  surprise eliminated by hedge:  $${hedger.avgMonthDollarSurpriseOn10k.toFixed(2).padStart(7)}   │`,
  );
  console.log(`  └──────────────────────────────────────────────────────┘`);
  console.log("");
  console.log(`  ┌─ LP FIXED RECEIVER — rolling 30D ─┐`);
  console.log(`  │ Policy: fair (trailing mean)       │`);
  console.log(
    `  │   Realized APR:   ${fmtPct(lpFair.realizedAprPct).padStart(8)}         │`,
  );
  console.log(
    `  │   Stdev (annual): ${fmtPct(lpFair.stdevAnnualizedPct).padStart(8)}         │`,
  );
  console.log(
    `  │   Sharpe:         ${lpFair.sharpe.toFixed(2).padStart(8)}         │`,
  );
  console.log(
    `  │   Max DD:         ${fmtPct(lpFair.maxDrawdownPct).padStart(8)}         │`,
  );
  console.log(
    `  │   Win rate:       ${lpFair.winRatePct.toFixed(0).padStart(7)}%         │`,
  );
  console.log(
    `  │   Corr(price):    ${lpFair.correlationToPrice.toFixed(2).padStart(8)}         │`,
  );
  console.log(`  │                                    │`);
  console.log(`  │ Policy: + ${PREMIUM_BPS}bps premium           │`);
  console.log(
    `  │   Realized APR:   ${fmtPct(lpPriced.realizedAprPct).padStart(8)}         │`,
  );
  console.log(
    `  │   Stdev (annual): ${fmtPct(lpPriced.stdevAnnualizedPct).padStart(8)}         │`,
  );
  console.log(
    `  │   Sharpe:         ${lpPriced.sharpe.toFixed(2).padStart(8)}         │`,
  );
  console.log(
    `  │   Max DD:         ${fmtPct(lpPriced.maxDrawdownPct).padStart(8)}         │`,
  );
  console.log(
    `  │   Win rate:       ${lpPriced.winRatePct.toFixed(0).padStart(7)}%         │`,
  );
  console.log(
    `  │   Corr(price):    ${lpPriced.correlationToPrice.toFixed(2).padStart(8)}         │`,
  );
  console.log(`  └────────────────────────────────────┘`);

  return { symbol, hedger, lpFair, lpPriced, windows: fair };
}

function main() {
  console.log(`Fundex backtest-swaps`);
  console.log(`  window:     ${WINDOW_DAYS} days`);
  console.log(`  trailing:   ${TRAILING_DAYS} days`);
  console.log(`  premium:    ${PREMIUM_BPS}bps`);

  const results: Array<{
    symbol: string;
    hedger: HedgerStats;
    lpFair: PolicyStats;
    lpPriced: PolicyStats;
  }> = [];

  for (const symbol of MARKETS) {
    const rows = loadCsv(symbol);
    if (rows.length === 0) {
      console.warn(`  ! ${symbol}: no data, run \`yarn backtest:funding\` first`);
      continue;
    }
    const r = printMarket(symbol, rows);
    if (r) {
      results.push({
        symbol: r.symbol,
        hedger: r.hedger,
        lpFair: r.lpFair,
        lpPriced: r.lpPriced,
      });
    }
  }

  const outPath = path.join(DATA_DIR, "swap-backtest.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        windowDays: WINDOW_DAYS,
        trailingDays: TRAILING_DAYS,
        premiumBps: PREMIUM_BPS,
        results,
      },
      null,
      2,
    ),
  );
  console.log(`\n✓ results → ${path.relative(process.cwd(), outPath)}`);
}

main();
