"""Fundex dynamic LP fee curve.

Constants mirror programs/fundex/src/constants.rs:
  LP_FEE_BPS            = 30   (0.30% base)
  MAX_IMBALANCE_FEE_BPS = 70   (0.70% max premium → 1.00% cap)

Logic mirrors programs/fundex/src/instructions/open_position.rs:
  If a trade increases |payer - receiver| → fee = base + premium × imbalance_ratio
  If a trade decreases it                 → fee = 0
"""

import os
import numpy as np
import matplotlib.pyplot as plt

LP_FEE_BPS = 30
MAX_IMBALANCE_FEE_BPS = 70

OUT_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "app", "public", "charts", "amm-fee-curve.png"
)

imbalance_pct = np.linspace(0, 100, 501)
fee_increase = LP_FEE_BPS + MAX_IMBALANCE_FEE_BPS * (imbalance_pct / 100.0)
fee_decrease = np.zeros_like(imbalance_pct)

fig, ax = plt.subplots(figsize=(9, 5.2), dpi=140)

ax.plot(imbalance_pct, fee_increase, color="#ef4444", lw=2.4,
        label="Imbalance-increasing trade")
ax.plot(imbalance_pct, fee_decrease, color="#22c55e", lw=2.4,
        label="Imbalance-decreasing trade (free)")

ax.fill_between(imbalance_pct, fee_decrease, fee_increase,
                color="#f59e0b", alpha=0.12, label="Rebalancing incentive zone")

# Reference lines for comparable DeFi venues
refs = [
    ("Uniswap v3 (0.05%)", 5, "#6b7280"),
    ("Drift taker (~10 bps)", 10, "#6b7280"),
    ("GMX open (~10 bps)", 10, "#6b7280"),
]
seen = set()
for name, bps, color in refs:
    if bps in seen:
        continue
    seen.add(bps)
    ax.axhline(bps, ls=":", lw=1, color=color, alpha=0.7)

ax.annotate("Uniswap v3 / Drift / GMX ≈ 5–10 bps",
            xy=(2, 10), xytext=(15, 22),
            fontsize=9, color="#6b7280",
            arrowprops=dict(arrowstyle="-", color="#6b7280", lw=0.8))

ax.annotate(f"base {LP_FEE_BPS} bps",
            xy=(0, LP_FEE_BPS), xytext=(4, 38),
            fontsize=9, color="#ef4444")
ax.annotate(f"cap {LP_FEE_BPS + MAX_IMBALANCE_FEE_BPS} bps",
            xy=(100, LP_FEE_BPS + MAX_IMBALANCE_FEE_BPS),
            xytext=(75, 108),
            fontsize=9, color="#ef4444",
            ha="right")

ax.set_xlabel("Market imbalance  |payer − receiver| / total  (%)", fontsize=11)
ax.set_ylabel("LP fee (bps)", fontsize=11)
ax.set_title("Fundex dynamic LP fee — rewards rebalancing, penalizes further skew",
             fontsize=12, pad=14, loc="left")

ax.set_xlim(0, 100)
ax.set_ylim(-6, 115)
ax.grid(True, alpha=0.25, linestyle="--")
ax.legend(loc="upper left", framealpha=0.95, fontsize=9)

for spine in ("top", "right"):
    ax.spines[spine].set_visible(False)

fig.tight_layout()
os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
fig.savefig(OUT_PATH, bbox_inches="tight")
print(f"wrote {OUT_PATH}")
