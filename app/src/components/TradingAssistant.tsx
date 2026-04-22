"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { MarketInfo, DurationVariant, DURATION_LABELS } from "@/lib/constants";
import { OnchainMarketData } from "@/hooks/useMarketData";

const SUGGESTIONS = [
  "Should I go long or short on funding rates?",
  "What's the current market outlook?",
  "How can I hedge my perp position?",
  "Explain funding rate swaps simply",
];

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 1, 2].map(i => (
        <div key={i} className="w-1.5 h-1.5 rounded-full animate-pulse"
          style={{ background: "#9945ff", animationDelay: `${i * 0.15}s` }} />
      ))}
    </div>
  );
}

interface Props {
  market: MarketInfo;
  duration: DurationVariant;
  onchainData: OnchainMarketData;
}

const ASSISTANT_CLOSED_KEY = "fundex.assistant.closed";

export function TradingAssistant({ market, duration, onchainData }: Props) {
  // SSR renders closed (button). On the client we bump to open on first session
  // visit — the `useEffect` below runs post-hydration so server + first-client
  // render match, no hydration mismatch.
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");

  useEffect(() => {
    if (sessionStorage.getItem(ASSISTANT_CLOSED_KEY) !== "1") {
      setOpen(true);
    }
  }, []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/ai/chat" }),
    []
  );

  const { messages, sendMessage, status, error } = useChat({ transport });

  const loading = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const send = useCallback((text: string) => {
    if (!text.trim() || loading) return;
    const marketContext = onchainData.live ? {
      market: market.symbol,
      duration: duration === 0 ? 7 : duration === 1 ? 30 : duration === 2 ? 90 : 180,
      variableRate: onchainData.variableRate,
      fixedRate: onchainData.fixedRate,
      payerLots: onchainData.payerLots,
      receiverLots: onchainData.receiverLots,
    } : undefined;

    sendMessage({ text: text.trim() }, { body: { marketContext } });
    setInput("");
  }, [loading, sendMessage, market, duration, onchainData]);

  // Floating button when closed
  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); if (typeof window !== "undefined") sessionStorage.removeItem(ASSISTANT_CLOSED_KEY); }}
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg transition-all hover:scale-105"
        style={{
          background: "linear-gradient(135deg, #9945ff, #6b21a8)",
          color: "#fff",
          boxShadow: "0 4px 20px rgba(153,69,255,0.4)",
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span className="text-sm font-semibold">AI Assistant</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col rounded-2xl overflow-hidden shadow-2xl"
      style={{
        width: 380,
        height: 520,
        background: "#0d0c1a",
        border: "1px solid rgba(153,69,255,0.2)",
        boxShadow: "0 8px 40px rgba(0,0,0,0.6), 0 0 60px rgba(153,69,255,0.1)",
      }}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3"
        style={{ background: "linear-gradient(135deg, rgba(153,69,255,0.15), rgba(107,33,168,0.1))", borderBottom: "1px solid rgba(153,69,255,0.15)" }}>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: "#2dd4bf", boxShadow: "0 0 6px #2dd4bf" }} />
          <span className="text-sm font-semibold" style={{ color: "#e2e8f0" }}>AI Trading Assistant</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded font-mono"
            style={{ background: "rgba(153,69,255,0.15)", color: "#c4b5fd", border: "1px solid rgba(153,69,255,0.2)" }}>
            {market.symbol} {DURATION_LABELS[duration]}
          </span>
        </div>
        <button onClick={() => { setOpen(false); if (typeof window !== "undefined") sessionStorage.setItem(ASSISTANT_CLOSED_KEY, "1"); }} className="p-1 rounded transition-colors"
          style={{ color: "#6b7280" }}
          onMouseEnter={e => (e.currentTarget.style.color = "#e2e8f0")}
          onMouseLeave={e => (e.currentTarget.style.color = "#6b7280")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
        style={{ scrollbarWidth: "thin", scrollbarColor: "#2d2b45 transparent" }}>

        {messages.length === 0 && !loading && (
          <div className="space-y-3 pt-2">
            <div className="text-center">
              <div className="text-sm font-semibold mb-1" style={{ color: "#c4b5fd" }}>
                Welcome to Fundex AI
              </div>
              <div className="text-[11px] mb-4" style={{ color: "#4a4568" }}>
                Ask me anything about funding rate swaps, market conditions, or trading strategies.
              </div>
            </div>
            <div className="space-y-2">
              {SUGGESTIONS.map((s, i) => (
                <button key={i} onClick={() => send(s)}
                  className="w-full text-left px-3 py-2 rounded-lg text-[12px] transition-all"
                  style={{
                    background: "rgba(153,69,255,0.06)",
                    color: "#9ca3af",
                    border: "1px solid rgba(153,69,255,0.1)",
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = "rgba(153,69,255,0.12)";
                    e.currentTarget.style.color = "#c4b5fd";
                    e.currentTarget.style.borderColor = "rgba(153,69,255,0.25)";
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = "rgba(153,69,255,0.06)";
                    e.currentTarget.style.color = "#9ca3af";
                    e.currentTarget.style.borderColor = "rgba(153,69,255,0.1)";
                  }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => {
          const text = msg.parts
            .map(p => (p.type === "text" ? p.text : ""))
            .join("");
          if (!text) return null;
          return (
            <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[85%] px-3 py-2 rounded-xl text-[13px] leading-relaxed whitespace-pre-wrap"
                style={msg.role === "user" ? {
                  background: "linear-gradient(135deg, #9945ff, #7c3aed)",
                  color: "#fff",
                  borderBottomRightRadius: 4,
                } : {
                  background: "rgba(255,255,255,0.04)",
                  color: "#d1d5db",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderBottomLeftRadius: 4,
                }}>
                {text}
              </div>
            </div>
          );
        })}

        {status === "submitted" && (
          <div className="flex justify-start">
            <div className="px-3 py-2 rounded-xl"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderBottomLeftRadius: 4 }}>
              <TypingDots />
            </div>
          </div>
        )}

        {error && (
          <div className="flex justify-start">
            <div className="max-w-[85%] px-3 py-2 rounded-xl text-[13px]"
              style={{ background: "rgba(239,68,68,0.08)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.2)", borderBottomLeftRadius: 4 }}>
              Sorry, I&apos;m having trouble connecting. Please try again.
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-3 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "#0a0918" }}>
        <form onSubmit={(e) => { e.preventDefault(); send(input); }}
          className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ask about rates, strategies..."
            disabled={loading}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-gray-600"
            style={{ color: "#e2e8f0" }}
          />
          <button type="submit" disabled={loading || !input.trim()}
            className="p-2 rounded-lg transition-all"
            style={{
              background: input.trim() ? "rgba(153,69,255,0.2)" : "transparent",
              color: input.trim() ? "#c4b5fd" : "#2d2b45",
            }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
