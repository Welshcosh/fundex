# Rate Model v2 — Coverage & Accuracy Breakdown

Source: `scripts/analyze-rate-model.py` (purged walk-forward CV, same config as training).
Generated: 2026-04-21 03:56 UTC

## What is reported here

- **Unfiltered directional accuracy** — classifier's sign prediction vs realized sign on every CV test sample.
- **Filtered accuracy** — restrict to samples where (Classifier confidence ≥ threshold) AND (Ridge direction agrees with Classifier). This is what the production advisor surfaces as a "call".
- **Coverage** — fraction of windows where the model commits to a call. Low coverage = model stays silent often.
- **Confusion matrix** — rows = realized {down, up}, cols = predicted {down, up}.
- **Regime slice** — bull/bear/chop classified by BTC 30d spot return (>+10% / <−10% / else).
- **Threshold sweep** — coverage ↔ accuracy trade-off curve.

## Summary table

| Duration | Samples | Threshold | Coverage | Unfiltered | Filtered |
|---:|---:|---:|---:|---:|---:|
| 7d | 1555 | 0.70 | 49.8% | 68.9% | 77.1% |
| 30d | 1525 | 0.70 | 54.1% | 66.5% | 74.1% |
| 90d | 1495 | 0.70 | 59.5% | 67.9% | 73.2% |
| 180d | 1440 | 0.70 | 65.8% | 64.0% | 62.7% |

## Duration 7d

- threshold = 0.70, half_life = 360d, samples in CV = 1555
- coverage = **49.8%**
- unfiltered dir acc = **68.9%**
- filtered dir acc = **77.1%**

### Confusion matrix — unfiltered

|  | pred ↓ | pred ↑ |
|---|---:|---:|
| real ↓ | 514 | 297 |
| real ↑ | 186 | 558 |

### Confusion matrix — filtered (committed calls only)

|  | pred ↓ | pred ↑ |
|---|---:|---:|
| real ↓ | 265 | 121 |
| real ↑ | 56 | 332 |

### Regime slice (BTC 30d spot return)

| Regime | N | Unfiltered | Filtered | Coverage |
|---|---:|---:|---:|---:|
| bull | 283 | 62.9% | 74.8% | 44.9% |
| bear | 81 | 80.2% | 90.4% | 64.2% |
| chop | 1191 | 69.6% | 76.5% | 50.0% |

### Threshold sweep (conf ≥ t AND ridge agrees)

| Threshold | Coverage | Accuracy |
|---:|---:|---:|
| 0.50 | 75.4% | 68.3% |
| 0.55 | 69.3% | 69.7% |
| 0.60 | 62.6% | 72.3% |
| 0.65 | 57.2% | 74.0% |
| 0.70 | 49.8% | 77.1% |
| 0.75 | 41.4% | 78.4% |
| 0.80 | 32.3% | 79.9% |
| 0.85 | 23.3% | 81.8% |
| 0.90 | 14.1% | 85.4% |

## Duration 30d

- threshold = 0.70, half_life = 360d, samples in CV = 1525
- coverage = **54.1%**
- unfiltered dir acc = **66.5%**
- filtered dir acc = **74.1%**

### Confusion matrix — unfiltered

|  | pred ↓ | pred ↑ |
|---|---:|---:|
| real ↓ | 590 | 346 |
| real ↑ | 165 | 424 |

### Confusion matrix — filtered (committed calls only)

|  | pred ↓ | pred ↑ |
|---|---:|---:|
| real ↓ | 328 | 171 |
| real ↑ | 43 | 283 |

### Regime slice (BTC 30d spot return)

| Regime | N | Unfiltered | Filtered | Coverage |
|---|---:|---:|---:|---:|
| bull | 285 | 62.8% | 64.5% | 60.4% |
| bear | 101 | 75.2% | 82.3% | 61.4% |
| chop | 1139 | 66.6% | 76.0% | 51.9% |

### Threshold sweep (conf ≥ t AND ridge agrees)

| Threshold | Coverage | Accuracy |
|---:|---:|---:|
| 0.50 | 79.2% | 64.2% |
| 0.55 | 73.4% | 66.1% |
| 0.60 | 68.3% | 68.3% |
| 0.65 | 61.3% | 70.4% |
| 0.70 | 54.1% | 74.1% |
| 0.75 | 44.5% | 78.6% |
| 0.80 | 36.5% | 81.9% |
| 0.85 | 27.2% | 85.1% |
| 0.90 | 19.2% | 88.4% |

## Duration 90d

- threshold = 0.70, half_life = 360d, samples in CV = 1495
- coverage = **59.5%**
- unfiltered dir acc = **67.9%**
- filtered dir acc = **73.2%**

### Confusion matrix — unfiltered

|  | pred ↓ | pred ↑ |
|---|---:|---:|
| real ↓ | 463 | 398 |
| real ↑ | 82 | 552 |

### Confusion matrix — filtered (committed calls only)

|  | pred ↓ | pred ↑ |
|---|---:|---:|
| real ↓ | 230 | 221 |
| real ↑ | 17 | 421 |

### Regime slice (BTC 30d spot return)

| Regime | N | Unfiltered | Filtered | Coverage |
|---|---:|---:|---:|---:|
| bull | 332 | 67.2% | 69.6% | 62.3% |
| bear | 86 | 73.3% | 82.1% | 65.1% |
| chop | 1077 | 67.7% | 73.6% | 58.1% |

### Threshold sweep (conf ≥ t AND ridge agrees)

| Threshold | Coverage | Accuracy |
|---:|---:|---:|
| 0.50 | 80.7% | 64.9% |
| 0.55 | 75.6% | 66.5% |
| 0.60 | 70.2% | 68.1% |
| 0.65 | 65.4% | 70.9% |
| 0.70 | 59.5% | 73.2% |
| 0.75 | 52.6% | 74.8% |
| 0.80 | 44.3% | 77.2% |
| 0.85 | 36.3% | 78.4% |
| 0.90 | 26.8% | 82.2% |

## Duration 180d

- threshold = 0.70, half_life = 360d, samples in CV = 1440
- coverage = **65.8%**
- unfiltered dir acc = **64.0%**
- filtered dir acc = **62.7%**

### Confusion matrix — unfiltered

|  | pred ↓ | pred ↑ |
|---|---:|---:|
| real ↓ | 474 | 460 |
| real ↑ | 58 | 448 |

### Confusion matrix — filtered (committed calls only)

|  | pred ↓ | pred ↑ |
|---|---:|---:|
| real ↓ | 295 | 346 |
| real ↑ | 8 | 299 |

### Regime slice (BTC 30d spot return)

| Regime | N | Unfiltered | Filtered | Coverage |
|---|---:|---:|---:|---:|
| bull | 339 | 64.3% | 65.1% | 64.3% |
| bear | 57 | 75.4% | 81.4% | 75.4% |
| chop | 1044 | 63.3% | 60.7% | 65.8% |

### Threshold sweep (conf ≥ t AND ridge agrees)

| Threshold | Coverage | Accuracy |
|---:|---:|---:|
| 0.50 | 79.7% | 57.2% |
| 0.55 | 76.3% | 58.5% |
| 0.60 | 72.2% | 60.2% |
| 0.65 | 69.5% | 61.2% |
| 0.70 | 65.8% | 62.7% |
| 0.75 | 60.0% | 63.4% |
| 0.80 | 53.8% | 65.4% |
| 0.85 | 48.5% | 66.8% |
| 0.90 | 39.7% | 71.2% |
