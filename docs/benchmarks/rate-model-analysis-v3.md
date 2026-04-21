# Rate Model v3 — Coverage & Accuracy Breakdown (with basis features)

Source: `scripts/analyze-rate-model-v3.py` (purged walk-forward CV, v3 feature set with 4 basis features).
Generated: 2026-04-21 09:34 UTC

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
| 7d | 1555 | 0.70 | 53.6% | 70.1% | 77.6% |
| 30d | 1525 | 0.70 | 55.8% | 66.7% | 75.9% |
| 90d | 1495 | 0.70 | 57.1% | 69.1% | 75.6% |
| 180d | 1440 | 0.70 | 66.9% | 63.2% | 67.4% |

## Duration 7d

- threshold = 0.70, half_life = 360d, samples in CV = 1555
- coverage = **53.6%**
- unfiltered dir acc = **70.1%**
- filtered dir acc = **77.6%**

### Confusion matrix — unfiltered

|  | pred ↓ | pred ↑ |
|---|---:|---:|
| real ↓ | 554 | 257 |
| real ↑ | 208 | 536 |

### Confusion matrix — filtered (committed calls only)

|  | pred ↓ | pred ↑ |
|---|---:|---:|
| real ↓ | 318 | 114 |
| real ↑ | 73 | 328 |

### Regime slice (BTC 30d spot return)

| Regime | N | Unfiltered | Filtered | Coverage |
|---|---:|---:|---:|---:|
| bull | 283 | 68.9% | 76.4% | 49.5% |
| bear | 81 | 82.7% | 90.0% | 61.7% |
| chop | 1191 | 69.5% | 76.8% | 54.0% |

### Threshold sweep (conf ≥ t AND ridge agrees)

| Threshold | Coverage | Accuracy |
|---:|---:|---:|
| 0.50 | 80.6% | 71.1% |
| 0.55 | 75.4% | 72.5% |
| 0.60 | 68.3% | 74.0% |
| 0.65 | 61.4% | 76.4% |
| 0.70 | 53.6% | 77.6% |
| 0.75 | 45.5% | 79.1% |
| 0.80 | 36.7% | 81.8% |
| 0.85 | 28.2% | 84.5% |
| 0.90 | 17.4% | 87.1% |

## Duration 30d

- threshold = 0.70, half_life = 360d, samples in CV = 1525
- coverage = **55.8%**
- unfiltered dir acc = **66.7%**
- filtered dir acc = **75.9%**

### Confusion matrix — unfiltered

|  | pred ↓ | pred ↑ |
|---|---:|---:|
| real ↓ | 602 | 334 |
| real ↑ | 174 | 415 |

### Confusion matrix — filtered (committed calls only)

|  | pred ↓ | pred ↑ |
|---|---:|---:|
| real ↓ | 350 | 151 |
| real ↑ | 54 | 296 |

### Regime slice (BTC 30d spot return)

| Regime | N | Unfiltered | Filtered | Coverage |
|---|---:|---:|---:|---:|
| bull | 285 | 62.8% | 69.8% | 56.8% |
| bear | 101 | 76.2% | 80.6% | 61.4% |
| chop | 1139 | 66.8% | 77.0% | 55.0% |

### Threshold sweep (conf ≥ t AND ridge agrees)

| Threshold | Coverage | Accuracy |
|---:|---:|---:|
| 0.50 | 81.7% | 67.4% |
| 0.55 | 75.9% | 69.8% |
| 0.60 | 70.2% | 71.9% |
| 0.65 | 64.5% | 72.9% |
| 0.70 | 55.8% | 75.9% |
| 0.75 | 47.5% | 78.0% |
| 0.80 | 36.7% | 81.8% |
| 0.85 | 28.3% | 86.8% |
| 0.90 | 19.6% | 90.3% |

## Duration 90d

- threshold = 0.70, half_life = 360d, samples in CV = 1495
- coverage = **57.1%**
- unfiltered dir acc = **69.1%**
- filtered dir acc = **75.6%**

### Confusion matrix — unfiltered

|  | pred ↓ | pred ↑ |
|---|---:|---:|
| real ↓ | 482 | 379 |
| real ↑ | 83 | 551 |

### Confusion matrix — filtered (committed calls only)

|  | pred ↓ | pred ↑ |
|---|---:|---:|
| real ↓ | 253 | 188 |
| real ↑ | 20 | 392 |

### Regime slice (BTC 30d spot return)

| Regime | N | Unfiltered | Filtered | Coverage |
|---|---:|---:|---:|---:|
| bull | 332 | 68.4% | 74.0% | 54.5% |
| bear | 86 | 72.1% | 81.0% | 67.4% |
| chop | 1077 | 69.1% | 75.6% | 57.0% |

### Threshold sweep (conf ≥ t AND ridge agrees)

| Threshold | Coverage | Accuracy |
|---:|---:|---:|
| 0.50 | 78.7% | 69.4% |
| 0.55 | 73.4% | 71.3% |
| 0.60 | 68.4% | 73.0% |
| 0.65 | 62.7% | 74.3% |
| 0.70 | 57.1% | 75.6% |
| 0.75 | 49.1% | 78.1% |
| 0.80 | 42.3% | 80.6% |
| 0.85 | 34.0% | 82.5% |
| 0.90 | 25.4% | 85.5% |

## Duration 180d

- threshold = 0.70, half_life = 360d, samples in CV = 1440
- coverage = **66.9%**
- unfiltered dir acc = **63.2%**
- filtered dir acc = **67.4%**

### Confusion matrix — unfiltered

|  | pred ↓ | pred ↑ |
|---|---:|---:|
| real ↓ | 483 | 451 |
| real ↑ | 79 | 427 |

### Confusion matrix — filtered (committed calls only)

|  | pred ↓ | pred ↑ |
|---|---:|---:|
| real ↓ | 344 | 299 |
| real ↑ | 15 | 306 |

### Regime slice (BTC 30d spot return)

| Regime | N | Unfiltered | Filtered | Coverage |
|---|---:|---:|---:|---:|
| bull | 339 | 60.5% | 68.9% | 61.7% |
| bear | 57 | 73.7% | 81.0% | 73.7% |
| chop | 1044 | 63.5% | 66.2% | 68.3% |

### Threshold sweep (conf ≥ t AND ridge agrees)

| Threshold | Coverage | Accuracy |
|---:|---:|---:|
| 0.50 | 82.4% | 62.1% |
| 0.55 | 78.5% | 63.7% |
| 0.60 | 74.7% | 65.1% |
| 0.65 | 71.0% | 66.5% |
| 0.70 | 66.9% | 67.4% |
| 0.75 | 61.5% | 67.9% |
| 0.80 | 54.5% | 68.7% |
| 0.85 | 48.1% | 70.1% |
| 0.90 | 39.2% | 73.5% |
