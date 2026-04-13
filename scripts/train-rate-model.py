#!/usr/bin/env python3
"""
Improved training pipeline:
- Data: Binance perp funding rates (8h → daily) + Fear&Greed index
- Model: LightGBM classifier (direction) + Ridge regression (magnitude)
- Features: funding rate stats + fear&greed + BTC price momentum + cross-market
- Ensemble: predict direction when both models agree >= threshold
"""

import json, time
import numpy as np
import requests
import warnings
warnings.filterwarnings("ignore")

from sklearn.linear_model import Ridge, LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import mean_absolute_error
import lightgbm as lgb

SYMBOLS = {"BTC": "BTCUSDT", "ETH": "ETHUSDT", "SOL": "SOLUSDT"}
DURATIONS    = [7, 30, 90, 180]
ML_DURATIONS = [7, 30]
THRESHOLD    = 0.65
TRAIN_RATIO  = 0.70


# ── Data fetching ─────────────────────────────────────────────────────────────

def fetch_binance_funding(symbol: str) -> dict[int, float]:
    """Fetch all historical 8h funding rates. Returns {date_ts: daily_avg_rate}."""
    url        = "https://fapi.binance.com/fapi/v1/fundingRate"
    all_records = []
    start_time  = 1568102400000   # 2019-09-10 (BTC futures launch)

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

    # Group by date (UTC day), average 3 readings
    daily: dict[int, list] = {}
    for rec in all_records:
        ts    = int(rec["fundingTime"]) // 1000
        day   = (ts // 86400) * 86400   # truncate to day
        rate  = float(rec["fundingRate"])
        daily.setdefault(day, []).append(rate)

    return {day: float(np.mean(rates)) for day, rates in daily.items()}


def fetch_btc_price() -> dict[int, dict]:
    """Fetch daily BTC close price from Binance spot. Returns {date_ts: {close, ret1d, ...}}."""
    url  = "https://api.binance.com/api/v3/klines"
    params = {"symbol": "BTCUSDT", "interval": "1d", "limit": 1000}
    r = requests.get(url, params=params, timeout=30)
    r.raise_for_status()
    out = {}
    for k in r.json():
        ts    = int(k[0]) // 1000
        day   = (ts // 86400) * 86400
        out[day] = float(k[4])  # close
    return out


def fetch_fear_greed() -> dict[int, float]:
    """Fetch historical Fear & Greed index. Returns {date_ts: value (0-100)}."""
    r = requests.get("https://api.alternative.me/fng/?limit=2000", timeout=30)
    r.raise_for_status()
    out = {}
    for d in r.json()["data"]:
        ts  = int(d["timestamp"])
        day = (ts // 86400) * 86400
        out[day] = float(d["value"])
    return out


# ── Feature engineering ───────────────────────────────────────────────────────

def make_series(daily_rates: dict[int, float]) -> tuple[np.ndarray, np.ndarray]:
    """Sort by date and return (timestamps, rates) arrays."""
    items = sorted(daily_rates.items())
    return np.array([i[0] for i in items]), np.array([i[1] for i in items])


def build_features(
    rates:    np.ndarray,   # daily funding rates for this market
    btc_r:    np.ndarray,   # daily BTC funding rates (cross-market)
    prices:   np.ndarray,   # daily BTC close prices (aligned)
    fng:      np.ndarray,   # daily fear & greed (aligned, NaN if missing)
    i:        int,
    market:   str,
    market_list: list[str],
) -> "list[float] | None":
    if i < 30:
        return None

    cur  = rates[i]
    if cur == 0 or not np.isfinite(cur):
        return None

    w7   = rates[max(0, i-7):i]
    w30  = rates[max(0, i-30):i]
    ma7  = np.mean(w7);  std7  = np.std(w7)  + 1e-9
    ma30 = np.mean(w30); std30 = np.std(w30) + 1e-9

    z7    = (cur - ma7)  / std7
    z30   = (cur - ma30) / std30
    mom5  = (cur - rates[max(0,i-5)])  / (rates[max(0,i-5)]  + 1e-9)
    mom14 = (cur - rates[max(0,i-14)]) / (rates[max(0,i-14)] + 1e-9)
    lag1  = (cur - rates[i-1]) / (cur + 1e-9)
    lag3  = (cur - rates[max(0,i-3)]) / (cur + 1e-9)
    lag7  = (cur - rates[max(0,i-7)]) / (cur + 1e-9)
    vol_ratio = std7 / std30
    trend     = (ma7 - ma30) / (ma30 + 1e-9)
    d1 = cur - rates[i-1]
    d2 = rates[i-1] - rates[max(0,i-2)]
    accel = (d1 - d2) / (abs(cur) + 1e-9)

    log_cur = np.log(abs(cur) + 1e-6) * np.sign(cur)

    # BTC cross-market signal
    btc_cur  = btc_r[i]
    btc_ma7  = np.mean(btc_r[max(0,i-7):i])
    btc_ma30 = np.mean(btc_r[max(0,i-30):i])
    btc_std30 = np.std(btc_r[max(0,i-30):i]) + 1e-9
    btc_mom1 = (btc_cur - btc_r[i-1]) / (abs(btc_r[i-1]) + 1e-9)
    btc_mom7 = (btc_cur - btc_r[max(0,i-7)]) / (abs(btc_r[max(0,i-7)]) + 1e-9)
    btc_z30  = (btc_cur - btc_ma30) / btc_std30

    # BTC price momentum
    if len(prices) > i and prices[i] > 0 and prices[max(0,i-7)] > 0:
        price_ret7  = (prices[i] - prices[max(0,i-7)])  / prices[max(0,i-7)]
        price_ret30 = (prices[i] - prices[max(0,i-30)]) / (prices[max(0,i-30)] + 1e-9)
        price_vol30 = np.std(prices[max(0,i-30):i]) / (np.mean(prices[max(0,i-30):i]) + 1e-9)
    else:
        price_ret7 = price_ret30 = price_vol30 = 0.0

    # Fear & Greed
    fng_cur  = fng[i]  if np.isfinite(fng[i])  else 50.0
    fng_ma7  = np.nanmean(fng[max(0,i-7):i])  if i > 0 else 50.0
    fng_trend = (fng_cur - fng_ma7) / 100.0

    # Normalize F&G to [-1, 1]
    fng_norm  = (fng_cur - 50) / 50.0

    base = [
        log_cur, z7, z30, mom5, mom14,
        vol_ratio, trend, lag1, lag3, lag7,
        std7 / (abs(cur)+1e-9), std30 / (abs(cur)+1e-9), accel,
        # cross-market
        btc_mom1, btc_mom7, btc_z30,
        # BTC price
        price_ret7, price_ret30, price_vol30,
        # Fear & Greed
        fng_norm, fng_trend,
    ]

    ohe = [1 if m == market else 0 for m in market_list]
    feat = base + ohe
    return feat if all(np.isfinite(feat)) else None


FEATURE_NAMES = [
    "log_cur", "z7", "z30", "mom5", "mom14",
    "vol_ratio", "trend", "lag1", "lag3", "lag7",
    "rel_std7", "rel_std30", "accel",
    "btc_mom1", "btc_mom7", "btc_z30",
    "price_ret7", "price_ret30", "price_vol30",
    "fng_norm", "fng_trend",
]


def log_ratio_target(rates, i, duration):
    future = rates[i:i+duration]
    if len(future) < duration:
        return None
    cur = rates[i]
    avg = np.mean(future)
    if cur <= 0 or avg <= 0:
        return None
    return float(np.log(avg / cur))


# ── Align time series ─────────────────────────────────────────────────────────

def align_series(
    rate_ts: np.ndarray, rates: np.ndarray,
    btc_ts: np.ndarray, btc_rates: np.ndarray,
    price_dict: dict[int, float],
    fng_dict: dict[int, float],
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Return aligned (rates, btc_rates, prices, fng) arrays for each timestamp in rate_ts."""
    btc_map   = dict(zip(btc_ts, btc_rates))
    prices_a  = np.array([price_dict.get(ts, np.nan) for ts in rate_ts])
    fng_a     = np.array([fng_dict.get(ts, np.nan)   for ts in rate_ts])
    btc_a     = np.array([btc_map.get(ts, np.nan)    for ts in rate_ts])

    # Forward-fill NaN
    for arr in [btc_a, prices_a, fng_a]:
        for j in range(1, len(arr)):
            if not np.isfinite(arr[j]):
                arr[j] = arr[j-1]

    return rates, btc_a, prices_a, fng_a


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    market_list = list(SYMBOLS.keys())

    print("Fetching Binance funding rates...")
    funding_data: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for market, symbol in SYMBOLS.items():
        daily = fetch_binance_funding(symbol)
        ts, rates = make_series(daily)
        funding_data[market] = (ts, rates)
        print(f"  {market}: {len(ts)} daily pts  "
              f"({ts[0] and __import__('datetime').datetime.utcfromtimestamp(ts[0]).strftime('%Y-%m-%d')} ~ "
              f"{__import__('datetime').datetime.utcfromtimestamp(ts[-1]).strftime('%Y-%m-%d')})")

    print("Fetching BTC price...")
    price_dict = fetch_btc_price()
    print(f"  {len(price_dict)} daily close prices")

    print("Fetching Fear & Greed index...")
    fng_dict = fetch_fear_greed()
    print(f"  {len(fng_dict)} daily F&G values")

    btc_ts, btc_rates = funding_data["BTC"]
    btc_map = dict(zip(btc_ts.tolist(), btc_rates.tolist()))

    models = {}

    for duration in DURATIONS:
        print(f"\n{'='*60}")
        print(f"  Duration: {duration}d")

        if duration not in ML_DURATIONS:
            stat_models = {}
            for market, (ts, rates) in funding_data.items():
                stat_models[market] = {
                    "mean":        float(rates.mean()),
                    "std":         float(rates.std()),
                    "recent_mean": float(rates[-30:].mean()),
                    "recent_std":  float(rates[-30:].std()),
                }
            models[str(duration)] = {"type": "stat", "market_stats": stat_models}
            print(f"  → mean-reversion stats only")
            continue

        X_all, y_reg_all, y_cls_all = [], [], []

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
                X_all.append(feat)
                y_reg_all.append(y)
                y_cls_all.append(1 if y > 0 else 0)

        X     = np.array(X_all)
        y_reg = np.array(y_reg_all)
        y_cls = np.array(y_cls_all)
        print(f"  Samples: {len(X)}  |  up%={y_cls.mean()*100:.1f}%")

        sc   = StandardScaler()
        X_sc = sc.fit_transform(X)

        # Ridge
        ridge = Ridge(alpha=1.0).fit(X_sc, y_reg)

        # LightGBM classifier
        lgb_model = lgb.LGBMClassifier(
            n_estimators=500, max_depth=5, learning_rate=0.03,
            num_leaves=31, subsample=0.8, colsample_bytree=0.8,
            reg_alpha=0.1, reg_lambda=0.1,
            random_state=42, verbose=-1,
        )
        lgb_model.fit(X, y_cls)

        # Logistic (for JS export)
        logit = LogisticRegression(C=0.3, max_iter=1000).fit(X_sc, y_cls)

        # CV evaluation (TimeSeriesSplit)
        tscv = TimeSeriesSplit(n_splits=5)
        ridge_maes, ens_dir_accs = [], []
        for tr, te in tscv.split(X):
            r_cv = Ridge(alpha=1.0).fit(X_sc[tr], y_reg[tr])
            l_cv = LogisticRegression(C=0.3, max_iter=1000).fit(X_sc[tr], y_cls[tr])
            g_cv = lgb.LGBMClassifier(
                n_estimators=300, max_depth=5, learning_rate=0.03,
                num_leaves=31, subsample=0.8, colsample_bytree=0.8,
                random_state=42, verbose=-1,
            ).fit(X[tr], y_cls[tr])

            ridge_maes.append(mean_absolute_error(y_reg[te], r_cv.predict(X_sc[te])))

            p_r   = r_cv.predict(X_sc[te])
            p_l   = l_cv.predict_proba(X_sc[te])[:, 1]
            p_g   = g_cv.predict_proba(X[te])[:, 1]
            p_avg = (p_l + p_g) / 2

            correct, total = 0, 0
            for r, p, yt in zip(p_r, p_avg, y_cls[te]):
                conf = max(p, 1-p)
                if conf >= THRESHOLD and int(p>=0.5) == int(r>0):
                    total += 1
                    correct += int(int(p>=0.5) == yt)
            ens_dir_accs.append(correct/total if total else 0.5)

        naive_mae = mean_absolute_error(y_reg, np.zeros_like(y_reg))
        ridge_mae = float(np.mean(ridge_maes))
        skill     = 1 - ridge_mae / naive_mae
        ens_dir   = float(np.mean(ens_dir_accs))

        print(f"  Ridge  skill={skill*100:+.1f}%  MAE={ridge_mae:.4f}")
        print(f"  Ensemble dir_acc={ens_dir*100:.1f}%  (threshold={THRESHOLD})")

        models[str(duration)] = {
            "type":             "ensemble",
            "scaler_mean":      sc.mean_.tolist(),
            "scaler_std":       sc.scale_.tolist(),
            "ridge_coef":       ridge.coef_.tolist(),
            "ridge_intercept":  float(ridge.intercept_),
            "logit_coef":       logit.coef_[0].tolist(),
            "logit_intercept":  float(logit.intercept_[0]),
            "feature_names":    FEATURE_NAMES + [f"market_{m}" for m in market_list],
            "threshold":        THRESHOLD,
            "ridge_skill":      float(skill),
            "ensemble_dir_acc": ens_dir,
            "naive_mae":        float(naive_mae),
        }

    # Latest market stats
    market_stats = {}
    for market, (ts, rates) in funding_data.items():
        market_stats[market] = {
            "current_rate": float(rates[-1]),
            "ma7":          float(rates[-7:].mean()),
            "ma30":         float(rates[-30:].mean()),
            "std30":        float(rates[-30:].std()),
            "min30":        float(rates[-30:].min()),
            "max30":        float(rates[-30:].max()),
        }

    # Current F&G + BTC price
    latest_ts = sorted(fng_dict.keys())[-1]
    extra = {
        "fng_current":  fng_dict.get(latest_ts, 50),
        "fng_ma7":      float(np.mean([fng_dict.get(latest_ts - i*86400, 50) for i in range(7)])),
        "btc_price":    price_dict.get(sorted(price_dict.keys())[-1], 0),
    }

    out = {
        "models":             models,
        "market_stats":       market_stats,
        "extra":              extra,
        "markets":            market_list,
        "durations":          DURATIONS,
        "ensemble_threshold": THRESHOLD,
        "data_source":        "binance_perp_funding",
    }

    path = "app/src/lib/fundex/rate-model.json"
    with open(path, "w") as f:
        json.dump(out, f, indent=2)

    print(f"\nSaved → {path}")
    print("\nSummary:")
    for dur, m in models.items():
        if m["type"] == "ensemble":
            print(f"  {dur}d  skill={m['ridge_skill']*100:+.1f}%  "
                  f"ensemble_dir={m['ensemble_dir_acc']*100:.1f}%")
        else:
            print(f"  {dur}d  mean-reversion")


if __name__ == "__main__":
    main()
