"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { ArrowRight, Shield, Zap, TrendingUp, BarChart2, Lock, RefreshCw, Cpu, CheckCircle2, Code2, ExternalLink } from "lucide-react";
import { MARKETS, DurationVariant } from "@/lib/constants";
import { formatRate, formatRateAnnualized, formatUSD, rateToAprPct } from "@/lib/utils";
import { useMarketData } from "@/hooks/useMarketData";
import type { RateAdvisorOutput } from "@/app/api/ai/rate-advisor/route";

// ─── Shared wrapper ───────────────────────────────────────────────────────────
function Section({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`w-full px-4 sm:px-8 lg:px-12 py-16 ${className}`}>
      <div className="max-w-6xl mx-auto">{children}</div>
    </section>
  );
}

// ─── AI Signal Preview (live hero card) ──────────────────────────────────────
const AI_DEFAULT_MARKET = MARKETS[2];  // SOL (highest activity, best demo)
const AI_DEFAULT_DURATION = DurationVariant.Days30;
const AI_DEFAULT_DUR_DAYS = 30;
const AI_MARKET_LABEL = "SOL-PERP · 30d";
const AI_TRADE_HREF = `/trade?perp=${AI_DEFAULT_MARKET.perpIndex}&dur=${AI_DEFAULT_DURATION}`;

