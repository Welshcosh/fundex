"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { MARKETS, DurationVariant, DURATION_LABELS } from "@/lib/constants";
import { useFundexClient } from "@/hooks/useFundexClient";
import { useUsdcBalance } from "@/hooks/useUsdcBalance";
import { USDC_MINT } from "@/lib/fundex/constants";
import type { PoolInfo, LpPositionInfo } from "@/lib/fundex/client";

// ─── Pool row data ─────────────────────────────────────────────────────────────

interface PoolRowData {
  perpIndex: number;
  duration: DurationVariant;
  name: string;
  symbol: string;
  pool: PoolInfo | null;
  lp: LpPositionInfo | null;
}

// ─── Deposit/Withdraw modal ───────────────────────────────────────────────────

function LpModal({
  row,
  onClose,
  onSuccess,
}: {
  row: PoolRowData;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const client = useFundexClient();
  const { publicKey } = useWallet();
  const { lamports: usdcBalance, refresh: refreshBalance } = useUsdcBalance();
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [shares, setShares] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const maxDeposit = usdcBalance / 1_000_000;
  const maxWithdrawShares = row.lp?.shares ?? 0;

  async function handleDeposit() {
    if (!client || !publicKey) return;
    const amt = Math.round(parseFloat(amount) * 1_000_000);
    if (!amt || amt <= 0) { setErr("Invalid amount"); return; }
    setLoading(true); setErr("");
    try {
      const ata = getAssociatedTokenAddressSync(USDC_MINT, publicKey);
      await client.depositLp(row.perpIndex, row.duration, amt, ata);
      refreshBalance();
      onSuccess();
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleWithdraw() {
    if (!client || !publicKey) return;
    const s = parseInt(shares);
    if (!s || s <= 0) { setErr("Invalid shares"); return; }
    if (s > maxWithdrawShares) { setErr("Insufficient shares"); return; }
    setLoading(true); setErr("");
    try {
      const ata = getAssociatedTokenAddressSync(USDC_MINT, publicKey);
      await client.withdrawLp(row.perpIndex, row.duration, s, ata);
      refreshBalance();
      onSuccess();
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // Share → USDC estimate
  const shareValue = row.pool && row.pool.totalShares > 0 && shares
    ? Math.floor((parseInt(shares) * row.pool.vaultBalance) / row.pool.totalShares) / 1_000_000
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-sm rounded-2xl p-5"
        style={{ background: "#13122a", border: "1px solid rgba(255,255,255,0.08)" }}>

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="font-bold text-sm" style={{ color: "#ede9fe" }}>
              {row.name} · {DURATION_LABELS[row.duration]}
            </div>
            <div className="text-xs mt-0.5" style={{ color: "#6b6890" }}>Liquidity Pool</div>
          </div>
          <button onClick={onClose} className="text-xs px-2 py-1 rounded-lg"
            style={{ color: "#6b6890", background: "rgba(255,255,255,0.04)" }}>✕</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 p-0.5 rounded-xl" style={{ background: "rgba(255,255,255,0.03)" }}>
          {(["deposit", "withdraw"] as const).map((t) => (
            <button key={t} onClick={() => { setTab(t); setErr(""); }}
              className="flex-1 py-1.5 text-xs font-semibold rounded-lg capitalize transition-all"
              style={{
                background: tab === t ? "rgba(153,69,255,0.2)" : "transparent",
                color: tab === t ? "#c4b5fd" : "#4a4568",
              }}>
              {t}
            </button>
          ))}
        </div>

        {tab === "deposit" ? (
          <>
            <label className="text-xs mb-1 block" style={{ color: "#6b6890" }}>Amount (USDC)</label>
            <div className="relative mb-1">
              <input
                type="number" min="0" step="1" placeholder="0.00"
                value={amount} onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-xl px-4 py-3 text-sm font-mono outline-none"
                style={{ background: "rgba(255,255,255,0.04)", color: "#ede9fe", border: "1px solid rgba(255,255,255,0.06)" }}
              />
              <button onClick={() => setAmount(maxDeposit.toFixed(2))}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs px-2 py-0.5 rounded-md"
                style={{ color: "#9945ff", background: "rgba(153,69,255,0.1)" }}>MAX</button>
            </div>
            <div className="text-xs mb-4" style={{ color: "#4a4568" }}>Balance: {maxDeposit.toFixed(2)} USDC</div>
            {err && <div className="text-xs mb-3 px-3 py-2 rounded-lg" style={{ background: "rgba(248,113,113,0.1)", color: "#f87171" }}>{err}</div>}
            <button onClick={handleDeposit} disabled={loading || !amount}
              className="w-full py-3 rounded-xl text-sm font-semibold transition-all"
              style={{
                background: "linear-gradient(135deg,#9945ff,#7b61ff)",
                color: "#fff",
                opacity: loading || !amount ? 0.5 : 1,
              }}>
              {loading ? "Confirming…" : "Deposit"}
            </button>
          </>
        ) : (
          <>
            <label className="text-xs mb-1 block" style={{ color: "#6b6890" }}>Shares to Withdraw</label>
            <div className="relative mb-1">
              <input
                type="number" min="0" step="1" placeholder="0"
                value={shares} onChange={(e) => setShares(e.target.value)}
                className="w-full rounded-xl px-4 py-3 text-sm font-mono outline-none"
                style={{ background: "rgba(255,255,255,0.04)", color: "#ede9fe", border: "1px solid rgba(255,255,255,0.06)" }}
              />
              <button onClick={() => setShares(String(maxWithdrawShares))}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs px-2 py-0.5 rounded-md"
                style={{ color: "#9945ff", background: "rgba(153,69,255,0.1)" }}>MAX</button>
            </div>
            <div className="text-xs mb-1" style={{ color: "#4a4568" }}>
              Your shares: {maxWithdrawShares.toLocaleString()}
            </div>
            {shareValue > 0 && (
              <div className="text-xs mb-3" style={{ color: "#2dd4bf" }}>
                ≈ {shareValue.toFixed(2)} USDC
              </div>
            )}
            {err && <div className="text-xs mb-3 px-3 py-2 rounded-lg" style={{ background: "rgba(248,113,113,0.1)", color: "#f87171" }}>{err}</div>}
            <button onClick={handleWithdraw} disabled={loading || !shares || maxWithdrawShares === 0}
              className="w-full py-3 rounded-xl text-sm font-semibold transition-all"
              style={{
                background: "rgba(45,212,191,0.15)",
                border: "1px solid rgba(45,212,191,0.25)",
                color: "#2dd4bf",
                opacity: loading || !shares || maxWithdrawShares === 0 ? 0.5 : 1,
              }}>
              {loading ? "Confirming…" : "Withdraw"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Pool card ─────────────────────────────────────────────────────────────────

function PoolCard({
  row,
  onAction,
}: {
  row: PoolRowData;
  onAction: (row: PoolRowData) => void;
}) {
  const { publicKey } = useWallet();
  const tvl = row.pool ? row.pool.vaultBalance / 1_000_000 : 0;
  const myValue = row.lp ? row.lp.usdcValue / 1_000_000 : 0;
  const netLots = row.pool ? row.pool.lastNetLots : 0;
  const imbalance = Math.abs(netLots);

  return (
    <div className="rounded-2xl p-4"
      style={{ background: "#0d0c1a", border: "1px solid rgba(255,255,255,0.06)" }}>
      {/* Top row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0"
            style={{ background: "linear-gradient(135deg,rgba(153,69,255,0.2),rgba(67,180,202,0.2))", color: "#c4b5fd", border: "1px solid rgba(153,69,255,0.2)" }}>
            {row.symbol[0]}
          </div>
          <div>
            <div className="text-sm font-bold" style={{ color: "#ede9fe" }}>{row.name}</div>
            <div className="text-xs" style={{ color: "#6b6890" }}>{DURATION_LABELS[row.duration]} pool</div>
          </div>
        </div>
        {row.pool === null && (
          <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.04)", color: "#4a4568" }}>
            Not initialized
          </span>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="rounded-xl p-2.5 text-center" style={{ background: "rgba(255,255,255,0.03)" }}>
          <div className="text-xs font-mono font-semibold" style={{ color: "#c4b5fd" }}>
            ${tvl.toFixed(0)}
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: "#4a4568" }}>TVL</div>
        </div>
        <div className="rounded-xl p-2.5 text-center" style={{ background: "rgba(255,255,255,0.03)" }}>
          <div className="text-xs font-mono font-semibold" style={{ color: imbalance === 0 ? "#2dd4bf" : "#fbbf24" }}>
            {imbalance === 0 ? "Balanced" : `${imbalance} lots`}
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: "#4a4568" }}>Imbalance</div>
        </div>
        <div className="rounded-xl p-2.5 text-center" style={{ background: "rgba(255,255,255,0.03)" }}>
          <div className="text-xs font-mono font-semibold" style={{ color: myValue > 0 ? "#2dd4bf" : "#4a4568" }}>
            {myValue > 0 ? `$${myValue.toFixed(2)}` : "—"}
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: "#4a4568" }}>My LP</div>
        </div>
      </div>

      {/* Net imbalance direction badge */}
      {row.pool && netLots !== 0 && (
        <div className="flex items-center gap-1.5 mb-3 text-[10px] px-2.5 py-1.5 rounded-lg"
          style={{ background: "rgba(251,191,36,0.08)", color: "#fbbf24" }}>
          <span>⚡</span>
          Pool acting as {netLots > 0 ? "Fixed Receiver" : "Fixed Payer"} for {imbalance} unmatched lot{imbalance !== 1 ? "s" : ""}
        </div>
      )}

      {/* Action button */}
      {publicKey ? (
        <button
          onClick={() => row.pool && onAction(row)}
          disabled={!row.pool}
          className="w-full py-2.5 rounded-xl text-xs font-semibold transition-all"
          style={{
            background: row.pool ? "rgba(153,69,255,0.15)" : "rgba(255,255,255,0.03)",
            border: row.pool ? "1px solid rgba(153,69,255,0.25)" : "1px solid rgba(255,255,255,0.04)",
            color: row.pool ? "#c4b5fd" : "#4a4568",
            cursor: row.pool ? "pointer" : "not-allowed",
          }}>
          {row.pool ? (row.lp && row.lp.shares > 0 ? "Manage Position" : "Provide Liquidity") : "Pool not initialized"}
        </button>
      ) : (
        <div className="w-full py-2.5 text-center text-xs" style={{ color: "#4a4568" }}>
          Connect wallet to provide liquidity
        </div>
      )}
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function PoolPage() {
  const client = useFundexClient();
  const { publicKey } = useWallet();
  const [rows, setRows] = useState<PoolRowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRow, setActiveRow] = useState<PoolRowData | null>(null);

  const loadPools = useCallback(async () => {
    setLoading(true);
    const results: PoolRowData[] = [];
    for (const mkt of MARKETS) {
      for (const dur of [DurationVariant.Days7, DurationVariant.Days30, DurationVariant.Days90, DurationVariant.Days180]) {
        let pool: PoolInfo | null = null;
        let lp: LpPositionInfo | null = null;
        if (client) {
          pool = await client.fetchPool(mkt.perpIndex, dur);
          if (pool && publicKey) {
            lp = await client.fetchLpPosition(publicKey, mkt.perpIndex, dur);
          }
        }
        results.push({
          perpIndex: mkt.perpIndex,
          duration: dur,
          name: mkt.name,
          symbol: mkt.symbol,
          pool,
          lp,
        });
      }
    }
    setRows(results);
    setLoading(false);
  }, [client, publicKey]);

  useEffect(() => { loadPools(); }, [loadPools]);

  // Stats
  const totalTvl = rows.reduce((s, r) => s + (r.pool ? r.pool.vaultBalance / 1_000_000 : 0), 0);
  const activePools = rows.filter((r) => r.pool !== null).length;
  const myTotalValue = rows.reduce((s, r) => s + (r.lp ? r.lp.usdcValue / 1_000_000 : 0), 0);

  return (
    <div style={{ minHeight: "calc(100vh - 56px)", background: "#08090e" }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-black mb-1" style={{ color: "#ede9fe" }}>Liquidity Pools</h1>
          <p className="text-sm" style={{ color: "#6b6890" }}>
            Provide liquidity to earn fees and act as counterparty for unmatched positions.
          </p>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: "Total TVL", value: `$${totalTvl.toFixed(0)}` },
            { label: "Active Pools", value: `${activePools} / 16` },
            { label: "My Liquidity", value: myTotalValue > 0 ? `$${myTotalValue.toFixed(2)}` : "—" },
          ].map((s) => (
            <div key={s.label} className="p-4 rounded-2xl text-center"
              style={{ background: "#0d0c1a", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="text-xl font-black mb-0.5" style={{ color: "#ede9fe" }}>{s.value}</div>
              <div className="text-xs" style={{ color: "#4a4568" }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* How it works */}
        <div className="mb-6 p-4 rounded-2xl text-sm"
          style={{ background: "rgba(153,69,255,0.06)", border: "1px solid rgba(153,69,255,0.15)" }}>
          <div className="font-semibold mb-1" style={{ color: "#c4b5fd" }}>How Pool LP works</div>
          <div style={{ color: "#6b6890" }}>
            Each pool absorbs the net imbalance between Fixed Payers and Fixed Receivers.
            When payers outnumber receivers, the pool acts as the receiver for the difference — earning the rate spread.
            LPs also earn a <span style={{ color: "#fbbf24" }}>0.3% fee</span> on every position opened in the imbalanced direction.
            LP P&L is pro-rata to deposit share.
          </div>
        </div>

        {loading ? (
          <div className="text-center py-20 text-sm" style={{ color: "#4a4568" }}>Loading pools…</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {rows.map((row) => (
              <PoolCard
                key={`${row.perpIndex}-${row.duration}`}
                row={row}
                onAction={setActiveRow}
              />
            ))}
          </div>
        )}

      </div>

      {activeRow && (
        <LpModal
          row={activeRow}
          onClose={() => setActiveRow(null)}
          onSuccess={loadPools}
        />
      )}
    </div>
  );
}
