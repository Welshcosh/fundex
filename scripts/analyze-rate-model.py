#!/usr/bin/env python3
"""
analyze-rate-model.py  —  Phase 1 measurement infrastructure.

Re-runs the same purged walk-forward CV as train-rate-model-v2.py, but reports
metrics that defend the headline dir-accuracy number:

  • Coverage  — fraction of windows where the ensemble commits to a call
                (classifier conf >= threshold AND Ridge direction agrees).
  • Unfiltered directional accuracy — raw sign-match before any filter.
  • Confusion matrix (both filtered + unfiltered).
  • Regime-sliced accuracy — bull vs bear vs chop, via BTC 30d return sign.
  • Calibration plot — reliability of predicted probabilities.

No model is re-trained for production. rate-model.json is not touched.

Outputs:
  docs/benchmarks/rate-model-analysis.md
  app/public/charts/model-calibration.png
  app/public/charts/model-coverage.png
"""

import json
import os
import pickle
import time
import datetime
import warnings
from pathlib import Path

import numpy as np
import requests
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.linear_model import Ridge, LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import confusion_matrix
import lightgbm as lgb

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / "data" / "binance-cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
REPORT_DIR = ROOT / "docs" / "benchmarks"
REPORT_DIR.mkdir(parents=True, exist_ok=True)
CHART_DIR = ROOT / "app" / "public" / "charts"
CHART_DIR.mkdir(parents=True, exist_ok=True)

SYMBOLS = {"BTC": "BTCUSDT", "ETH": "ETHUSDT", "SOL": "SOLUSDT"}
DURATIONS = [7, 30, 90, 180]
THRESHOLDS = [0.55, 0.60, 0.65, 0.70]  # mirror train script
HALF_LIFE_DEFAULT = 180
CACHE_TTL_SEC = 24 * 3600  # refetch if older than 1 day


# ── Cached Binance fetches ───────────────────────────────────────────────────

def _cache_ok(path: Path) -> bool:
    return path.exists() and (time.time() - path.stat().st_mtime) < CACHE_TTL_SEC