function AISignalPreview() {
  const market = useMarketData(AI_DEFAULT_MARKET, AI_DEFAULT_DURATION);
  const [signal, setSignal] = useState<RateAdvisorOutput | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error" | "done">("idle");
  // Use the live oracle EMA when available, otherwise fall back to the market's
  // baseline rate so the landing card always has *something* sane to feed the
  // advisor. EMA = 0 only happens right after a fresh program deploy before
  // the crank has produced its first sample (~1h gap).
  const oracle = market.variableRate > 0 ? market.variableRate : AI_DEFAULT_MARKET.baseRate;

  useEffect(() => {
    if (oracle <= 0) return;
    let cancelled = false;
    setState("loading");
    (async () => {
      try {
        const r = await fetch("/api/ai/rate-advisor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            market: AI_DEFAULT_MARKET.symbol,
            duration: AI_DEFAULT_DUR_DAYS,
            currentOracleRate: oracle,
          }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as RateAdvisorOutput;
        if (!cancelled) {
          setSignal(data);
          setState("done");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [oracle]);

  const dirColor =
    signal?.direction === "up" ? "#2dd4bf" :
    signal?.direction === "down" ? "#f87171" : "#9ca3af";
  const dirLabel = signal?.direction === "up" ? "UP" : signal?.direction === "down" ? "DOWN" : "NEUTRAL";
  const recommendedSide = signal?.direction === "up" ? "Fixed Payer" : signal?.direction === "down" ? "Fixed Receiver" : "—";
  const oracleApr = rateToAprPct(oracle);
  const recommendedApr = signal ? rateToAprPct(signal.recommendedFixedRate) : null;
  const confColor =
    signal?.confidence === "high" ? "#2dd4bf" :
    signal?.confidence === "medium" ? "#fbbf24" : "#9ca3af";

  return (
    <Link
      href={AI_TRADE_HREF}
      className="block group"
    >
      <div
        className="relative rounded-3xl p-6 sm:p-8 overflow-hidden transition-all"
        style={{
          background: "linear-gradient(135deg, rgba(153,69,255,0.12), rgba(67,180,202,0.06) 50%, #0d0c1a 100%)",
          border: "1px solid rgba(153,69,255,0.25)",
        }}
      >
        {/* decorative accent blob */}
        <div
          className="pointer-events-none absolute"
          style={{
            top: "-40%",
            right: "-10%",
            width: "320px",
            height: "320px",
            background: "radial-gradient(circle, rgba(153,69,255,0.16), transparent 70%)",
          }}
        />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:gap-8 gap-5">
          {/* Left — label + direction */}
          <div className="flex-shrink-0 flex md:flex-col items-center md:items-start gap-4 md:gap-3">
            <div
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest"
              style={{
                background: "rgba(153,69,255,0.18)",
                color: "#c4b5fd",
                border: "1px solid rgba(153,69,255,0.3)",
              }}
            >
              <span aria-label="ML">🧮</span> Today&apos;s AI signal
            </div>
            <div className="flex items-center gap-2">
              {signal ? (
                <>
                  <span
                    className="inline-flex items-center justify-center rounded-xl"
                    style={{
                      width: 48,
                      height: 48,
                      background: `${dirColor}15`,
                      border: `1px solid ${dirColor}35`,
                      color: dirColor,
                      fontSize: 24,
                      fontWeight: 900,
                      letterSpacing: "-1px",
                    }}
                  >
                    {signal.direction === "up" ? "↑" : signal.direction === "down" ? "↓" : "→"}
                  </span>
                  <div className="flex flex-col leading-tight">
                    <span className="text-[22px] font-black tracking-tight" style={{ color: dirColor }}>
                      {dirLabel}
                    </span>
                    <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: confColor }}>
                      {signal.confidence} conf
                    </span>
                  </div>
                </>
              ) : state === "loading" ? (
                <div className="flex items-center gap-2 py-2">
                  <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#9945ff" }} />
                  <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#9945ff", animationDelay: "0.15s" }} />
                  <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#9945ff", animationDelay: "0.30s" }} />
                </div>
              ) : (
                <span className="text-sm font-mono" style={{ color: "#4a4568" }}>
                  {state === "error" ? "Advisor unavailable" : "Warming up…"}
                </span>
              )}
            </div>
          </div>

          {/* Middle — numbers */}
          <div className="flex-1 min-w-0 grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "#6b6890" }}>Market</div>
              <div className="text-sm font-bold" style={{ color: "#ede9fe" }}>{AI_MARKET_LABEL}</div>
              <div className="text-[10px] font-mono mt-0.5" style={{ color: "#4a4568" }}>oracle {oracleApr.toFixed(2)}%</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "#6b6890" }}>Recommend</div>
              <div className="text-sm font-bold" style={{ color: "#c4b5fd" }}>{recommendedSide}</div>
              <div className="text-[10px] font-mono mt-0.5" style={{ color: dirColor }}>
                {recommendedApr !== null ? `${recommendedApr.toFixed(2)}% fixed` : "—"}
              </div>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "#6b6890" }}>
                OOS accuracy
              </div>
              <div className="text-sm font-bold" style={{ color: "#ede9fe" }}>
                {signal ? `${(signal.dirAccuracy * 100).toFixed(1)}%` : "—"}
              </div>
              <div className="text-[10px] font-mono mt-0.5" style={{ color: "#4a4568" }}>purged walk-forward CV</div>
            </div>
          </div>

          {/* Right — CTA */}
          <div className="flex-shrink-0">
            <div
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl font-bold text-xs transition-transform group-hover:translate-x-0.5"
              style={{
                background: "rgba(255,255,255,0.04)",
                color: "#c4b5fd",
                border: "1px solid rgba(153,69,255,0.25)",
              }}
            >
              Open trade <ArrowRight size={13} />
            </div>
          </div>
        </div>

        {/* Reasoning row */}
        {signal?.reasoning && (
          <div
            className="relative z-10 mt-5 pt-4 flex items-start gap-2"
            style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
          >
            <span className="text-[11px] mt-0.5" aria-label="LLM">💬</span>
            <div className="flex flex-col">
              <span className="text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: "#c4b5fd" }}>
                Claude says
              </span>
              <p className="text-[12px] leading-relaxed" style={{ color: "#d1d5db", maxWidth: "800px" }}>
                {signal.reasoning}
              </p>
            </div>
          </div>
        )}
      </div>
    </Link>
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
        <div className="font-mono font-bold text-sm" style={{ color: rate >= 0 ? "#2dd4bf" : "#f87171" }}>{formatRate(rate)}</div>
        <div className="text-xs font-mono mt-0.5" style={{ color: "#4a4568" }}>{formatRateAnnualized(rate)} APR</div>
      </div>
    </Link>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
const REPO = "https://github.com/Welshcosh/fundex";

const HIGHLIGHTS = [
  {
    icon: Zap,
    title: "Sub-200k CU settlement",
    metric: "~8,091 CU",
    color: "#fbbf24",
    desc: "Mean compute units across 32 live crank settlements on devnet — 0.017% of a block, 4% of the default per-tx budget.",
    href: `${REPO}/blob/main/docs/benchmarks/cu-table.md`,
    linkLabel: "CU benchmark",
    external: true,
  },
  {
    icon: Shield,
    title: "On-chain rate verification",
    metric: "0 trusted oracles",
    color: "#9945ff",
    desc: "Drift PerpMarket account verified by program-owner check; last_funding_rate read from a fixed byte offset; clamped to ±50% per hour.",
    href: `${REPO}/blob/main/docs/SECURITY.md`,
    linkLabel: "Threat T1",
    external: true,
  },
  {
    icon: Lock,
    title: "Audit-lite security review",
    metric: "10 threats × file:line",
    color: "#43b4ca",
    desc: "Self-audit covering oracle, settlement DoS, reentrancy, math overflow, MEV, and 5 more — every mitigation cross-referenced to source.",
    href: `${REPO}/blob/main/docs/SECURITY.md`,
    linkLabel: "SECURITY.md",
    external: true,
  },
  {
    icon: BarChart2,
    title: "12-month backtest",
    metric: "180-day funding history",
    color: "#2dd4bf",
    desc: "Binance perp funding for BTC/ETH/SOL — SOL averaging −5% APR (longs actually receive), with a −75% spike visible in the chart.",
    href: "/charts/funding-history.png",
    linkLabel: "View chart",
    external: false,
  },
  {
    icon: Cpu,
    title: "ML rate advisor",
    metric: "76.7% out-of-sample",
    color: "#c4b5fd",
    desc: "Ridge + Logistic + LightGBM ensemble trained on 6 years of funding history. Purged walk-forward CV. 30-day horizon shown.",
    href: "/charts/ml-dir-accuracy.png",
    linkLabel: "Accuracy chart",
    external: false,
  },
  {
    icon: CheckCircle2,
    title: "Honest test coverage",
    metric: "Manual + audit + CU bench",
    color: "#f87171",
    desc: "No green CI suite yet. Coverage matrix maps every instruction to its actual verification level today, plus a roadmap to restore unit tests.",
    href: `${REPO}/blob/main/docs/TESTING.md`,
    linkLabel: "TESTING.md",
    external: true,
  },
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

          <p className="text-base sm:text-lg mb-10" style={{ color: "#6b6890", maxWidth: "620px" }}>
            A Solana-native fixed-for-floating funding rate swap, built as a reference implementation. Drift PerpMarket reads verified on-chain, ~8k CU per settlement, audit-lite review across 10 threat classes.
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-3">
            <Link href="/trade"
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl font-bold text-sm w-full sm:w-auto justify-center"
              style={{ background: "linear-gradient(135deg,#9945ff,#7b61ff)", color: "#fff", boxShadow: "0 4px 24px rgba(153,69,255,0.35)" }}>
              Launch App <ArrowRight size={15} />
            </Link>
            <a href={REPO} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl font-bold text-sm w-full sm:w-auto justify-center"
              style={{ background: "rgba(255,255,255,0.04)", color: "#c4b5fd", border: "1px solid rgba(153,69,255,0.2)" }}>
              <Code2 size={15} /> View on GitHub
            </a>
            <Link href="/markets"
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl font-bold text-sm w-full sm:w-auto justify-center"
              style={{ background: "rgba(255,255,255,0.04)", color: "#8b87a8", border: "1px solid rgba(255,255,255,0.07)" }}>
              View Markets
            </Link>
          </div>
        </div>
      </section>

      {/* ── AI Signal Preview ── */}
      <Section className="!pt-0">
        <AISignalPreview />
      </Section>

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

      {/* ── Engineering Highlights ── */}
      <Section>
        <div className="text-center mb-8">
          <h2 className="text-xl font-bold mb-2" style={{ color: "#ede9fe" }}>Engineering Highlights</h2>
          <p className="text-sm" style={{ color: "#6b6890" }}>Every claim links to the underlying source, benchmark, or audit document.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {HIGHLIGHTS.map((h) => (
            <a key={h.title} href={h.href} target="_blank" rel="noopener noreferrer" className="block group">
              <div className="p-5 rounded-2xl h-full transition-all group-hover:border-opacity-40"
                style={{ background: "#0d0c1a", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="flex items-start justify-between mb-4">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                    style={{ background: `${h.color}18`, border: `1px solid ${h.color}30` }}>
                    <h.icon size={16} style={{ color: h.color }} />
                  </div>
                  <div className="text-xs font-mono font-bold px-2 py-1 rounded-md"
                    style={{ background: `${h.color}10`, color: h.color, border: `1px solid ${h.color}20` }}>
                    {h.metric}
                  </div>
                </div>
                <div className="font-bold text-sm mb-2" style={{ color: "#ede9fe" }}>{h.title}</div>
                <div className="text-sm leading-relaxed mb-4" style={{ color: "#6b6890" }}>{h.desc}</div>
                <div className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: h.color }}>
                  {h.linkLabel} {h.external ? <ExternalLink size={11} /> : <ArrowRight size={11} />}
                </div>
              </div>
            </a>
          ))}
        </div>
      </Section>

      {/* ── Scope & Prior Art ── */}
      <Section>
        <div className="rounded-2xl p-6 sm:p-8"
          style={{ background: "#0d0c1a", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#c4b5fd" }}>
            Scope & Prior Art
          </div>
          <p className="text-sm leading-relaxed mb-3" style={{ color: "#8b87a8" }}>
            Fundex is a <strong style={{ color: "#ede9fe" }}>reference implementation, not a production trading venue</strong>.
            {" "}<a href="https://docs.pendle.finance/Boros" target="_blank" rel="noopener noreferrer" style={{ color: "#c4b5fd", textDecoration: "underline" }}>Pendle Boros</a> (Arbitrum, early 2025) is the existing production funding rate swap in this category. Fundex makes different architectural choices from the Solana-native angle: on-chain Drift rate verification, per-market isolated vaults, and AMM-style dynamic LP fees.
          </p>
          <p className="text-sm leading-relaxed" style={{ color: "#8b87a8" }}>
            Not audited. Not stress-tested with real LP capital. 12 months of backtest data show SOL-PERP funding averaging −5% APR (longs receive funding) and BTC at +5% — far below the threshold where most traders would pay to hedge. Submitted as a technical reference for the IRS primitive; product-market fit is an open question this project does not try to answer.
          </p>
        </div>
      </Section>

      {/* ── CTA ── */}
      <Section className="pb-24">
        <div className="relative rounded-3xl p-10 sm:p-14 text-center overflow-hidden"
          style={{ background: "linear-gradient(135deg,rgba(153,69,255,0.12),rgba(67,180,202,0.08))", border: "1px solid rgba(153,69,255,0.2)" }}>
          <h2 className="text-2xl sm:text-3xl font-black mb-4" style={{ color: "#ede9fe" }}>
            Try It on Devnet
          </h2>
          <p className="text-sm sm:text-base mb-8 mx-auto" style={{ color: "#6b6890", maxWidth: "440px" }}>
            Connect your wallet, mint devnet USDC from the faucet, and open a Fixed Payer or Fixed Receiver position in under a minute. No real funds at risk.
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
        <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-lg flex items-center justify-center"
              style={{ background: "linear-gradient(135deg,#9945ff,#43b4ca)" }}>
              <svg width="9" height="9" viewBox="0 0 14 14" fill="none">
                <path d="M7 1L13 10H1L7 1Z" fill="white" fillOpacity="0.9" />
              </svg>
            </div>
            <span className="text-xs font-bold" style={{ color: "#4a4568" }}>fundex</span>
          </div>
          <div className="flex items-center gap-4 text-xs" style={{ color: "#4a4568" }}>
            <a href={REPO} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:opacity-70 transition-opacity">
              <Code2 size={11} /> GitHub
            </a>
            <a href={`${REPO}/blob/main/README.md`} target="_blank" rel="noopener noreferrer" className="hover:opacity-70 transition-opacity">README</a>
            <a href={`${REPO}/blob/main/docs/SECURITY.md`} target="_blank" rel="noopener noreferrer" className="hover:opacity-70 transition-opacity">Security</a>
            <a href={`${REPO}/blob/main/docs/TESTING.md`} target="_blank" rel="noopener noreferrer" className="hover:opacity-70 transition-opacity">Testing</a>
          </div>
          <span className="text-xs text-center sm:text-right" style={{ color: "#2d2b45" }}>Seoulana WarmUp 2026 · Colosseum DeFi & Payments</span>
        </div>
      </footer>

    </div>
  );
}
