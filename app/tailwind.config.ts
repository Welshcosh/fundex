import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: "#08090e",
          secondary: "#0d0f18",
          tertiary: "#12151f",
          card: "#0f1117",
          hover: "#161927",
        },
        border: {
          primary: "#1e2231",
          accent: "#2a3050",
        },
        accent: {
          cyan: "#00d4ff",
          purple: "#7c3aed",
          blue: "#3b82f6",
        },
        text: {
          primary: "#e2e8f0",
          secondary: "#94a3b8",
          muted: "#475569",
        },
        green: {
          400: "#4ade80",
          500: "#22c55e",
          glow: "#22c55e40",
        },
        red: {
          400: "#f87171",
          500: "#ef4444",
          glow: "#ef444440",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      backgroundImage: {
        "grid-pattern":
          "linear-gradient(rgba(30,34,49,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(30,34,49,0.5) 1px, transparent 1px)",
        "cyan-glow":
          "radial-gradient(ellipse at top, rgba(0,212,255,0.08) 0%, transparent 60%)",
        "purple-glow":
          "radial-gradient(ellipse at bottom right, rgba(124,58,237,0.08) 0%, transparent 60%)",
      },
      backgroundSize: {
        grid: "40px 40px",
      },
      boxShadow: {
        "cyan-glow": "0 0 20px rgba(0, 212, 255, 0.15)",
        "green-glow": "0 0 20px rgba(34, 197, 94, 0.2)",
        "red-glow": "0 0 20px rgba(239, 68, 68, 0.2)",
        "card": "0 4px 24px rgba(0, 0, 0, 0.4)",
        "inner-border": "inset 0 1px 0 rgba(255,255,255,0.04)",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "float": "float 6s ease-in-out infinite",
        "scan": "scan 2s linear infinite",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        scan: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
