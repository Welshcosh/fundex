"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import dynamic from "next/dynamic";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false }
);
import { TrendingUp, TrendingDown, Wallet, BarChart2 } from "lucide-react";
import { DURATION_LABELS, NOTIONAL_PER_LOT } from "@/lib/constants";
import { formatUSD, formatAddress } from "@/lib/utils";
import { usePositions } from "@/hooks/usePositions";

export default function PortfolioPage() {
  const { connected, publicKey } = useWallet();
  const { positions, loading } = usePositions();

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
        <div className="mb-10">
          <h1 className="text-3xl font-bold mb-2" style={{ color: "#ede9fe" }}>Portfolio</h1>
          {publicKey && (
            <div className="text-xs font-mono" style={{ color: "#4a4568" }}>
              {formatAddress(publicKey.toString())}
            </div>
          )}
        </div>

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
