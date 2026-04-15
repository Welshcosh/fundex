"""Perp funding rate history — last 180 days, raw 8-hour samples.

Data: Binance USDT-M fundingRate endpoint for BTC/ETH/SOL perps.
Each venue (Binance, Drift, etc.) settles every 8 hours — Fundex settles
every hour, which gives traders 8× the granularity at entry and exit.

One stacked panel per market so individual volatility and extreme
events aren't squashed by a shared y-scale.
"""

import os
import time
import requests
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from datetime import datetime, timedelta, timezone

OUT_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "app", "public", "charts", "funding-history.png"
)

SYMBOLS = [
    ("BTC-PERP", "BTCUSDT", "#f59e0b"),
    ("ETH-PERP", "ETHUSDT", "#6366f1"),
    ("SOL-PERP", "SOLUSDT", "#22c55e"),
]
DAYS = 180
START_MS = int((datetime.now(timezone.utc) - timedelta(days=DAYS)).timestamp() * 1000)


def fetch(symbol: str):
    url = "https://fapi.binance.com/fapi/v1/fundingRate"
    all_rows = []
    start = START_MS
    while True:
        r = requests.get(
            url,
            params={"symbol": symbol, "startTime": start, "limit": 1000},
            timeout=30,
        )
        r.raise_for_status()
        batch = r.json()
        if not batch:
            break
        all_rows.extend(batch)
        if len(batch) < 1000:
            break
        start = int(batch[-1]["fundingTime"]) + 1
        time.sleep(0.15)
    ts  = np.array([datetime.fromtimestamp(int(r["fundingTime"]) / 1000, tz=timezone.utc) for r in all_rows])
    apr = np.array([float(r["fundingRate"]) * (8760 / 8) * 100 for r in all_rows])  # per-8h → APR %
    return ts, apr


fig, axes = plt.subplots(3, 1, figsize=(10, 7.8), dpi=140, sharex=True)

for (label, symbol, color), ax in zip(SYMBOLS, axes):
    ts, apr = fetch(symbol)
    ax.plot(ts, apr, color=color, lw=1.0, alpha=0.9)
    ax.fill_between(ts, 0, apr,
                    where=apr >= 0, color=color, alpha=0.12, interpolate=True)
    ax.fill_between(ts, 0, apr,
                    where=apr < 0, color="#ef4444", alpha=0.12, interpolate=True)
    ax.axhline(0, color="#6b7280", lw=0.8, alpha=0.7)

    # Annotate the most extreme point (max |apr|)
    idx = int(np.argmax(np.abs(apr)))
    ext_val = apr[idx]
    sign = "+" if ext_val >= 0 else ""
    ax.annotate(
        f"{sign}{ext_val:.0f}% APR",
        xy=(ts[idx], ext_val),
        xytext=(10, -14 if ext_val >= 0 else 14),
        textcoords="offset points",
        fontsize=8.5,
        color="#475569",
        arrowprops=dict(arrowstyle="->", color="#94a3b8", lw=0.8),
    )

    mean, mn, mx = apr.mean(), apr.min(), apr.max()
    stat = f"mean {mean:+.1f}%   min {mn:+.0f}%   max {mx:+.0f}%"
    ax.text(0.01, 0.94, label, transform=ax.transAxes,
            fontsize=10, fontweight="bold", color=color, va="top")
    ax.text(0.99, 0.94, stat, transform=ax.transAxes,
            fontsize=8.5, color="#6b7280", va="top", ha="right")

    ax.grid(True, alpha=0.25, linestyle="--")
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    ax.set_ylabel("APR %", fontsize=9)
    print(f"{label}: {len(ts)} samples  mean={mean:+.2f}%  min={mn:+.2f}%  max={mx:+.2f}%")

axes[0].set_title(
    f"Perp funding volatility — last {DAYS} days, raw 8-hour samples",
    fontsize=12, pad=12, loc="left",
)
axes[-1].xaxis.set_major_locator(mdates.MonthLocator())
axes[-1].xaxis.set_major_formatter(mdates.DateFormatter("%b"))
axes[-1].tick_params(axis="x", labelsize=9)

footer = (
    "Source: Binance USDT-M fapi/v1/fundingRate  |  "
    "Every venue on this chart settles every 8 hours.  "
    "Fundex settles every hour — 8× the granularity at entry and exit."
)
fig.text(0.5, 0.015, footer, ha="center", fontsize=8, color="#6b7280")

fig.tight_layout(rect=[0, 0.03, 1, 1])
os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
fig.savefig(OUT_PATH, bbox_inches="tight")
print(f"wrote {OUT_PATH}")
