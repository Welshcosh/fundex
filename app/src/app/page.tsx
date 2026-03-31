"use client";

import Link from "next/link";
import { ArrowRight, Shield, Zap, TrendingUp, BarChart2, Lock, RefreshCw } from "lucide-react";
import { MARKETS } from "@/lib/constants";
import { formatRate, formatRateAnnualized } from "@/lib/utils";

const STATS = [
  { label: "Total Markets", value: "16", sub: "4 perps × 4 durations" },
  { label: "Settlement", value: "1 min", sub: "Devnet demo mode" },
  { label: "Max Leverage", value: "10×", sub: "10% initial margin" },
  { label: "Network", value: "Solana", sub: "Devnet live" },
];

const FEATURES = [
  {
    icon: TrendingUp,
    title: "Long or Short Funding Rates",
    desc: "Take a directional view on perpetual funding rates. Fixed Payer profits when rates rise; Fixed Receiver profits when rates fall.",
    color: "#2dd4bf",
  },
  {
    icon: Lock,
    title: "Lock In a Fixed Rate",
    desc: "Hedge your perp positions by receiving a fixed rate and paying the variable funding rate — eliminating funding cost uncertainty.",
    color: "#c4b5fd",
  },
  {
    icon: RefreshCw,
    title: "Oracle-Driven Pricing",
    desc: "Fixed rates are set by an on-chain EMA oracle tracking live Drift Protocol funding rates. No central party controls pricing.",
    color: "#9945ff",
  },
  {
    icon: Shield,
    title: "Fully On-Chain",
    desc: "Every position, settlement, and liquidation happens on Solana. Permissionless, non-custodial, and transparent.",
    color: "#43b4ca",
  },
  {
    icon: Zap,
    title: "Capital Efficient",
    desc: "Open positions with just 10% initial margin. Up to 10× leverage on funding rate exposure across 4 expiry durations.",
    color: "#fbbf24",
  },
  {
    icon: BarChart2,
    title: "Multiple Durations",
    desc: "Trade 7-day, 30-day, 90-day, and 180-day markets. Longer durations provide more stable exposure to persistent funding trends.",
    color: "#f87171",
  },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Choose a Market",
    desc: "Select a perp (BTC, ETH, SOL, JTO) and an expiry duration (7D–180D).",
  },
  {
    step: "02",
    title: "Pick Your Side",
    desc: "Fixed Payer: pay fixed, receive variable. Profit when funding rates rise. Fixed Receiver: receive fixed, pay variable. Hedge your perp book.",
  },
  {
    step: "03",
    title: "Open Position",
    desc: "Deposit 10% of notional as collateral. Your position is live on-chain immediately.",
  },
  {
    step: "04",
    title: "Earn PnL Every Settlement",
    desc: "Every funding settlement, your PnL updates: (variable − fixed) × notional. Close any time to realise gains.",
  },
];

