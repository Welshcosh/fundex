"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import dynamic from "next/dynamic";
import { useEffect, useState, useMemo } from "react";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false }
);
import { TrendingUp, TrendingDown, Wallet, BarChart2 } from "lucide-react";
import { DURATION_LABELS, NOTIONAL_PER_LOT, MARKETS } from "@/lib/constants";
import { formatUSD, formatAddress, rateToAprPct } from "@/lib/utils";
import { usePositions, type OnchainPosition } from "@/hooks/usePositions";
import { useFundexClient } from "@/hooks/useFundexClient";
import type { PortfolioSummaryInput, PortfolioSummaryOutput } from "@/app/api/ai/portfolio-summary/route";

function useOracleRates() {
  const client = useFundexClient();
  const [rates, setRates] = useState<Record<number, number>>({});
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    (async () => {
      const perps = MARKETS.map((m) => m.perpIndex);
      try {
        const res = await client.fetchOraclesMulti(perps);
        if (cancelled) return;
        const out: Record<number, number> = {};
        for (const p of perps) {
          const r = res[p];
          if (r) out[p] = r.emaFundingRate;
        }
        setRates(out);
      } catch {
        // ignore — summary can still render with 0 rates
      }
    })();
    return () => { cancelled = true; };
  }, [client]);
  return rates;
}

