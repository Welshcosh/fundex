#!/usr/bin/env python3
"""
Improved directional accuracy via:
1. Direction classifier (logistic regression) on top of regression
2. Cross-market features (BTC leads ETH/SOL)
3. Ensemble voting: predict direction only when regression + classifier agree
4. Confidence threshold: only signal when z-score is strong
"""

import numpy as np
import requests
import warnings
warnings.filterwarnings("ignore")

from sklearn.linear_model import Ridge, LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.metrics import mean_absolute_error
from xgboost import XGBRegressor, XGBClassifier

POOLS = {
    "BTC": "5b8c0691-b9ff-4d82-97e4-19a1247e6dbf",
    "ETH": "61b4c35c-97f6-4c05-a5ff-aeb4426adf5b",
    "SOL": "906b233c-8478-4b94-94e5-2d77e6c7c9e5",
}
MARKET_LIST = list(POOLS.keys())
TRAIN_RATIO = 0.70
DURATIONS   = [7, 30]


def fetch(pool_id):
    r = requests.get(f"https://yields.llama.fi/chart/{pool_id}", timeout=30)
    r.raise_for_status()
    return [d["apyBase"] for d in r.json()["data"] if d.get("apyBase") is not None]


def winsorize(apys, pct=95):
    arr = np.array(apys, dtype=float)
    return np.clip(arr, 0, np.percentile(arr, pct))


def build_features(all_apys: dict, market: str, i: int) -> list:
    """Rich single-market features + cross-market BTC lead signal."""
    apys = all_apys[market]
    cur  = apys[i]
    w7   = apys[max(0, i-7):i]
    w30  = apys[max(0, i-30):i]

    ma7, ma30 = np.mean(w7), np.mean(w30)
    std7  = np.std(w7)  + 1e-9
    std30 = np.std(w30) + 1e-9

    z7  = (cur - ma7)  / std7
    z30 = (cur - ma30) / std30
    mom5  = (cur - apys[max(0,i-5)])  / (apys[max(0,i-5)]  + 1e-9)
    mom14 = (cur - apys[max(0,i-14)]) / (apys[max(0,i-14)] + 1e-9)
    lag1  = (cur - apys[max(0,i-1)])  / (cur + 1e-9)
    lag3  = (cur - apys[max(0,i-3)])  / (cur + 1e-9)
    lag7  = (cur - apys[max(0,i-7)])  / (cur + 1e-9)
    vol_ratio = std7 / std30
    trend = (ma7 - ma30) / (ma30 + 1e-9)
    # Rate acceleration (second derivative)
    d1 = apys[i] - apys[max(0,i-1)]
    d2 = apys[max(0,i-1)] - apys[max(0,i-2)]
    accel = d1 - d2

    base = [
        np.log(cur + 0.01), z7, z30, mom5, mom14,
        vol_ratio, trend, lag1, lag3, lag7,
        std7 / (cur+1e-9), std30 / (cur+1e-9),
        accel / (cur + 1e-9),          # NEW: acceleration
    ]

    # Cross-market: BTC 1d, 7d change as lead signal (for ETH/SOL)
    btc = all_apys["BTC"]
    btc_mom1 = (btc[i] - btc[max(0,i-1)]) / (btc[max(0,i-1)] + 1e-9)
    btc_mom7 = (btc[i] - btc[max(0,i-7)]) / (btc[max(0,i-7)] + 1e-9)
    btc_z30  = (btc[i] - np.mean(btc[max(0,i-30):i])) / (np.std(btc[max(0,i-30):i]) + 1e-9)

    base += [btc_mom1, btc_mom7, btc_z30]  # NEW: cross-market

    # One-hot market
    ohe = [1 if m == market else 0 for m in MARKET_LIST]
    return base + ohe


def log_ratio_target(apys, i, duration):
    future = apys[i:i+duration]
    if len(future) < duration or apys[i] <= 0:
        return None
    avg = np.mean(future)
    return np.log(avg / apys[i]) if avg > 0 else None


def dir_accuracy(y_true, y_pred):
    return np.mean(np.sign(y_pred) == np.sign(y_true))


def ensemble_direction(pred_reg, pred_cls_prob, threshold=0.60):
    """
    Ensemble: use regression sign, but only when classifier confidence >= threshold.
    Returns predicted direction array (1=up, -1=down, 0=abstain).
    """
    out = []
    for r, p in zip(pred_reg, pred_cls_prob):
        conf = max(p, 1-p)       # confidence = distance from 0.5
        cls_dir = 1 if p >= 0.5 else -1
        reg_dir = np.sign(r)
        if conf >= threshold and cls_dir == reg_dir:
            out.append(reg_dir)
        else:
            out.append(0)        # abstain
    return np.array(out)


