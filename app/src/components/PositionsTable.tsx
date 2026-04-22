"use client";

import { useState, useCallback, useEffect } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { X, ExternalLink } from "lucide-react";
import { DURATION_LABELS, Side, MARKETS } from "@/lib/constants";
import { FUNDEX_PROGRAM_ID } from "@/lib/fundex/constants";
import { formatUSD, formatRate, formatRelativeTime, truncateError } from "@/lib/utils";
import { NOTIONAL_PER_LOT_LAMPORTS } from "@/lib/fundex/constants";
import { usePositions, OnchainPosition } from "@/hooks/usePositions";
import { useOracleRates } from "@/hooks/useOracleRates";
import { useFundexClient } from "@/hooks/useFundexClient";
import { useRiskScore } from "@/hooks/useRiskScore";
import { useMarketData } from "@/hooks/useMarketData";
import { toast } from "./Toast";

const TABS = ["Positions", "History"] as const;
const lam = (n: number) => n / 1_000_000;

// ─── Risk Badge ───────────────────────────────────────────────────────────────

function RiskBadge({ pos, oracleRate }: { pos: OnchainPosition; oracleRate: number | undefined }) {
  // Pull live OI for the position's (market, duration) so the risk LLM can reason
  // about imbalance instead of seeing 0/0 and hallucinating "balanced OI".
  const market = MARKETS[pos.perpIndex] ?? MARKETS[0];
  const marketData = useMarketData(market, pos.duration);
  const oi = marketData.live
    ? { payerLots: marketData.payerLots, receiverLots: marketData.receiverLots }
    : undefined;
  const risk = useRiskScore(pos, oracleRate, oi);

  if (risk.status === "idle" || risk.status === "loading") {
    return (
      <div className="flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 border border-white/20 border-t-white/50 rounded-full animate-spin" />
        <span className="text-[10px]" style={{ color: "#4a4568" }}>scoring…</span>
      </div>
    );
  }
  if (risk.status === "error") {
    return <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.04)", color: "#6b6890" }}>N/A</span>;
  }

  const { score, reason, level } = risk.data;
  const color = level === "high" ? "#f87171" : level === "medium" ? "#fbbf24" : "#2dd4bf";
  const bg = level === "high" ? "rgba(248,113,113,0.1)" : level === "medium" ? "rgba(251,191,36,0.1)" : "rgba(45,212,191,0.1)";

  return (
    <div className="flex items-center gap-1.5" title={reason}>
      <div className="w-8 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
        <div className="h-full rounded-full" style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="text-[11px] font-mono font-semibold px-1 py-0.5 rounded"
        style={{ background: bg, color }}>
        {score}
      </span>
    </div>
  );
}