def fetch_binance_funding(symbol: str) -> dict:
    cache = CACHE_DIR / f"funding_{symbol}.pkl"
    if _cache_ok(cache):
        with open(cache, "rb") as f:
            return pickle.load(f)

    url = "https://fapi.binance.com/fapi/v1/fundingRate"
    all_records = []
    start_time = 1568102400000
    while True:
        params = {"symbol": symbol, "startTime": start_time, "limit": 1000}
        r = requests.get(url, params=params, timeout=30)
        r.raise_for_status()
        batch = r.json()
        if not batch:
            break
        all_records.extend(batch)
        if len(batch) < 1000:
            break
        start_time = int(batch[-1]["fundingTime"]) + 1
        time.sleep(0.15)

    daily = {}
    for rec in all_records:
        ts = int(rec["fundingTime"]) // 1000
        day = (ts // 86400) * 86400
        daily.setdefault(day, []).append(float(rec["fundingRate"]))
    out = {day: float(np.mean(rates)) for day, rates in daily.items()}
    with open(cache, "wb") as f:
        pickle.dump(out, f)
    return out


def fetch_btc_price() -> dict:
    cache = CACHE_DIR / "btc_price.pkl"
    if _cache_ok(cache):
        with open(cache, "rb") as f:
            return pickle.load(f)

    url = "https://api.binance.com/api/v3/klines"
    params = {"symbol": "BTCUSDT", "interval": "1d", "limit": 1000}
    r = requests.get(url, params=params, timeout=30)
    r.raise_for_status()
    out = {}
    for k in r.json():
        ts = int(k[0]) // 1000
        day = (ts // 86400) * 86400
        out[day] = float(k[4])
    with open(cache, "wb") as f:
        pickle.dump(out, f)
    return out


def fetch_fear_greed() -> dict:
    cache = CACHE_DIR / "fng.pkl"
    if _cache_ok(cache):
        with open(cache, "rb") as f:
            return pickle.load(f)

    r = requests.get("https://api.alternative.me/fng/?limit=2000", timeout=30)
    r.raise_for_status()
    out = {}
    for d in r.json()["data"]:
        ts = int(d["timestamp"])
        day = (ts // 86400) * 86400
        out[day] = float(d["value"])
    with open(cache, "wb") as f:
        pickle.dump(out, f)
    return out


# ── Feature engineering (mirror of train-rate-model-v2.py) ──────────────────

def make_series(daily_rates):
    items = sorted(daily_rates.items())
    return np.array([i[0] for i in items]), np.array([i[1] for i in items])


def align_series(rate_ts, rates, btc_ts, btc_rates, price_dict, fng_dict):
    btc_map = dict(zip(btc_ts, btc_rates))
    prices_a = np.array([price_dict.get(ts, np.nan) for ts in rate_ts])
    fng_a = np.array([fng_dict.get(ts, np.nan) for ts in rate_ts])
    btc_a = np.array([btc_map.get(ts, np.nan) for ts in rate_ts])
    for arr in [btc_a, prices_a, fng_a]:
        for j in range(1, len(arr)):
            if not np.isfinite(arr[j]):
                arr[j] = arr[j - 1]
    return rates, btc_a, prices_a, fng_a


def build_features(rates, btc_r, prices, fng, i, market, market_list):
    if i < 30:
        return None
    cur = rates[i]
    if cur == 0 or not np.isfinite(cur):
        return None
    w7 = rates[max(0, i - 7):i]
    w30 = rates[max(0, i - 30):i]
    ma7 = np.mean(w7); std7 = np.std(w7) + 1e-9
    ma30 = np.mean(w30); std30 = np.std(w30) + 1e-9
    z7 = (cur - ma7) / std7
    z30 = (cur - ma30) / std30
    mom5 = (cur - rates[max(0, i - 5)]) / (rates[max(0, i - 5)] + 1e-9)
    mom14 = (cur - rates[max(0, i - 14)]) / (rates[max(0, i - 14)] + 1e-9)
    lag1 = (cur - rates[i - 1]) / (cur + 1e-9)
    lag3 = (cur - rates[max(0, i - 3)]) / (cur + 1e-9)
    lag7 = (cur - rates[max(0, i - 7)]) / (cur + 1e-9)
    vol_ratio = std7 / std30
    trend = (ma7 - ma30) / (ma30 + 1e-9)
    d1 = cur - rates[i - 1]
    d2 = rates[i - 1] - rates[max(0, i - 2)]
    accel = (d1 - d2) / (abs(cur) + 1e-9)
    log_cur = np.log(abs(cur) + 1e-6) * np.sign(cur)
    btc_cur = btc_r[i]
    btc_ma7 = np.mean(btc_r[max(0, i - 7):i])
    btc_ma30 = np.mean(btc_r[max(0, i - 30):i])
    btc_std30 = np.std(btc_r[max(0, i - 30):i]) + 1e-9
    btc_mom1 = (btc_cur - btc_r[i - 1]) / (abs(btc_r[i - 1]) + 1e-9)
    btc_mom7 = (btc_cur - btc_r[max(0, i - 7)]) / (abs(btc_r[max(0, i - 7)]) + 1e-9)
    btc_z30 = (btc_cur - btc_ma30) / btc_std30
    if len(prices) > i and prices[i] > 0 and prices[max(0, i - 7)] > 0:
        price_ret7 = (prices[i] - prices[max(0, i - 7)]) / prices[max(0, i - 7)]
        price_ret30 = (prices[i] - prices[max(0, i - 30)]) / (prices[max(0, i - 30)] + 1e-9)
        price_vol30 = np.std(prices[max(0, i - 30):i]) / (np.mean(prices[max(0, i - 30):i]) + 1e-9)
    else:
        price_ret7 = price_ret30 = price_vol30 = 0.0
    fng_cur = fng[i] if np.isfinite(fng[i]) else 50.0
    fng_ma7 = np.nanmean(fng[max(0, i - 7):i]) if i > 0 else 50.0
    fng_trend = (fng_cur - fng_ma7) / 100.0
    fng_norm = (fng_cur - 50) / 50.0
    base = [
        log_cur, z7, z30, mom5, mom14,
        vol_ratio, trend, lag1, lag3, lag7,
        std7 / (abs(cur) + 1e-9), std30 / (abs(cur) + 1e-9), accel,
        btc_mom1, btc_mom7, btc_z30,
        price_ret7, price_ret30, price_vol30,
        fng_norm, fng_trend,
    ]
    ohe = [1 if m == market else 0 for m in market_list]
    feat = base + ohe
    return feat if all(np.isfinite(feat)) else None


def log_ratio_target(rates, i, duration):
    future = rates[i:i + duration]
    if len(future) < duration:
        return None
    cur = rates[i]
    avg = np.mean(future)
    if cur <= 0 or avg <= 0:
        return None
    return float(np.log(avg / cur))


def exponential_weights(n: int, half_life: int = 180) -> np.ndarray:
    decay = np.log(2) / half_life
    w = np.exp(decay * np.arange(n, dtype=float))
    return w / w.mean()


def purged_walk_forward(n: int, n_splits: int = 5, purge_gap: int = 0, train_ratio: float = 0.7):
    step = (n - int(n * train_ratio)) // n_splits
    splits = []
    for i in range(n_splits):
        test_end = n - (n_splits - 1 - i) * step
        test_start = test_end - step
        train_end = test_start - purge_gap
        if train_end < int(n * 0.2):
            continue
        splits.append((np.arange(0, train_end), np.arange(test_start, test_end)))
    return splits


# ── Regime labeler ──────────────────────────────────────────────────────────
# Bull / bear / chop based on BTC 30d price return at sample index.
#   bull:  price_ret30 > +10%
#   bear:  price_ret30 < -10%
#   chop:  otherwise

def regime_label(price_ret30: float) -> str:
    if price_ret30 > 0.10:
        return "bull"
    if price_ret30 < -0.10:
        return "bear"
    return "chop"


# ── Analysis core ────────────────────────────────────────────────────────────

def analyze_duration(duration: int, X, y_reg, y_cls, price_ret30_arr, market_arr, rate_model_cfg):
    """Run the same CV as training; collect rich per-sample predictions for analysis."""
    n = len(X)
    sc = StandardScaler()
    X_sc = sc.fit_transform(X)

    # Pull the trained-model's selected threshold and half-life to mirror production.
    thr = rate_model_cfg.get("threshold", 0.65)
    half_life = rate_model_cfg.get("half_life", 180)

    purge_gap = max(duration // 2, 5)
    splits = purged_walk_forward(n, n_splits=5, purge_gap=purge_gap, train_ratio=0.7)

    # Per-sample predictions (only from test folds)
    all_idx = []
    all_p_avg = []
    all_p_ridge_dir = []  # +1 if ridge says up
    all_y_cls = []
    all_y_reg = []

    for tr, te in splits:
        sw_tr = exponential_weights(len(tr), half_life=half_life)
        r_cv = Ridge(alpha=1.0).fit(X_sc[tr], y_reg[tr], sample_weight=sw_tr)
        l_cv = LogisticRegression(C=0.3, max_iter=1000).fit(X_sc[tr], y_cls[tr], sample_weight=sw_tr)
        g_cv = lgb.LGBMClassifier(
            n_estimators=500, max_depth=5, learning_rate=0.03,
            num_leaves=31, subsample=0.8, colsample_bytree=0.8,
            reg_alpha=0.1, reg_lambda=0.1, random_state=42, verbose=-1,
        ).fit(X[tr], y_cls[tr], sample_weight=sw_tr)

        p_r = r_cv.predict(X_sc[te])
        p_l = l_cv.predict_proba(X_sc[te])[:, 1]
        p_g = g_cv.predict_proba(X[te])[:, 1]
        p_avg = (p_l + p_g) / 2

        all_idx.extend(te.tolist())
        all_p_avg.extend(p_avg.tolist())
        all_p_ridge_dir.extend(((p_r > 0).astype(int) * 2 - 1).tolist())  # +1 up / -1 down
        all_y_cls.extend(y_cls[te].tolist())
        all_y_reg.extend(y_reg[te].tolist())

    p_avg = np.array(all_p_avg)
    p_ridge_dir = np.array(all_p_ridge_dir)
    y_true = np.array(all_y_cls)
    idx = np.array(all_idx)
    price_ret30_test = price_ret30_arr[idx]

    conf = np.maximum(p_avg, 1 - p_avg)
    cls_pred_up = (p_avg >= 0.5).astype(int)
    ridge_up = (p_ridge_dir > 0).astype(int)

    # Filter used in training script: conf >= thr AND ridge agrees with classifier
    agree_mask = cls_pred_up == ridge_up
    filtered_mask = (conf >= thr) & agree_mask

    total = len(y_true)
    coverage = filtered_mask.mean()
    unfiltered_acc = (cls_pred_up == y_true).mean()
    filtered_acc = (
        (cls_pred_up[filtered_mask] == y_true[filtered_mask]).mean()
        if filtered_mask.sum() else float("nan")
    )

    cm_unfilt = confusion_matrix(y_true, cls_pred_up, labels=[0, 1])
    cm_filt = (
        confusion_matrix(y_true[filtered_mask], cls_pred_up[filtered_mask], labels=[0, 1])
        if filtered_mask.sum() else np.zeros((2, 2), dtype=int)
    )

    # Regime slice
    regime_rows = []
    for regime_name, regime_fn in [
        ("bull", lambda r: r > 0.10),
        ("bear", lambda r: r < -0.10),
        ("chop", lambda r: (r >= -0.10) & (r <= 0.10)),
    ]:
        rmask = regime_fn(price_ret30_test)
        n_rmask = int(rmask.sum())
        if n_rmask == 0:
            regime_rows.append((regime_name, 0, float("nan"), float("nan"), 0.0))
            continue
        r_unfilt = (cls_pred_up[rmask] == y_true[rmask]).mean()
        rf = rmask & filtered_mask
        if rf.sum() > 0:
            r_filt = (cls_pred_up[rf] == y_true[rf]).mean()
            r_cov = rf.sum() / rmask.sum()
        else:
            r_filt, r_cov = float("nan"), 0.0
        regime_rows.append((regime_name, n_rmask, r_unfilt, r_filt, r_cov))

    # Threshold sweep  (coverage/accuracy trade-off curve)
    sweep = []
    for t in np.linspace(0.50, 0.90, 9):
        m = (conf >= t) & agree_mask
        cov = m.mean()
        if m.sum() > 0:
            acc = (cls_pred_up[m] == y_true[m]).mean()
        else:
            acc = float("nan")
        sweep.append((float(t), float(cov), float(acc) if np.isfinite(acc) else None))

    # Calibration (10 buckets on p_avg)
    bins = np.linspace(0.0, 1.0, 11)
    calib = []
    for b in range(10):
        lo, hi = bins[b], bins[b + 1]
        m = (p_avg >= lo) & (p_avg < hi if b < 9 else p_avg <= hi)
        if m.sum() > 0:
            calib.append((float((lo + hi) / 2), float(y_true[m].mean()), int(m.sum())))
        else:
            calib.append((float((lo + hi) / 2), None, 0))

    return {
        "total": total,
        "threshold": thr,
        "half_life": half_life,
        "coverage": coverage,
        "unfiltered_acc": unfiltered_acc,
        "filtered_acc": filtered_acc,
        "cm_unfilt": cm_unfilt,
        "cm_filt": cm_filt,
        "regime_rows": regime_rows,
        "sweep": sweep,
        "calib": calib,
    }


# ── Report / chart writers ──────────────────────────────────────────────────

def write_markdown(all_results, out_path):
    lines = [
        "# Rate Model v2 — Coverage & Accuracy Breakdown",
        "",
        "Source: `scripts/analyze-rate-model.py` (purged walk-forward CV, same config as training).",
        f"Generated: {datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}",
        "",
        "## What is reported here",
        "",
        "- **Unfiltered directional accuracy** — classifier's sign prediction vs realized sign on every CV test sample.",
        "- **Filtered accuracy** — restrict to samples where (Classifier confidence ≥ threshold) AND (Ridge direction agrees with Classifier). This is what the production advisor surfaces as a \"call\".",
        "- **Coverage** — fraction of windows where the model commits to a call. Low coverage = model stays silent often.",
        "- **Confusion matrix** — rows = realized {down, up}, cols = predicted {down, up}.",
        "- **Regime slice** — bull/bear/chop classified by BTC 30d spot return (>+10% / <−10% / else).",
        "- **Threshold sweep** — coverage ↔ accuracy trade-off curve.",
        "",
        "## Summary table",
        "",
        "| Duration | Samples | Threshold | Coverage | Unfiltered | Filtered |",
        "|---:|---:|---:|---:|---:|---:|",
    ]
    for d, r in all_results.items():
        lines.append(
            f"| {d}d | {r['total']} | {r['threshold']:.2f} | "
            f"{r['coverage']*100:.1f}% | {r['unfiltered_acc']*100:.1f}% | "
            f"{r['filtered_acc']*100:.1f}% |"
        )
    lines.append("")

    for d, r in all_results.items():
        lines.append(f"## Duration {d}d")
        lines.append("")
        lines.append(
            f"- threshold = {r['threshold']:.2f}, half_life = {r['half_life']}d, "
            f"samples in CV = {r['total']}"
        )
        lines.append(f"- coverage = **{r['coverage']*100:.1f}%**")
        lines.append(f"- unfiltered dir acc = **{r['unfiltered_acc']*100:.1f}%**")
        lines.append(f"- filtered dir acc = **{r['filtered_acc']*100:.1f}%**")
        lines.append("")
        lines.append("### Confusion matrix — unfiltered")
        lines.append("")
        lines.append("|  | pred ↓ | pred ↑ |")
        lines.append("|---|---:|---:|")
        lines.append(f"| real ↓ | {r['cm_unfilt'][0,0]} | {r['cm_unfilt'][0,1]} |")
        lines.append(f"| real ↑ | {r['cm_unfilt'][1,0]} | {r['cm_unfilt'][1,1]} |")
        lines.append("")
        lines.append("### Confusion matrix — filtered (committed calls only)")
        lines.append("")
        lines.append("|  | pred ↓ | pred ↑ |")
        lines.append("|---|---:|---:|")
        lines.append(f"| real ↓ | {r['cm_filt'][0,0]} | {r['cm_filt'][0,1]} |")
        lines.append(f"| real ↑ | {r['cm_filt'][1,0]} | {r['cm_filt'][1,1]} |")
        lines.append("")
        lines.append("### Regime slice (BTC 30d spot return)")
        lines.append("")
        lines.append("| Regime | N | Unfiltered | Filtered | Coverage |")
        lines.append("|---|---:|---:|---:|---:|")
        for name, n_r, u, f, cov in r["regime_rows"]:
            u_s = f"{u*100:.1f}%" if np.isfinite(u) else "—"
            f_s = f"{f*100:.1f}%" if np.isfinite(f) else "—"
            lines.append(f"| {name} | {n_r} | {u_s} | {f_s} | {cov*100:.1f}% |")
        lines.append("")
        lines.append("### Threshold sweep (conf ≥ t AND ridge agrees)")
        lines.append("")
        lines.append("| Threshold | Coverage | Accuracy |")
        lines.append("|---:|---:|---:|")
        for t, cov, acc in r["sweep"]:
            acc_s = f"{acc*100:.1f}%" if acc is not None else "—"
            lines.append(f"| {t:.2f} | {cov*100:.1f}% | {acc_s} |")
        lines.append("")
    out_path.write_text("\n".join(lines))


def plot_calibration(all_results, out_path):
    fig, axes = plt.subplots(1, 4, figsize=(18, 4.5))
    for ax, (d, r) in zip(axes, all_results.items()):
        xs, ys, ns = zip(*r["calib"])
        xs = np.array(xs); ns = np.array(ns)
        ys_plot = np.array([y if y is not None else np.nan for y in ys], dtype=float)
        valid = ns > 0
        ax.plot([0, 1], [0, 1], ls="--", color="gray", alpha=0.5)
        ax.plot(xs[valid], ys_plot[valid], marker="o")
        for x, y, n in zip(xs[valid], ys_plot[valid], ns[valid]):
            ax.annotate(str(n), (x, y), fontsize=7, xytext=(3, 3), textcoords="offset points")
        ax.set_xlim(0, 1); ax.set_ylim(0, 1)
        ax.set_xlabel("Predicted P(up)")
        ax.set_ylabel("Realized P(up)")
        ax.set_title(f"{d}d calibration")
        ax.grid(alpha=0.3)
    plt.tight_layout()
    plt.savefig(out_path, dpi=130, bbox_inches="tight")
    plt.close(fig)


def plot_coverage_sweep(all_results, out_path):
    fig, ax = plt.subplots(figsize=(8, 5))
    colors = {7: "#9945ff", 30: "#43b4ca", 90: "#f97316", 180: "#14b8a6"}
    for d, r in all_results.items():
        ts = [x[0] for x in r["sweep"]]
        covs = [x[1] * 100 for x in r["sweep"]]
        accs = [x[2] * 100 if x[2] is not None else None for x in r["sweep"]]
        ax.plot(covs, accs, marker="o", label=f"{d}d", color=colors.get(d, "black"))
    ax.set_xlabel("Coverage (%)")
    ax.set_ylabel("Filtered accuracy (%)")
    ax.set_title("Coverage vs Accuracy trade-off (threshold sweep)")
    ax.legend()
    ax.grid(alpha=0.3)
    ax.invert_xaxis()  # higher coverage on the left
    plt.tight_layout()
    plt.savefig(out_path, dpi=130, bbox_inches="tight")
    plt.close(fig)


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("Fetching Binance funding rates (cached for 24h)...")
    funding_data = {}
    for market, symbol in SYMBOLS.items():
        daily = fetch_binance_funding(symbol)
        ts, rates = make_series(daily)
        funding_data[market] = (ts, rates)
        print(
            f"  {market}: {len(ts)} daily pts  "
            f"({datetime.datetime.utcfromtimestamp(ts[0]).strftime('%Y-%m-%d')} ~ "
            f"{datetime.datetime.utcfromtimestamp(ts[-1]).strftime('%Y-%m-%d')})"
        )

    print("Fetching BTC spot price + F&G...")
    price_dict = fetch_btc_price()
    fng_dict = fetch_fear_greed()

    market_list = list(SYMBOLS.keys())
    btc_ts, btc_rates = funding_data["BTC"]

    with open(ROOT / "app" / "src" / "lib" / "fundex" / "rate-model.json") as f:
        rate_model = json.load(f)

    all_results = {}

    for duration in DURATIONS:
        print(f"\n=== {duration}d ===")
        X_all, y_reg_all, y_cls_all, pr30_all, mkt_all = [], [], [], [], []
        for market in market_list:
            ts, rates = funding_data[market]
            rates_a, btc_a, prices_a, fng_a = align_series(
                ts, rates, btc_ts, btc_rates, price_dict, fng_dict
            )
            for i in range(30, len(rates_a)):
                y = log_ratio_target(rates_a, i, duration)
                if y is None:
                    continue
                feat = build_features(rates_a, btc_a, prices_a, fng_a, i, market, market_list)
                if feat is None:
                    continue
                # BTC 30d price return at sample i  — for regime slicing.
                pr30 = 0.0
                if (
                    len(prices_a) > i
                    and prices_a[i] > 0
                    and prices_a[max(0, i - 30)] > 0
                ):
                    pr30 = (prices_a[i] - prices_a[max(0, i - 30)]) / prices_a[max(0, i - 30)]
                X_all.append(feat)
                y_reg_all.append(y)
                y_cls_all.append(1 if y > 0 else 0)
                pr30_all.append(pr30)
                mkt_all.append(market)

        X = np.array(X_all); y_reg = np.array(y_reg_all); y_cls = np.array(y_cls_all)
        pr30 = np.array(pr30_all)
        print(f"  samples={len(X)}  up%={y_cls.mean()*100:.1f}%")

        cfg = rate_model["models"][str(duration)]
        if cfg.get("type") != "ensemble":
            print("  (stat model — skipping CV analysis)")
            continue

        res = analyze_duration(duration, X, y_reg, y_cls, pr30, mkt_all, cfg)
        all_results[duration] = res
        print(
            f"  coverage={res['coverage']*100:.1f}%  "
            f"unfiltered={res['unfiltered_acc']*100:.1f}%  "
            f"filtered={res['filtered_acc']*100:.1f}%"
        )

    out_md = REPORT_DIR / "rate-model-analysis.md"
    write_markdown(all_results, out_md)
    print(f"\nReport → {out_md}")

    cal_png = CHART_DIR / "model-calibration.png"
    plot_calibration(all_results, cal_png)
    print(f"Chart → {cal_png}")

    cov_png = CHART_DIR / "model-coverage.png"
    plot_coverage_sweep(all_results, cov_png)
    print(f"Chart → {cov_png}")

    print("\nDone.")


if __name__ == "__main__":
    main()
