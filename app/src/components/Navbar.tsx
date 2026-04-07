"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useCallback, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Droplets, Menu, X } from "lucide-react";
import { toast } from "./Toast";
import { formatAddress } from "@/lib/utils";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false }
);

const NAV = [
  { label: "Trade", href: "/trade" },
  { label: "Pool", href: "/pool" },
  { label: "Markets", href: "/markets" },
  { label: "Portfolio", href: "/portfolio" },
];

export function Navbar() {
  const path = usePathname();
  const { publicKey } = useWallet();
  const [minting, setMinting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Close menu on route change
  useEffect(() => { setMenuOpen(false); }, [path]);
  // Close menu on outside scroll/resize
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, [menuOpen]);

  const handleFaucet = useCallback(async () => {
    if (!publicKey || minting) return;
    setMinting(true);
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: publicKey.toString() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Faucet failed");
      toast("success", "1000 USDC sent!", undefined, json.sig);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast("error", "Faucet error", msg.slice(0, 80));
    } finally {
      setMinting(false);
    }
  }, [publicKey, minting]);

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 h-14 flex items-center px-4 sm:px-6"
        style={{ background: "rgba(13,12,26,0.92)", backdropFilter: "blur(16px)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="flex items-center justify-between w-full max-w-[1600px] mx-auto">

          {/* Logo */}
          <div className="flex items-center gap-4 md:gap-6">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-xl flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, #9945ff, #43b4ca)" }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 1L13 10H1L7 1Z" fill="white" fillOpacity="0.9" />
                </svg>
              </div>
              <span className="font-bold text-sm" style={{ color: "#ede9fe" }}>fundex</span>
            </Link>

            {/* Desktop nav */}
            <nav className="hidden sm:flex items-center gap-1">
              {NAV.map(({ label, href }) => {
                const active = path === href;
                return (
                  <Link key={href} href={href}
                    className="px-3.5 py-1.5 rounded-xl text-sm font-medium transition-all"
                    style={{
                      color: active ? "#ede9fe" : "#6b6890",
                      background: active ? "rgba(153,69,255,0.12)" : "transparent",
                    }}>
                    {label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-2 md:gap-3">
            <span className="hidden md:inline text-xs px-2.5 py-1 rounded-full font-medium"
              style={{ background: "rgba(255,255,255,0.05)", color: "#6b6890" }}>
              devnet
            </span>
            {publicKey && (
              <button
                onClick={handleFaucet}
                disabled={minting}
                className="hidden sm:flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl transition-colors"
                style={{
                  background: minting ? "rgba(153,69,255,0.05)" : "rgba(153,69,255,0.12)",
                  color: minting ? "#4a4568" : "#c4b5fd",
                  border: "1px solid rgba(153,69,255,0.2)",
                  cursor: minting ? "not-allowed" : "pointer",
                }}>
                {minting
                  ? <span className="w-3 h-3 border border-white/20 border-t-white/50 rounded-full animate-spin" />
                  : <Droplets size={11} />}
                Faucet
              </button>
            )}

            {/* Desktop wallet */}
            <div className="hidden sm:block">
              <WalletMultiButton />
            </div>

            {/* Mobile hamburger */}
            <button
              className="sm:hidden flex items-center justify-center w-9 h-9 rounded-xl transition-colors"
              style={{ background: menuOpen ? "rgba(153,69,255,0.15)" : "rgba(255,255,255,0.05)" }}
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Menu">
              {menuOpen ? <X size={18} style={{ color: "#c4b5fd" }} /> : <Menu size={18} style={{ color: "#8b87a8" }} />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile drawer overlay */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 sm:hidden" onClick={() => setMenuOpen(false)}
          style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} />
      )}

      {/* Mobile drawer */}
      <div className="fixed top-14 right-0 bottom-0 z-40 w-72 sm:hidden flex flex-col transition-transform duration-200"
        style={{
          background: "#0d0c1a",
          borderLeft: "1px solid rgba(255,255,255,0.06)",
          transform: menuOpen ? "translateX(0)" : "translateX(100%)",
        }}>

        {/* Wallet info */}
        <div className="px-5 py-5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          {publicKey ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ background: "#2dd4bf" }} />
                <span className="text-xs font-mono" style={{ color: "#8b87a8" }}>
                  {formatAddress(publicKey.toString())}
                </span>
              </div>
              <WalletMultiButton />
              <button
                onClick={() => { handleFaucet(); setMenuOpen(false); }}
                disabled={minting}
                className="flex items-center justify-center gap-2 text-xs font-semibold px-3 py-2.5 rounded-xl w-full transition-colors"
                style={{
                  background: minting ? "rgba(153,69,255,0.05)" : "rgba(153,69,255,0.1)",
                  color: minting ? "#4a4568" : "#c4b5fd",
                  border: "1px solid rgba(153,69,255,0.2)",
                }}>
                {minting
                  ? <span className="w-3 h-3 border border-white/20 border-t-white/50 rounded-full animate-spin" />
                  : <Droplets size={12} />}
                Get Test USDC (Faucet)
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="text-xs" style={{ color: "#4a4568" }}>Connect wallet to start trading</div>
              <WalletMultiButton />
            </div>
          )}
        </div>

        {/* Nav links */}
        <nav className="flex flex-col px-3 py-4 gap-1">
          {NAV.map(({ label, href }) => {
            const active = path === href;
            return (
              <Link key={href} href={href}
                className="flex items-center px-4 py-3 rounded-xl text-sm font-medium transition-all"
                style={{
                  color: active ? "#ede9fe" : "#6b6890",
                  background: active ? "rgba(153,69,255,0.12)" : "transparent",
                }}>
                {label}
                {active && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full" style={{ background: "#9945ff" }} />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Bottom devnet badge */}
        <div className="mt-auto px-5 py-4" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          <span className="text-xs px-2.5 py-1 rounded-full font-medium"
            style={{ background: "rgba(255,255,255,0.05)", color: "#4a4568" }}>
            devnet
          </span>
        </div>
      </div>
    </>
  );
}
