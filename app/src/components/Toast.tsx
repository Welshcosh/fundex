"use client";

import { useEffect, useState } from "react";
import { CheckCircle, XCircle, Info, X, ExternalLink } from "lucide-react";

export type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  sub?: string;
  txSig?: string;
}

let addToastFn: ((t: Omit<ToastItem, "id">) => void) | null = null;

export function toast(type: ToastType, message: string, sub?: string, txSig?: string) {
  addToastFn?.({ type, message, sub, txSig });
}

const EXPLORER = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    addToastFn = (t) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((p) => [...p, { ...t, id }]);
      setTimeout(() => setToasts((p) => p.filter((x) => x.id !== id)), 5000);
    };
    return () => { addToastFn = null; };
  }, []);

  const cfg = {
    success: { icon: CheckCircle, color: "#2dd4bf", bg: "rgba(45,212,191,0.06)", border: "rgba(45,212,191,0.15)" },
    error:   { icon: XCircle,     color: "#f87171", bg: "rgba(248,113,113,0.06)", border: "rgba(248,113,113,0.15)" },
    info:    { icon: Info,        color: "#c4b5fd", bg: "rgba(196,181,253,0.06)", border: "rgba(196,181,253,0.15)" },
  };

  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2">
      {toasts.map((t) => {
        const { icon: Icon, color, bg, border } = cfg[t.type];
        return (
          <div key={t.id}
            className="flex items-start gap-3 px-4 py-3.5 rounded-2xl"
            style={{ background: "#16142a", border: `1px solid ${border}`, boxShadow: "0 12px 40px rgba(0,0,0,0.6)", minWidth: "280px", maxWidth: "360px" }}>
            <Icon size={15} style={{ color, marginTop: 1, flexShrink: 0 }} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold" style={{ color: "#ede9fe" }}>{t.message}</div>
              {t.sub && <div className="text-xs mt-0.5" style={{ color: "#6b6890" }}>{t.sub}</div>}
              {t.txSig && (
                <a
                  href={EXPLORER(t.txSig)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs mt-1 transition-opacity hover:opacity-80"
                  style={{ color }}>
                  View on Explorer <ExternalLink size={10} />
                </a>
              )}
            </div>
            <button onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))}
              style={{ color: "#4a4568", flexShrink: 0 }}>
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
