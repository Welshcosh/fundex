// Internal rate unit: 1e6 = 100% per hour (matches on-chain FUNDING_INTERVAL = 3_600s).
// 10_000 units = 1% per hour.

export function formatRate(rate: number): string {
  const pct = rate / 10_000;
  if (Math.abs(pct) < 0.00005) return "~0%";
  const sign = pct >= 0 ? "+" : "−";
  return sign + Math.abs(pct).toFixed(4) + "%";
}

export function formatRateAnnualized(rate: number): string {
  const annualizedPct = rateToAprPct(rate);
  if (Math.abs(annualizedPct) < 0.005) return "~0%";
  const sign = annualizedPct >= 0 ? "+" : "−";
  return sign + Math.abs(annualizedPct).toFixed(2) + "%";
}

/** Convert internal rate (1e6/1h units) to annualized percent as a number. */
export function rateToAprPct(rate: number): number {
  // 1h funding interval × 24/day × 365 days = 8760 settlements per year.
  // 10_000 rate units = 1% per hour → × 8760 = % APR (simple annualization).
  return (rate / 10_000) * 8760;
}

export function formatRelativeTime(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 0) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString();
}

export function truncateError(msg: string, max = 120): string {
  if (msg.length <= max) return msg;
  const slice = msg.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
  return cut + "…";
}

export function formatUSDC(lamports: number): string {
  return (lamports / 1_000_000).toFixed(2);
}

export function formatUSD(val: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
}

export function formatAddress(addr: string): string {
  return addr.slice(0, 4) + "..." + addr.slice(-4);
}

export function formatPnl(pnl: number): string {
  const sign = pnl >= 0 ? "+" : "";
  return sign + formatUSD(pnl);
}

export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}