function AIPortfolioSummary({ positions, oracleRates }: { positions: OnchainPosition[]; oracleRates: Record<number, number> }) {
  const [summary, setSummary] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  // Bucket positions into stable cache key so we don't refire on every render.
  const payload = useMemo<PortfolioSummaryInput>(() => ({
    positions: positions.map((p) => {
      const market = MARKETS.find((m) => m.perpIndex === p.perpIndex);
      const variable = oracleRates[p.perpIndex] ?? 0;
      return {
        market: `${market?.symbol ?? "?"} ${DURATION_LABELS[p.duration]}`,
        side: p.side === 0 ? "payer" : "receiver",
        notionalUsd: p.lots * NOTIONAL_PER_LOT,
        collateralUsd: p.collateralDeposited / 1_000_000,
        unrealizedPnlUsd: p.unrealizedPnl / 1_000_000,
        marginRatioBps: p.marginRatioBps,
        daysToExpiry: Math.max(0, (p.expiryTs - Math.floor(Date.now() / 1000)) / 86400),
        variableRateApr: rateToAprPct(variable),
        fixedRateApr: rateToAprPct(p.fixedRate),
        settlementsToLiq: p.settlementsToLiq,
      };
    }),
  }), [positions, oracleRates]);

  const bucketKey = useMemo(() =>
    payload.positions.map((p) =>
      `${p.market}|${p.side}|${Math.round(p.notionalUsd / 100)}|${Math.round(p.marginRatioBps / 100)}|${Math.round(p.daysToExpiry)}|${Math.round(p.variableRateApr)}|${Math.round(p.fixedRateApr)}|${p.settlementsToLiq ?? -1}`,
    ).sort().join("#"),
  [payload.positions]);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    (async () => {
      try {
        const r = await fetch("/api/ai/portfolio-summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as PortfolioSummaryOutput;
        if (!cancelled) {
          setSummary(data.summary);
          setState("done");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [bucketKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="mb-6 rounded-2xl px-5 py-4 flex items-start gap-3"
      style={{
        background: "linear-gradient(135deg, rgba(153,69,255,0.10), rgba(67,180,202,0.05))",
        border: "1px solid rgba(153,69,255,0.22)",
      }}
    >
      <div
        className="flex-shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[9px] font-bold uppercase tracking-widest"
        style={{
          background: "rgba(153,69,255,0.18)",
          color: "#c4b5fd",
          border: "1px solid rgba(153,69,255,0.3)",
          alignSelf: "flex-start",
        }}
      >
        <span aria-label="LLM">💬</span> AI Summary
      </div>
      <div className="flex-1 min-w-0">
        {state === "loading" && (
          <div className="flex items-center gap-1.5 py-0.5">
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#9945ff" }} />
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#9945ff", animationDelay: "0.15s" }} />
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#9945ff", animationDelay: "0.30s" }} />
            <span className="text-[12px] ml-1.5" style={{ color: "#6b6890" }}>Reading your portfolio…</span>
          </div>
        )}
        {state === "error" && (
          <span className="text-[12px] font-mono" style={{ color: "#6b6890" }}>Summary unavailable</span>
        )}
        {state === "done" && summary && (
          <p className="text-[13px] leading-relaxed" style={{ color: "#e2e8f0" }}>
            {summary}
          </p>
        )}
      </div>
    </div>
  );
}

export default function PortfolioPage() {
  const { connected, publicKey } = useWallet();
  const { positions, loading } = usePositions();
  const oracleRates = useOracleRates();

  if (!connected) {
    return (
      <div style={{ minHeight: "calc(100vh - 56px)", background: "#08090e" }}
        className="flex flex-col items-center justify-center gap-6">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{
            background: "rgba(153,69,255,0.1)",
            border: "1px solid rgba(153,69,255,0.2)",
          }}>
          <Wallet size={28} style={{ color: "#c4b5fd" }} />
        </div>
        <div className="text-center">
          <div className="text-lg font-bold mb-2" style={{ color: "#ede9fe" }}>Connect Your Wallet</div>
          <div className="text-sm" style={{ color: "#6b6890" }}>Connect to view your positions and portfolio</div>
        </div>
        <WalletMultiButton />
      </div>
    );
  }

  const totalPnl = positions.reduce((s, p) => s + p.unrealizedPnl / 1_000_000, 0);
  const totalCollateral = positions.reduce((s, p) => s + p.collateralDeposited / 1_000_000, 0);
  const totalNotional = positions.reduce((s, p) => s + p.lots * NOTIONAL_PER_LOT, 0);

  const SUMMARY = [
    {
      label: "Unrealized PnL",
      value: (totalPnl >= 0 ? "+" : "") + formatUSD(totalPnl),
      sub: "All open positions",
      color: totalPnl >= 0 ? "#2dd4bf" : "#f87171",
      icon: totalPnl >= 0 ? TrendingUp : TrendingDown,
    },
    {
      label: "Total Collateral",
      value: formatUSD(totalCollateral),
      sub: "USDC deposited",
      color: "#c4b5fd",
      icon: BarChart2,
    },
    {
      label: "Total Notional",
      value: formatUSD(totalNotional),
      sub: "Active exposure",
      color: "#8b87a8",
      icon: BarChart2,
    },
    {
      label: "Open Positions",
      value: String(positions.length),
      sub: "Across all markets",
      color: "#8b87a8",
      icon: BarChart2,
    },
  ];

  return (
    <div style={{ minHeight: "calc(100vh - 56px)", background: "#08090e" }}>
      <div className="max-w-6xl mx-auto px-8 py-12">

        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2" style={{ color: "#ede9fe" }}>Portfolio</h1>
          {publicKey && (
            <div className="text-xs font-mono" style={{ color: "#4a4568" }}>
              {formatAddress(publicKey.toString())}
            </div>
          )}
        </div>

        {/* AI one-line summary (mentor feedback: surface AI on portfolio) */}
        {!loading && positions.length > 0 && (
          <AIPortfolioSummary positions={positions} oracleRates={oracleRates} />
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          {SUMMARY.map((s) => (
            <div key={s.label} className="p-5 rounded-2xl"
              style={{ background: "#0d0c1a", border: "1px solid rgba(255,255,255,0.05)" }}>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs" style={{ color: "#4a4568" }}>{s.label}</span>
                <s.icon size={13} style={{ color: s.color }} />
              </div>
              <div className="text-2xl font-bold font-mono mb-1.5" style={{ color: s.color }}>{s.value}</div>
              <div className="text-xs" style={{ color: "#4a4568" }}>{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Positions table */}
        <div className="rounded-2xl overflow-hidden"
          style={{ background: "#0d0c1a", border: "1px solid rgba(255,255,255,0.05)" }}>

          {/* Table header bar */}
          <div className="px-6 py-4 flex items-center justify-between"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            <span className="font-semibold text-sm" style={{ color: "#ede9fe" }}>Open Positions</span>
            <span className="text-xs px-2.5 py-1 rounded-lg font-medium"
              style={{
                background: "rgba(153,69,255,0.1)",
                color: "#c4b5fd",
                border: "1px solid rgba(153,69,255,0.2)",
              }}>
              {positions.length} active
            </span>
          </div>

          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                {["Market", "Side", "Size", "Collateral", "Unrealized PnL", "Margin"].map((h) => (
                  <th key={h} className="px-6 py-3 text-left text-xs font-medium" style={{ color: "#4a4568" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-sm" style={{ color: "#4a4568" }}>
                    Loading positions…
                  </td>
                </tr>
              )}
              {!loading && positions.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-sm" style={{ color: "#4a4568" }}>
                    No open positions
                  </td>
                </tr>
              )}
              {!loading && positions.map((pos, i) => {
                const pnlUsd = pos.unrealizedPnl / 1_000_000;
                const collateralUsd = pos.collateralDeposited / 1_000_000;
                const notionalUsd = pos.lots * NOTIONAL_PER_LOT;
                const sideLabel = pos.side === 0 ? "Fixed Payer" : "Fixed Receiver";
                return (
                  <tr key={i} className="transition-colors"
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.015)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <td className="px-6 py-4">
                      <div className="font-semibold text-sm" style={{ color: "#ede9fe" }}>{pos.marketName}</div>
                      <div className="text-xs mt-0.5" style={{ color: "#4a4568" }}>{DURATION_LABELS[pos.duration]}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-2.5 py-1 rounded-full text-xs font-semibold"
                        style={{
                          background: pos.side === 0 ? "rgba(45,212,191,0.1)" : "rgba(153,69,255,0.1)",
                          color: pos.side === 0 ? "#2dd4bf" : "#c4b5fd",
                        }}>
                        {sideLabel}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono text-xs" style={{ color: "#8b87a8" }}>
                      {pos.lots} lots · {formatUSD(notionalUsd)}
                    </td>
                    <td className="px-6 py-4 font-mono text-xs" style={{ color: "#8b87a8" }}>
                      {formatUSD(collateralUsd)}
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-mono font-semibold text-sm"
                        style={{ color: pnlUsd >= 0 ? "#2dd4bf" : "#f87171" }}>
                        {pnlUsd >= 0 ? "+" : ""}{formatUSD(pnlUsd)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1 rounded-full overflow-hidden"
                          style={{ background: "rgba(255,255,255,0.06)" }}>
                          <div className="h-full rounded-full"
                            style={{
                              width: `${Math.min(100, (pos.marginRatioBps / 2000) * 100)}%`,
                              background: pos.marginRatioBps > 1000 ? "#2dd4bf" : pos.marginRatioBps > 500 ? "#fbbf24" : "#f87171",
                            }} />
                        </div>
                        <span className="text-xs font-mono" style={{ color: "#4a4568" }}>
                          {(pos.marginRatioBps / 100).toFixed(1)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>

      </div>
    </div>
  );
}
