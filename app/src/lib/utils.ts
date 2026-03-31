export function formatRate(rateBps: number): string {
  return (rateBps / 10000).toFixed(4) + "%";
}

export function formatRateAnnualized(rateBps: number): string {
  const annualized = (rateBps / 10000) * 365 * 24;
  return annualized.toFixed(2) + "%";
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
