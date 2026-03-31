"use client";

import Link from "next/link";
import { ArrowRight, Shield, Zap, TrendingUp, BarChart2, Lock, RefreshCw } from "lucide-react";
import { MARKETS, DurationVariant } from "@/lib/constants";
import { formatRate, formatRateAnnualized, formatUSD } from "@/lib/utils";
import { useMarketData } from "@/hooks/useMarketData";

// ─── Shared wrapper ───────────────────────────────────────────────────────────
function Section({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`w-full px-4 sm:px-8 lg:px-12 py-16 ${className}`}>
      <div className="max-w-6xl mx-auto">{children}</div>
    </section>
  );
}

// ─── Live Stats ───────────────────────────────────────────────────────────────
function LiveStats() {
  const d = [
    useMarketData(MARKETS[0], DurationVariant.Days7),
    useMarketData(MARKETS[0], DurationVariant.Days30),
    useMarketData(MARKETS[0], DurationVariant.Days90),
    useMarketData(MARKETS[0], DurationVariant.Days180),
    useMarketData(MARKETS[1], DurationVariant.Days7),
    useMarketData(MARKETS[1], DurationVariant.Days30),
    useMarketData(MARKETS[1], DurationVariant.Days90),
    useMarketData(MARKETS[1], DurationVariant.Days180),
    useMarketData(MARKETS[2], DurationVariant.Days7),
    useMarketData(MARKETS[2], DurationVariant.Days30),
    useMarketData(MARKETS[2], DurationVariant.Days90),
    useMarketData(MARKETS[2], DurationVariant.Days180),
    useMarketData(MARKETS[3], DurationVariant.Days7),
    useMarketData(MARKETS[3], DurationVariant.Days30),
    useMarketData(MARKETS[3], DurationVariant.Days90),
    useMarketData(MARKETS[3], DurationVariant.Days180),
  ];
  const totalOI = d.reduce((s, x) => s + x.oiUsd, 0);
  const anyLive = d.some((x) => x.live);

  const stats = [
    { label: "Total Markets",       value: "16",                                   sub: "4 perps × 4 durations" },
    { label: "Total Open Interest", value: anyLive ? formatUSD(totalOI) : "—",     sub: anyLive ? "Live on-chain" : "Loading…" },
    { label: "Max Leverage",        value: "10×",                                  sub: "10% initial margin" },
    { label: "Network",             value: "Solana",                               sub: "Devnet live" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((s) => (
        <div key={s.label} className="p-6 rounded-2xl text-center"
          style={{ background: "#0d0c1a", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="text-2xl sm:text-3xl font-black mb-1" style={{ color: "#ede9fe" }}>{s.value}</div>
          <div className="text-xs font-semibold mb-1" style={{ color: "#c4b5fd" }}>{s.label}</div>
          <div className="text-xs" style={{ color: "#4a4568" }}>{s.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Live Market Card ─────────────────────────────────────────────────────────
function LiveMarketCard({ market }: { market: typeof MARKETS[number] }) {
  const data = useMarketData(market, DurationVariant.Days7);
  const rate = data.live ? data.variableRate : market.baseRate;
  return (
    <Link href={`/trade?perp=${market.perpIndex}&dur=1`}
      className="group flex items-center justify-between p-5 rounded-2xl transition-all"
      style={{ background: "#0d0c1a", border: "1px solid rgba(255,255,255,0.06)" }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "rgba(153,69,255,0.3)")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)")}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0"
          style={{ background: "linear-gradient(135deg,rgba(153,69,255,0.2),rgba(67,180,202,0.2))", color: "#c4b5fd", border: "1px solid rgba(153,69,255,0.2)" }}>
          {market.symbol[0]}
        </div>
        <div>
          <div className="font-bold text-sm" style={{ color: "#ede9fe" }}>{market.name}</div>
          <div className="text-xs flex items-center gap-1 mt-0.5" style={{ color: "#4a4568" }}>
            {data.live && <span style={{ color: "#2dd4bf" }}>●</span>}
            Funding Rate Swap
          </div>
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="font-mono font-bold text-sm" style={{ color: "#2dd4bf" }}>+{formatRate(rate)}</div>
        <div className="text-xs font-mono mt-0.5" style={{ color: "#4a4568" }}>{formatRateAnnualized(rate)} APY</div>
      </div>
    </Link>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
const FEATURES = [
  { icon: TrendingUp, title: "Long or Short Funding Rates",  color: "#2dd4bf", desc: "Take a directional view on perpetual funding rates. Fixed Payer profits when rates rise; Fixed Receiver profits when rates fall." },
  { icon: Lock,       title: "Lock In a Fixed Rate",         color: "#c4b5fd", desc: "Hedge your perp positions by receiving a fixed rate and paying the variable funding rate — eliminating funding cost uncertainty." },
  { icon: RefreshCw,  title: "Oracle-Driven Pricing",        color: "#9945ff", desc: "Fixed rates are set by an on-chain EMA oracle tracking live Drift Protocol funding rates. No central party controls pricing." },
  { icon: Shield,     title: "Fully On-Chain",               color: "#43b4ca", desc: "Every position, settlement, and liquidation happens on Solana. Permissionless, non-custodial, and transparent." },
  { icon: Zap,        title: "Capital Efficient",            color: "#fbbf24", desc: "Open positions with just 10% initial margin. Up to 10× leverage on funding rate exposure across 4 expiry durations." },
  { icon: BarChart2,  title: "Multiple Durations",           color: "#f87171", desc: "Trade 7D, 30D, 90D, and 180D markets. Longer durations provide more stable exposure to persistent funding trends." },
];

const HOW_IT_WORKS = [
  { step: "01", title: "Choose a Market",         desc: "Select a perp (BTC, ETH, SOL, JTO) and an expiry duration (7D–180D)." },
  { step: "02", title: "Pick Your Side",          desc: "Fixed Payer: pay fixed, receive variable — profit when rates rise. Fixed Receiver: receive fixed, pay variable — hedge your perp book." },
  { step: "03", title: "Open Position",           desc: "Deposit 10% of notional as collateral. Your position is live on-chain immediately." },
  { step: "04", title: "Earn PnL Every Settlement", desc: "Every funding period, PnL updates: (variable − fixed) × notional. Close any time to realise gains." },
];

export default function LandingPage() {
  return (
    <div style={{ background: "#08090e", minHeight: "100vh" }}>

      {/* ── Hero ── */}
      <section className="w-full px-4 sm:px-8 lg:px-12 pt-32 pb-20 flex flex-col items-center text-center">
        <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 0 }}>
          <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: "80%", height: "50%", background: "radial-gradient(ellipse at center top, rgba(153,69,255,0.12), transparent 70%)" }} />
        </div>

        <div className="relative z-10 flex flex-col items-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium mb-6"
            style={{ background: "rgba(153,69,255,0.1)", border: "1px solid rgba(153,69,255,0.2)", color: "#c4b5fd" }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#9945ff" }} />
            Live on Solana Devnet
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-tight mb-6"
            style={{ color: "#ede9fe", maxWidth: "760px" }}>
            Trade{" "}
            <span style={{ background: "linear-gradient(135deg,#9945ff,#43b4ca)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Funding Rates
            </span>
            {" "}on Solana
          </h1>

          <p className="text-base sm:text-lg mb-10" style={{ color: "#6b6890", maxWidth: "540px" }}>
            Fundex is a fully on-chain funding rate swap market. Go long or short on perpetual funding rates — hedge your perp book or speculate on rate direction.
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-3">
            <Link href="/trade"
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl font-bold text-sm w-full sm:w-auto justify-center"
              style={{ background: "linear-gradient(135deg,#9945ff,#7b61ff)", color: "#fff", boxShadow: "0 4px 24px rgba(153,69,255,0.35)" }}>
              Launch App <ArrowRight size={15} />
            </Link>
            <Link href="/markets"
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl font-bold text-sm w-full sm:w-auto justify-center"
              style={{ background: "rgba(255,255,255,0.04)", color: "#8b87a8", border: "1px solid rgba(255,255,255,0.07)" }}>
              View Markets
            </Link>
          </div>
        </div>
      </section>

      {/* ── Stats ── */}
      <Section>
        <LiveStats />
      </Section>

      {/* ── Live Markets ── */}
      <Section>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold" style={{ color: "#ede9fe" }}>Live Markets</h2>
          <Link href="/markets" className="text-xs font-medium flex items-center gap-1 transition-opacity hover:opacity-70" style={{ color: "#9945ff" }}>
            View all <ArrowRight size={11} />
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {MARKETS.map((m) => <LiveMarketCard key={m.perpIndex} market={m} />)}
        </div>
      </Section>

      {/* ── How It Works ── */}
      <Section>
        <h2 className="text-xl font-bold mb-8 text-center" style={{ color: "#ede9fe" }}>How It Works</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {HOW_IT_WORKS.map((h) => (
            <div key={h.step} className="p-6 rounded-2xl"
              style={{ background: "#0d0c1a", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="text-3xl font-black mb-3" style={{ color: "rgba(153,69,255,0.25)" }}>{h.step}</div>
              <div className="font-bold text-sm mb-2" style={{ color: "#ede9fe" }}>{h.title}</div>
              <div className="text-sm leading-relaxed" style={{ color: "#6b6890" }}>{h.desc}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Features ── */}
      <Section>
        <h2 className="text-xl font-bold mb-8 text-center" style={{ color: "#ede9fe" }}>Why Fundex</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="p-5 rounded-2xl"
              style={{ background: "#0d0c1a", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-4"
                style={{ background: `${f.color}18`, border: `1px solid ${f.color}30` }}>
                <f.icon size={16} style={{ color: f.color }} />
              </div>
              <div className="font-bold text-sm mb-2" style={{ color: "#ede9fe" }}>{f.title}</div>
              <div className="text-sm leading-relaxed" style={{ color: "#6b6890" }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── CTA ── */}
      <Section className="pb-24">
        <div className="relative rounded-3xl p-10 sm:p-14 text-center overflow-hidden"
          style={{ background: "linear-gradient(135deg,rgba(153,69,255,0.12),rgba(67,180,202,0.08))", border: "1px solid rgba(153,69,255,0.2)" }}>
          <h2 className="text-2xl sm:text-3xl font-black mb-4" style={{ color: "#ede9fe" }}>
            Start Trading Funding Rates
          </h2>
          <p className="text-sm sm:text-base mb-8 mx-auto" style={{ color: "#6b6890", maxWidth: "400px" }}>
            Connect your wallet, get devnet USDC from the faucet, and open your first position in under a minute.
          </p>
          <Link href="/trade"
            className="inline-flex items-center gap-2 px-8 py-3.5 rounded-2xl font-bold text-sm"
            style={{ background: "linear-gradient(135deg,#9945ff,#43b4ca)", color: "#fff", boxShadow: "0 4px 24px rgba(153,69,255,0.4)" }}>
            Launch App <ArrowRight size={15} />
          </Link>
        </div>
      </Section>

      {/* ── Footer ── */}
      <footer style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-lg flex items-center justify-center"
              style={{ background: "linear-gradient(135deg,#9945ff,#43b4ca)" }}>
              <svg width="9" height="9" viewBox="0 0 14 14" fill="none">
                <path d="M7 1L13 10H1L7 1Z" fill="white" fillOpacity="0.9" />
              </svg>
            </div>
            <span className="text-xs font-bold" style={{ color: "#4a4568" }}>fundex</span>
          </div>
          <span className="text-xs" style={{ color: "#2d2b45" }}>Built for Seoulana WarmUp Hackathon 2026</span>
        </div>
      </footer>

    </div>
  );
}