def main():
    print("Fetching data...")
    data = {}
    for market, pool_id in POOLS.items():
        data[market] = winsorize(fetch(pool_id))
        print(f"  {market}: {len(data[market])} pts")

    for duration in DURATIONS:
        print(f"\n{'='*65}")
        print(f"  Duration: {duration}d")
        print(f"{'='*65}")

        X_tr, y_tr_reg, y_tr_cls = [], [], []
        test_sets = {}

        for market in MARKET_LIST:
            apys = data[market]
            n    = len(apys)
            n_tr = int(n * TRAIN_RATIO)

            # Train
            for i in range(30, n_tr):
                y = log_ratio_target(apys, i, duration)
                if y is None: continue
                feat = build_features(data, market, i)
                if not all(np.isfinite(feat)): continue
                X_tr.append(feat)
                y_tr_reg.append(y)
                y_tr_cls.append(1 if y > 0 else 0)

            # Test
            X_te, y_reg, y_cls = [], [], []
            for i in range(n_tr, n - duration):
                y = log_ratio_target(apys, i, duration)
                if y is None: continue
                feat = build_features(data, market, i)
                if not all(np.isfinite(feat)): continue
                X_te.append(feat)
                y_reg.append(y)
                y_cls.append(1 if y > 0 else 0)
            test_sets[market] = (
                np.array(X_te), np.array(y_reg), np.array(y_cls)
            )

        X_tr = np.array(X_tr)
        y_tr_reg = np.array(y_tr_reg)
        y_tr_cls = np.array(y_tr_cls)

        # ── Train models ────────────────────────────────────────
        sc = StandardScaler()
        X_tr_sc = sc.fit_transform(X_tr)

        ridge = Ridge(alpha=1.0).fit(X_tr_sc, y_tr_reg)
        logit = LogisticRegression(C=0.5, max_iter=500).fit(X_tr_sc, y_tr_cls)
        xgb_cls = XGBClassifier(
            n_estimators=200, max_depth=4, learning_rate=0.05,
            subsample=0.8, colsample_bytree=0.8, verbosity=0, random_state=42,
            eval_metric="logloss",
        ).fit(X_tr, y_tr_cls)

        # ── Evaluate ─────────────────────────────────────────────
        all_true_reg, all_true_cls = [], []
        all_pred_naive, all_pred_ridge, all_pred_ens_60, all_pred_ens_65 = [], [], [], []

        for market, (X_te, y_reg, y_cls) in test_sets.items():
            if len(y_reg) == 0: continue
            X_te_sc = sc.transform(X_te)

            p_ridge = ridge.predict(X_te_sc)
            p_logit_prob = logit.predict_proba(X_te_sc)[:, 1]  # P(up)
            p_xgb_prob   = xgb_cls.predict_proba(X_te)[:, 1]

            # Ensemble: average classifier probabilities
            p_avg_prob = (p_logit_prob + p_xgb_prob) / 2

            ens_60 = ensemble_direction(p_ridge, p_avg_prob, threshold=0.60)
            ens_65 = ensemble_direction(p_ridge, p_avg_prob, threshold=0.65)

            # Only evaluate ensemble on non-abstain samples
            mask_60 = ens_60 != 0
            mask_65 = ens_65 != 0

            naive_dir = dir_accuracy(y_reg, np.zeros_like(y_reg))  # 50%
            ridge_dir = dir_accuracy(y_reg, p_ridge)
            ens60_dir = dir_accuracy(y_reg[mask_60], ens_60[mask_60]) if mask_60.any() else 0.5
            ens65_dir = dir_accuracy(y_reg[mask_65], ens_65[mask_65]) if mask_65.any() else 0.5
            cov_60 = mask_60.mean()
            cov_65 = mask_65.mean()

            print(f"\n  {market} ({len(y_reg)} test pts):")
            print(f"    Naive            dir={naive_dir*100:.1f}%  coverage=100%")
            print(f"    Ridge            dir={ridge_dir*100:.1f}%  coverage=100%")
            print(f"    Ensemble(≥60%)   dir={ens60_dir*100:.1f}%  coverage={cov_60*100:.0f}%")
            print(f"    Ensemble(≥65%)   dir={ens65_dir*100:.1f}%  coverage={cov_65*100:.0f}%")

            all_true_reg.extend(y_reg)
            all_pred_naive.extend(np.zeros_like(y_reg))
            all_pred_ridge.extend(p_ridge)
            all_pred_ens_60.extend(
                ens_60 if len(ens_60) else []
            )
            all_pred_ens_65.extend(ens_65)
            all_true_cls.extend(y_cls)

        at = np.array(all_true_reg)
        pr = np.array(all_pred_ridge)
        e60 = np.array(all_pred_ens_60)
        e65 = np.array(all_pred_ens_65)

        m60 = e60 != 0
        m65 = e65 != 0

        print(f"\n  COMBINED:")
        print(f"    Naive            dir={dir_accuracy(at, np.zeros_like(at))*100:.1f}%  coverage=100%")
        print(f"    Ridge            dir={dir_accuracy(at, pr)*100:.1f}%  coverage=100%")
        print(f"    Ensemble(≥60%)   dir={dir_accuracy(at[m60], e60[m60])*100:.1f}%  coverage={m60.mean()*100:.0f}%")
        print(f"    Ensemble(≥65%)   dir={dir_accuracy(at[m65], e65[m65])*100:.1f}%  coverage={m65.mean()*100:.0f}%")


if __name__ == "__main__":
    main()