function daysLeft(expiryTs: number): string {
  const diff = expiryTs - Math.floor(Date.now() / 1000);
  if (diff <= 0) return "Expired";
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

function expiryColor(expiryTs: number): string {
  const diff = expiryTs - Math.floor(Date.now() / 1000);
  if (diff <= 0) return "#f87171";
  if (diff < 3 * 86400) return "#fbbf24";
  return "#4a4568";
}

// ─── History ─────────────────────────────────────────────────────────────────

interface HistoryEntry {
  sig: string;
  blockTime: number | null | undefined;
  action: string;
}

function useHistory() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    if (!publicKey) { setHistory([]); return; }
    setLoading(true);
    try {
      const sigs = await connection.getSignaturesForAddress(publicKey, { limit: 20 });
      // Fetch all transactions in parallel
      const txs = await Promise.all(
        sigs.map((s) =>
          connection.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 })
            .then((tx) => ({ sig: s.signature, blockTime: s.blockTime, tx }))
            .catch(() => null)
        )
      );
      const fundexId = FUNDEX_PROGRAM_ID.toString();
      const entries: HistoryEntry[] = [];
      for (const item of txs) {
        if (!item?.tx) continue;
        const keys = item.tx.transaction.message.accountKeys.map((k) =>
          typeof k === "string" ? k : k.pubkey.toString()
        );
        if (!keys.includes(fundexId)) continue;

        let action = "Transaction";
        const logs = item.tx.meta?.logMessages ?? [];
        for (const log of logs) {
          if (log.includes("Instruction: OpenPosition")) { action = "Open Position"; break; }
          if (log.includes("Instruction: ClosePosition")) { action = "Close Position"; break; }
          if (log.includes("Instruction: SettleFunding")) { action = "Settle Funding"; break; }
          if (log.includes("Instruction: LiquidatePosition")) { action = "Liquidation"; break; }
        }
        if (action === "Settle Funding") continue;

        entries.push({ sig: item.sig, blockTime: item.blockTime, action });
        if (entries.length >= 20) break;
      }
      setHistory(entries);
    } catch {
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, [connection, publicKey]);

  useEffect(() => { fetch(); }, [fetch]);
  return { history, loading, refresh: fetch };
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function PositionsTable() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Positions");
  const client = useFundexClient();
  const { publicKey } = useWallet();
  const { positions, loading, refresh } = usePositions();
  const oracleRates = useOracleRates(MARKETS.map((m) => m.perpIndex));
  const { history, loading: histLoading, refresh: refreshHistory } = useHistory();
  const [closing, setClosing] = useState<string | null>(null);

  const handleClose = useCallback(async (posKey: string) => {
    const pos = positions.find((p) => p.address.toString() === posKey);
    if (!client || !pos) return;
    setClosing(posKey);
    try {
      const sig = await client.closePosition(pos.perpIndex, pos.duration, pos.userTokenAccount);
      refresh();
      refreshHistory();
      toast("success", "Position closed", pos.marketName, sig);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/already (been )?processed/i.test(msg)) {
        refresh();
        refreshHistory();
        toast("success", "Position closed", pos.marketName);
      } else {
        toast("error", "Close failed", truncateError(msg));
      }
    } finally {
      setClosing(null);
    }
  }, [client, positions, refresh, refreshHistory]);

  return (
    <div className="text-xs" style={{ background: "#0d0c1a" }}>
      {/* Tabs */}
      <div className="flex items-center px-5 gap-1"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className="relative px-1 py-3 mr-3 font-semibold transition-colors"
            style={{ color: tab === t ? "#ede9fe" : "#4a4568" }}>
            {t}
            {t === "Positions" && positions.length > 0 && (
              <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full"
                style={{ background: "rgba(153,69,255,0.15)", color: "#c4b5fd" }}>
                {positions.length}
              </span>
            )}
            {tab === t && (
              <div className="absolute bottom-0 left-0 right-0 h-[1.5px] rounded-full"
                style={{ background: "linear-gradient(90deg, #9945ff, #43b4ca)" }} />
            )}
          </button>
        ))}
        {(loading || histLoading) && (
          <span className="ml-auto mr-1 w-3 h-3 border border-white/20 border-t-white/60 rounded-full animate-spin" />
        )}
      </div>

      {/* ── Positions Tab ── */}
      {tab === "Positions" && positions.length > 0 && (
        <div className="overflow-x-auto">
        <table className="w-full min-w-max">
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
              {["Market", "Side", "Size", "Entry Rate", "Current Rate", "PnL", "Margin", "Expiry", "Liq. Est.", "AI Risk"].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left font-medium whitespace-nowrap"
                  style={{ color: "#4a4568" }}>{h}</th>
              ))}
              <th className="py-2.5 text-left font-medium whitespace-nowrap sticky right-0 px-3"
                style={{ color: "#4a4568", background: "#0d0c1a" }} />
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => {
              const notionalUsd = lam(p.lots * NOTIONAL_PER_LOT_LAMPORTS);
              const pnlUsd = lam(p.unrealizedPnl);
              const posKey = p.address.toString();
              const isClosing = closing === posKey;
              const currentRate = oracleRates[p.perpIndex];
              const exColor = expiryColor(p.expiryTs);
              return (
                <tr key={posKey}
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.015)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>

                  {/* Market */}
                  <td className="px-4 py-3">
                    <span className="font-semibold" style={{ color: "#ede9fe" }}>{p.marketName}</span>
                    <span className="ml-1.5 font-normal" style={{ color: "#4a4568" }}>{DURATION_LABELS[p.duration]}</span>
                  </td>

                  {/* Side */}
                  <td className="px-4 py-3">
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                      style={{
                        background: p.side === Side.FixedPayer ? "rgba(45,212,191,0.1)" : "rgba(153,69,255,0.1)",
                        color: p.side === Side.FixedPayer ? "#2dd4bf" : "#c4b5fd",
                      }}>
                      {p.side === Side.FixedPayer ? "Payer" : "Receiver"}
                    </span>
                  </td>

                  {/* Size */}
                  <td className="px-4 py-3 font-mono" style={{ color: "#8b87a8" }}>
                    {p.lots} · {formatUSD(notionalUsd)}
                  </td>

                  {/* Entry Rate */}
                  <td className="px-4 py-3 font-mono" style={{ color: "#4a4568" }}>
                    {formatRate(p.fixedRate)}
                  </td>

                  {/* Current Rate */}
                  <td className="px-4 py-3 font-mono"
                    style={{ color: currentRate == null ? "#4a4568" : currentRate >= 0 ? "#2dd4bf" : "#f87171" }}>
                    {currentRate != null ? formatRate(currentRate) : "—"}
                  </td>

                  {/* PnL */}
                  <td className="px-4 py-3 font-mono font-semibold"
                    style={{ color: pnlUsd >= 0 ? "#2dd4bf" : "#f87171" }}>
                    {pnlUsd >= 0 ? "+" : ""}{formatUSD(pnlUsd)}
                  </td>

                  {/* Margin */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <div className="w-10 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                        <div className="h-full rounded-full" style={{
                          width: `${Math.min(100, (p.marginRatioBps / 2000) * 100)}%`,
                          background: p.marginRatioBps > 1000 ? "#2dd4bf" : p.marginRatioBps > 500 ? "#fbbf24" : "#f87171",
                        }} />
                      </div>
                      <span className="font-mono" style={{ color: "#4a4568" }}>
                        {(p.marginRatioBps / 100).toFixed(0)}%
                      </span>
                    </div>
                  </td>

                  {/* Expiry */}
                  <td className="px-4 py-3 font-mono whitespace-nowrap" style={{ color: exColor }}>
                    {daysLeft(p.expiryTs)}
                  </td>

                  {/* Settlements to Liq */}
                  <td className="px-4 py-3 font-mono whitespace-nowrap"
                    style={{ color: p.settlementsToLiq != null && p.settlementsToLiq < 10 ? "#fbbf24" : "#4a4568" }}>
                    {p.settlementsToLiq != null ? `~${p.settlementsToLiq}` : "—"}
                  </td>

                  {/* AI Risk */}
                  <td className="px-4 py-3">
                    <RiskBadge pos={p} oracleRate={currentRate} />
                  </td>

                  {/* Close */}
                  <td className="py-3 px-3 sticky right-0" style={{ background: "#0d0c1a" }}>
                    <button onClick={() => handleClose(posKey)} disabled={isClosing}
                      className="px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-colors"
                      style={{
                        background: "rgba(248,113,113,0.08)",
                        color: isClosing ? "#4a4568" : "#f87171",
                        cursor: isClosing ? "not-allowed" : "pointer",
                      }}>
                      {isClosing
                        ? <span className="w-3 h-3 border border-white/20 border-t-white/50 rounded-full animate-spin" />
                        : <X size={9} />}
                      Close
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}

      {tab === "Positions" && !loading && positions.length === 0 && (
        <div className="py-16 text-center" style={{ color: "#2d2b45" }}>
          {publicKey ? "No open positions" : "Connect wallet to view positions"}
        </div>
      )}
      {tab === "Positions" && loading && positions.length === 0 && (
        <div className="py-16 text-center" style={{ color: "#2d2b45" }}>Loading positions…</div>
      )}

      {/* ── History Tab ── */}
      {tab === "History" && (
        <>
          {histLoading && history.length === 0 && (
            <div className="py-16 text-center" style={{ color: "#2d2b45" }}>Loading history…</div>
          )}
          {!histLoading && history.length === 0 && (
            <div className="py-16 text-center" style={{ color: "#2d2b45" }}>
              {publicKey ? "No transactions found" : "Connect wallet to view history"}
            </div>
          )}
          {history.length > 0 && (
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                  {["Action", "Time", "Tx"].map((h) => (
                    <th key={h} className="px-5 py-2.5 text-left font-medium" style={{ color: "#4a4568" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((h) => {
                  const isOpen = h.action === "Open Position";
                  const isClose = h.action === "Close Position";
                  const isLiq = h.action === "Liquidation";
                  const color = isOpen ? "#2dd4bf" : isClose ? "#c4b5fd" : isLiq ? "#f87171" : "#8b87a8";
                  const timeStr = h.blockTime ? formatRelativeTime(h.blockTime) : "—";
                  const timeTitle = h.blockTime ? new Date(h.blockTime * 1000).toLocaleString() : undefined;
                  return (
                    <tr key={h.sig}
                      style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.015)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                      <td className="px-5 py-3">
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                          style={{ background: `${color}18`, color }}>
                          {h.action}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-mono" style={{ color: "#4a4568" }} title={timeTitle}>{timeStr}</td>
                      <td className="px-5 py-3">
                        <a href={`https://explorer.solana.com/tx/${h.sig}?cluster=devnet`}
                          target="_blank" rel="noopener noreferrer"
                          className="font-mono flex items-center gap-1 hover:opacity-70 transition-opacity"
                          style={{ color: "#9945ff" }}>
                          {h.sig.slice(0, 8)}… <ExternalLink size={9} />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
