"""Ensemble directional accuracy across horizons.

Reads app/src/lib/fundex/rate-model.json, which stores both the tuned
ensemble accuracy (ensemble_dir_acc) and the untuned Ridge+Logistic
baseline (ensemble_dir_acc_v1) for each horizon.

Training window: Binance perpetual funding history 2019-09-10 → 2026-04-15
(BTC 2410 / ETH 2332 / SOL 2041 daily points). Evaluated on held-out
purged walk-forward folds — numbers are out-of-sample, not train-fit.
"""

import json
import os
import numpy as np
import matplotlib.pyplot as plt

MODEL_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "app", "src", "lib", "fundex", "rate-model.json"
)
OUT_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "app", "public", "charts", "ml-dir-accuracy.png"
)

with open(MODEL_PATH) as f:
    model = json.load(f)

durations = [7, 30, 90, 180]
v1 = [model["models"][str(d)]["ensemble_dir_acc_v1"] for d in durations]
v2 = [model["models"][str(d)]["ensemble_dir_acc"] for d in durations]

fig, ax = plt.subplots(figsize=(9, 5.2), dpi=140)

x = np.arange(len(durations))
width = 0.36

bars_v1 = ax.bar(x - width/2, v1, width,
                 label="Ridge + Logistic (baseline)",
                 color="#94a3b8", edgecolor="#475569", lw=0.6)
bars_v2 = ax.bar(x + width/2, v2, width,
                 label="Full ensemble + LightGBM (tuned)",
                 color="#6366f1", edgecolor="#4338ca", lw=0.6)

for bar, val in zip(bars_v1, v1):
    ax.text(bar.get_x() + bar.get_width()/2, val + 0.008,
            f"{val*100:.1f}%", ha="center", va="bottom",
            fontsize=9, color="#475569")
for bar, val in zip(bars_v2, v2):
    ax.text(bar.get_x() + bar.get_width()/2, val + 0.008,
            f"{val*100:.1f}%", ha="center", va="bottom",
            fontsize=9, color="#4338ca", fontweight="bold")

ax.axhline(0.5, ls="--", color="#ef4444", lw=1.2, alpha=0.8,
           label="Coin-flip baseline (50%)")

ax.set_xticks(x)
ax.set_xticklabels([f"{d}-day" for d in durations], fontsize=10)
ax.set_ylabel("Out-of-sample directional accuracy", fontsize=11)
ax.set_ylim(0.40, 0.85)
ax.set_yticks(np.arange(0.40, 0.86, 0.05))
ax.set_yticklabels([f"{int(v*100)}%" for v in np.arange(0.40, 0.86, 0.05)])
ax.set_title("Rate Advisor ensemble: direction accuracy by horizon",
             fontsize=12, pad=14, loc="left")

ax.grid(True, axis="y", alpha=0.25, linestyle="--")
for spine in ("top", "right"):
    ax.spines[spine].set_visible(False)

ax.legend(loc="upper right", framealpha=0.95, fontsize=9)

# Footer note: data window + method
footer = (
    "Binance BTC/ETH/SOL perp funding, 2019-09 → 2026-04  |  "
    "Purged walk-forward CV, 70/30 train/test split  |  "
    "Ensemble threshold = 0.70 (neutral below)"
)
fig.text(0.5, 0.015, footer, ha="center", fontsize=8, color="#6b7280")

fig.tight_layout(rect=[0, 0.03, 1, 1])
os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
fig.savefig(OUT_PATH, bbox_inches="tight")
print(f"wrote {OUT_PATH}")
print(f"v1: {[f'{v*100:.1f}%' for v in v1]}")
print(f"v2: {[f'{v*100:.1f}%' for v in v2]}")