export default function LandingPage() {
  return (
    <div style={{ background: "#08090e", minHeight: "100vh" }}>

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="relative flex flex-col items-center justify-center text-center px-6 pt-32 pb-24 overflow-hidden">
        {/* Glow bg */}
        <div className="absolute inset-0 pointer-events-none" style={{
          background: "radial-gradient(ellipse 80% 50% at 50% 0%, rgba(153,69,255,0.12) 0%, transparent 70%)",
        }} />

        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium mb-6"
          style={{ background: "rgba(153,69,255,0.1)", border: "1px solid rgba(153,69,255,0.2)", color: "#c4b5fd" }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#9945ff" }} />
          Live on Solana Devnet
        </div>

        <h1 className="text-4xl sm:text-6xl font-black tracking-tight mb-6 leading-tight"
          style={{ color: "#ede9fe", maxWidth: 720 }}>
          Trade{" "}
          <span style={{ background: "linear-gradient(135deg, #9945ff, #43b4ca)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Funding Rates
          </span>
          {" "}on Solana
        </h1>

        <p className="text-base sm:text-lg mb-10" style={{ color: "#6b6890", maxWidth: 560 }}>
          Fundex is a fully on-chain funding rate swap market. Go long or short on perpetual funding rates — hedge your perp book or speculate on rate direction.
        </p>

        <div className="flex flex-col sm:flex-row items-center gap-3">
          <Link href="/trade"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl font-bold text-sm transition-all"
            style={{
              background: "linear-gradient(135deg, #9945ff, #7b61ff)",
              color: "#fff",
              boxShadow: "0 4px 24px rgba(153,69,255,0.35)",
            }}>
            Launch App <ArrowRight size={15} />
          </Link>
          <Link href="/markets"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl font-bold text-sm transition-all"
            style={{
              background: "rgba(255,255,255,0.04)",
              color: "#8b87a8",
              border: "1px solid rgba(255,255,255,0.07)",
            }}>
            View Markets
          </Link>
        </div>
      </section>

      {/* ── Stats ────────────────────────────────────────────────── */}
      <section className="max-w-4xl mx-auto px-6 pb-20">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {STATS.map((s) => (
            <div key={s.label} className="p-5 rounded-2xl text-center"
              style={{ background: "#0d0c1a", border: "1px solid rgba(255,255,255,0.05)" }}>
              <div className="text-2xl font-black mb-1" style={{ color: "#ede9fe" }}>{s.value}</div>
              <div className="text-xs font-semibold mb-0.5" style={{ color: "#c4b5fd" }}>{s.label}</div>
              <div className="text-[11px]" style={{ color: "#4a4568" }}>{s.sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Live Markets Preview ──────────────────────────────────── */}
      <section className="max-w-4xl mx-auto px-6 pb-24">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold" style={{ color: "#ede9fe" }}>Live Markets</h2>
          <Link href="/markets" className="text-xs font-medium flex items-center gap-1 transition-opacity hover:opacity-70"
            style={{ color: "#9945ff" }}>
            View all <ArrowRight size={11} />
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {MARKETS.map((m) => (
            <Link key={m.perpIndex} href={`/trade?perp=${m.perpIndex}&dur=1`}
              className="group flex items-center justify-between p-5 rounded-2xl transition-all"
              style={{ background: "#0d0c1a", border: "1px solid rgba(255,255,255,0.05)" }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = "rgba(153,69,255,0.25)")}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.05)")}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold"
                  style={{ background: "linear-gradient(135deg, rgba(153,69,255,0.2), rgba(67,180,202,0.2))", color: "#c4b5fd", border: "1px solid rgba(153,69,255,0.2)" }}>
                  {m.symbol[0]}
                </div>
                <div>
                  <div className="font-bold text-sm" style={{ color: "#ede9fe" }}>{m.name}</div>
                  <div className="text-[11px]" style={{ color: "#4a4568" }}>Funding Rate Swap</div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono font-bold text-sm" style={{ color: "#2dd4bf" }}>
                  +{formatRate(m.baseRate)}
                </div>
                <div className="text-[11px] font-mono" style={{ color: "#4a4568" }}>
                  {formatRateAnnualized(m.baseRate)} APY
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ── How It Works ─────────────────────────────────────────── */}
      <section className="max-w-4xl mx-auto px-6 pb-24">
        <h2 className="text-xl font-bold mb-8 text-center" style={{ color: "#ede9fe" }}>How It Works</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {HOW_IT_WORKS.map((h) => (
            <div key={h.step} className="p-6 rounded-2xl"
              style={{ background: "#0d0c1a", border: "1px solid rgba(255,255,255,0.05)" }}>
              <div className="text-3xl font-black mb-3" style={{ color: "rgba(153,69,255,0.25)" }}>{h.step}</div>
              <div className="font-bold text-sm mb-2" style={{ color: "#ede9fe" }}>{h.title}</div>
              <div className="text-xs leading-relaxed" style={{ color: "#6b6890" }}>{h.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────── */}
      <section className="max-w-4xl mx-auto px-6 pb-24">
        <h2 className="text-xl font-bold mb-8 text-center" style={{ color: "#ede9fe" }}>Why Fundex</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="p-5 rounded-2xl"
              style={{ background: "#0d0c1a", border: "1px solid rgba(255,255,255,0.05)" }}>
              <div className="w-8 h-8 rounded-xl flex items-center justify-center mb-3"
                style={{ background: `${f.color}18`, border: `1px solid ${f.color}30` }}>
                <f.icon size={15} style={{ color: f.color }} />
              </div>
              <div className="font-bold text-sm mb-1.5" style={{ color: "#ede9fe" }}>{f.title}</div>
              <div className="text-xs leading-relaxed" style={{ color: "#6b6890" }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────── */}
      <section className="max-w-4xl mx-auto px-6 pb-32">
        <div className="relative rounded-3xl p-10 text-center overflow-hidden"
          style={{ background: "linear-gradient(135deg, rgba(153,69,255,0.12), rgba(67,180,202,0.08))", border: "1px solid rgba(153,69,255,0.2)" }}>
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: "radial-gradient(ellipse 60% 60% at 50% 0%, rgba(153,69,255,0.1), transparent)" }} />
          <h2 className="text-2xl font-black mb-3 relative" style={{ color: "#ede9fe" }}>
            Start Trading Funding Rates
          </h2>
          <p className="text-sm mb-7 relative" style={{ color: "#6b6890", maxWidth: 420, margin: "0 auto 28px" }}>
            Connect your wallet, get devnet USDC from the faucet, and open your first position in under a minute.
          </p>
          <Link href="/trade"
            className="inline-flex items-center gap-2 px-8 py-3.5 rounded-2xl font-bold text-sm relative"
            style={{
              background: "linear-gradient(135deg, #9945ff, #43b4ca)",
              color: "#fff",
              boxShadow: "0 4px 24px rgba(153,69,255,0.4)",
            }}>
            Launch App <ArrowRight size={15} />
          </Link>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <footer className="border-t" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
        <div className="max-w-4xl mx-auto px-6 py-8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-lg flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #9945ff, #43b4ca)" }}>
              <svg width="9" height="9" viewBox="0 0 14 14" fill="none">
                <path d="M7 1L13 10H1L7 1Z" fill="white" fillOpacity="0.9" />
              </svg>
            </div>
            <span className="text-xs font-bold" style={{ color: "#4a4568" }}>fundex</span>
          </div>
          <span className="text-xs" style={{ color: "#2d2b45" }}>
            Built for Seoulana WarmUp Hackathon 2026
          </span>
        </div>
      </footer>

    </div>
  );
}
