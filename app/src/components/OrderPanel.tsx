"use client";

import { useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  MarketInfo, DurationVariant, Side,
  INITIAL_MARGIN_BPS, MAINT_MARGIN_BPS, DURATION_FULL_LABELS,
} from "@/lib/constants";
import { NOTIONAL_PER_LOT_LAMPORTS, USDC_MINT } from "@/lib/fundex/constants";
import { formatRate, formatUSD } from "@/lib/utils";
import { useFundexClient } from "@/hooks/useFundexClient";
import { useUsdcBalance } from "@/hooks/useUsdcBalance";
import { OnchainMarketData } from "@/hooks/useMarketData";
import { toast } from "./Toast";

/** Display units: $100 per lot */
const LOT_DISPLAY = 100;

export function OrderPanel({ market, duration, onchainData }: { market: MarketInfo; duration: DurationVariant; onchainData: OnchainMarketData }) {
  const { connected, publicKey } = useWallet();
  const client = useFundexClient();
  const { usd: balanceUsd, lamports: balanceLamports, refresh: refreshBalance } = useUsdcBalance();

  const [side, setSide] = useState<Side>(Side.FixedPayer);
  const [lots, setLots] = useState(1);
  const [loading, setLoading] = useState(false);
  const [faucetLoading, setFaucetLoading] = useState(false);

  const notional = lots * LOT_DISPLAY;
  const collateralUsd = (notional * INITIAL_MARGIN_BPS) / 10_000;
  const collateralLamports = lots * NOTIONAL_PER_LOT_LAMPORTS * INITIAL_MARGIN_BPS / 10_000;

  // AMM-style dynamic fee: 0.3% base + up to 0.7% imbalance premium
  const payerLots = onchainData.payerLots;
  const receiverLots = onchainData.receiverLots;
  const increasesImbalance = side === Side.FixedPayer
    ? payerLots >= receiverLots
    : receiverLots >= payerLots;
  const totalLots = payerLots + receiverLots;
  const netLots = Math.abs(payerLots - receiverLots);
  const imbalanceRatio = totalLots > 0 ? Math.min(netLots * 10_000 / totalLots, 10_000) : 0;
  const dynamicFeeBps = increasesImbalance ? 30 + Math.round(imbalanceRatio * 70 / 10_000) : 0;
  const lpFeeUsd = (notional * dynamicFeeBps) / 10_000;

  const fixedRate = onchainData.fixedRate;
  const variableRate = onchainData.variableRate;
  const pnlPerSettlement =
    side === Side.FixedPayer
      ? ((variableRate - fixedRate) / 10_000) * notional
      : -((variableRate - fixedRate) / 10_000) * notional;
  const maxLoss = collateralUsd - (notional * MAINT_MARGIN_BPS) / 10_000;
  const toRuin = maxLoss > 0 && pnlPerSettlement < 0 ? Math.floor(maxLoss / Math.abs(pnlPerSettlement)) : null;

  const totalRequired = collateralLamports + Math.ceil(lots * NOTIONAL_PER_LOT_LAMPORTS * dynamicFeeBps / 10_000);
  const insufficient = connected && totalRequired > balanceLamports;
  const isLong = side === Side.FixedPayer;

  const handleFaucet = useCallback(async () => {
    if (!connected || !publicKey || faucetLoading) return;
    setFaucetLoading(true);
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: publicKey.toString() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Faucet error");
      refreshBalance();
      toast("success", "Faucet", `1,000 USDC sent to your wallet`, data.sig);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast("error", "Faucet failed", msg.slice(0, 80));
    } finally {
      setFaucetLoading(false);
    }
  }, [connected, publicKey, faucetLoading, refreshBalance]);

  const handleOpen = useCallback(async () => {
    if (!client || !connected || insufficient || loading) return;
    setLoading(true);
    try {
      const userTokenAccount = getAssociatedTokenAddressSync(
        USDC_MINT,
        client.wallet
      );
      const sig = await client.openPosition(
        market.perpIndex,
        duration,
        side,
        lots,
        userTokenAccount
      );
      refreshBalance();
      toast(
        "success",
        "Position opened",
        `${lots} lot${lots > 1 ? "s" : ""} · ${market.name}`,
        sig
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast("error", "Transaction failed", msg.slice(0, 80));
    } finally {
      setLoading(false);
    }
  }, [client, connected, insufficient, loading, market, duration, side, lots, refreshBalance]);

  return (
    <div className="flex flex-col h-full" style={{ background: "#0d0c1a" }}>
      <div className="flex flex-col h-full p-4 gap-4">

        {/* Side selector */}
        <div className="p-1 rounded-2xl grid grid-cols-2 gap-1"
          style={{ background: "rgba(255,255,255,0.04)" }}>
          {[Side.FixedPayer, Side.FixedReceiver].map((s) => {
            const active = side === s;
            const isP = s === Side.FixedPayer;
            return (
              <button key={s} onClick={() => setSide(s)}
                className="py-2.5 rounded-xl text-sm font-semibold transition-all"
                style={{
                  background: active
                    ? isP
                      ? "linear-gradient(135deg, rgba(45,212,191,0.18), rgba(45,212,191,0.08))"
                      : "linear-gradient(135deg, rgba(196,181,253,0.18), rgba(153,69,255,0.08))"
                    : "transparent",
                  color: active ? (isP ? "#2dd4bf" : "#c4b5fd") : "#4a4568",
                  border: active
                    ? `1px solid ${isP ? "rgba(45,212,191,0.25)" : "rgba(196,181,253,0.25)"}`
                    : "1px solid transparent",
                }}>
                <div>{isP ? "Fixed Payer" : "Fixed Receiver"}</div>
                <div className="text-[10px] font-normal mt-0.5" style={{ opacity: 0.65 }}>
                  {isP ? "Long funding rate" : "Short funding rate"}
                </div>
              </button>
            );
          })}
        </div>

        {/* Hint */}
        <p className="text-xs leading-relaxed" style={{ color: "#4a4568" }}>
          {isLong
            ? "You pay a fixed rate and receive the variable funding rate. Profit when rates rise."
            : "You receive a fixed rate and pay the variable rate. Hedge your perp position."}
        </p>

        {/* Size */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span style={{ color: "#6b6890" }}>Size</span>
            <span style={{ color: "#4a4568" }}>1 lot = $100 notional</span>
          </div>

          <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl"
            style={{ background: "rgba(255,255,255,0.04)" }}>
            <button onClick={() => setLots((v) => Math.max(1, v - 1))}
              className="w-7 h-7 rounded-xl flex items-center justify-center text-base font-bold transition-colors"
              style={{ background: "rgba(255,255,255,0.06)", color: "#8b87a8" }}>−</button>
            <input type="number" value={lots} min={1} max={100}
              onChange={(e) => setLots(Math.max(1, Math.min(100, +e.target.value)))}
              className="flex-1 text-center font-mono font-bold text-lg bg-transparent outline-none"
              style={{ color: "#ede9fe" }} />
            <button onClick={() => setLots((v) => Math.min(100, v + 1))}
              className="w-7 h-7 rounded-xl flex items-center justify-center text-base font-bold transition-colors"
              style={{ background: "rgba(255,255,255,0.06)", color: "#8b87a8" }}>+</button>
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            {[1, 5, 10, 25].map((n) => (
              <button key={n} onClick={() => setLots(n)}
                className="py-1.5 rounded-xl text-xs font-semibold transition-all"
                style={{
                  background: lots === n ? "rgba(153,69,255,0.15)" : "rgba(255,255,255,0.03)",
                  color: lots === n ? "#c4b5fd" : "#4a4568",
                  border: `1px solid ${lots === n ? "rgba(153,69,255,0.2)" : "transparent"}`,
                }}>
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Summary */}
        <div className="rounded-2xl p-4 space-y-2.5 text-xs"
          style={{ background: "rgba(255,255,255,0.03)" }}>
          {[
            ["Notional", formatUSD(notional), "#8b87a8"],
            ["Collateral (10%)", formatUSD(collateralUsd), "#8b87a8"],
            [`AMM fee (${(dynamicFeeBps / 100).toFixed(1)}%)`, formatUSD(lpFeeUsd), increasesImbalance ? "#fbbf24" : "#4a4568"],
            ["Fixed rate", `+${formatRate(fixedRate)} / 8h`, "#6b6890"],
            ["Variable rate", `+${formatRate(variableRate)} / 8h`, "#2dd4bf"],
          ].map(([label, value, color]) => (
            <div key={label as string} className="flex items-center justify-between">
              <span style={{ color: "#4a4568" }}>{label}</span>
              <span className="font-mono" style={{ color: color as string }}>{value}</span>
            </div>
          ))}

          <div style={{ height: "1px", background: "rgba(255,255,255,0.05)", margin: "2px 0" }} />

          <div className="flex items-center justify-between">
            <span style={{ color: "#4a4568" }}>Est. PnL / settlement</span>
            <span className="font-mono font-semibold"
              style={{ color: pnlPerSettlement >= 0 ? "#2dd4bf" : "#f87171" }}>
              {pnlPerSettlement >= 0 ? "+" : ""}{formatUSD(pnlPerSettlement)}
            </span>
          </div>

          {toRuin !== null && (
            <div className="flex items-center justify-between">
              <span style={{ color: "#4a4568" }}>Settlements to liq.</span>
              <span className="font-mono" style={{ color: toRuin < 10 ? "#fbbf24" : "#4a4568" }}>
                ~{toRuin}
              </span>
            </div>
          )}
        </div>

        {/* Balance + Faucet */}
        {connected && (
          <div className="flex items-center justify-between text-xs px-1">
            <span style={{ color: "#4a4568" }}>Wallet balance</span>
            <div className="flex items-center gap-2">
              <span className="font-mono" style={{ color: insufficient ? "#f87171" : "#4a4568" }}>
                ${balanceUsd.toFixed(2)} USDC
              </span>
              {balanceLamports === 0 && (
                <button
                  onClick={handleFaucet}
                  disabled={faucetLoading}
                  className="text-[10px] px-2 py-0.5 rounded-lg font-semibold transition-all"
                  style={{
                    background: faucetLoading ? "rgba(255,255,255,0.04)" : "rgba(153,69,255,0.15)",
                    color: faucetLoading ? "#4a4568" : "#c4b5fd",
                    border: "1px solid rgba(153,69,255,0.2)",
                    cursor: faucetLoading ? "not-allowed" : "pointer",
                  }}>
                  {faucetLoading ? "…" : "Get 1000 USDC"}
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex-1" />

        {/* CTA */}
        {connected ? (
          <button onClick={handleOpen} disabled={loading || insufficient}
            className="w-full py-3.5 rounded-2xl font-bold text-sm transition-all"
            style={{
              background: loading || insufficient
                ? "rgba(255,255,255,0.05)"
                : isLong
                  ? "linear-gradient(135deg, #2dd4bf, #0891b2)"
                  : "linear-gradient(135deg, #9945ff, #7b61ff)",
              color: loading || insufficient ? "#4a4568" : "#fff",
              cursor: loading || insufficient ? "not-allowed" : "pointer",
              boxShadow: loading || insufficient ? "none"
                : isLong ? "0 4px 20px rgba(45,212,191,0.25)" : "0 4px 20px rgba(153,69,255,0.3)",
            }}>
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Confirming…
              </span>
            ) : insufficient ? "Insufficient balance" : (
              `Open ${isLong ? "Fixed Payer" : "Fixed Receiver"} · ${lots} lot${lots > 1 ? "s" : ""}`
            )}
          </button>
        ) : (
          <div className="w-full py-3.5 rounded-2xl text-sm text-center font-medium"
            style={{ background: "rgba(255,255,255,0.04)", color: "#4a4568" }}>
            Connect wallet to trade
          </div>
        )}

        <p className="text-center text-[11px]" style={{ color: "#2d2b45" }}>
          {DURATION_FULL_LABELS[duration]} · 10× leverage
        </p>
      </div>
    </div>
  );
}
