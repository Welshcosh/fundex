# Fundex — A Solana-Native Funding Rate Swap Primitive

**Version 0.1** · 2026-04-15 · Devnet Reference Implementation
Colosseum 2026 — DeFi & Payments Track

---

## Abstract

Fundex is an on-chain fixed-for-floating interest rate swap (IRS) protocol that uses **Drift Protocol's perpetual funding rates** as the floating underlying. Traders open **Fixed Payer** or **Fixed Receiver** positions across 16 markets (4 perps × 4 maturities) and settle PnL every hour against the realized Drift funding rate. A permissionless LP Pool acts as the residual counterparty for any imbalance between the two sides.

Fundex is submitted as a **reference implementation** of the primitive, not a production trading venue. Its focus is the Solana-native architecture: on-chain rate verification against Drift's `PerpMarket` account (no off-chain oracle or relay), per-market isolated vaults, ~8k CU per settlement (measured on devnet), and an AMM-style dynamic fee curve that self-balances directional imbalance.

---

## 1. Problem

Perpetual futures dominate crypto derivatives volume, but **funding rate risk has no native hedging instrument**. A trader holding a leveraged long on a perp pays (or receives) funding at rates that can swing from −200% APR to +200% APR within a day. The only tools available today are:

1. **Close the perp** — eliminates the funding exposure but also the price exposure.
2. **Delta-hedge with spot** — neutralizes price but still pays funding.
3. **Trade on Pendle Boros (Arbitrum, 2025)** — a funding rate swap, but uses Binance as the rate source and is not on Solana.

On Solana, where Drift is the largest on-chain perp venue, there is no native venue to isolate and trade the funding rate component. Fundex is a reference implementation of what that primitive looks like when built Solana-native, Drift-native, and free of any off-chain rate relay.

---

## 2. Prior Art and Positioning

**Pendle Boros** (Arbitrum, early 2025) is the first production funding rate swap in this category. Fundex does not claim category novelty. Refer to the [Pendle Boros docs](https://docs.pendle.finance/Boros) for Boros's own mechanics; Fundex's positioning is defined below on its own terms, not by comparison:

| Dimension | Fundex |
|---|---|
| Chain | Solana |
| Rate source | Drift `PerpMarket` account (on-chain, owner-verified) — no off-chain relay |
| Counterparty | Per-market LP Pool + direct P2P matching |
| Fee curve | AMM-style dynamic (0.30 – 1.00%, imbalance-weighted) |
| Settlement cadence | Hourly, matching Drift's funding interval |

Fundex is written as a reference implementation — small enough to read end-to-end (~1.7k lines of Rust across 13 instructions), aggressive about minimizing trust assumptions, and explicit about what it does *not* solve (see §11).

---

## 3. Protocol Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        Solana Devnet                         │
│                                                              │
│  ┌──────────────┐    ┌────────────────────────────────────┐  │
│  │  RateOracle  │    │           MarketState              │  │
│  │  (per perp)  │───▶│      (per perp × duration)         │  │
│  │  EMA tracker │    │  fixedRate, cumulativeIndices      │  │
│  └──────┬───────┘    └──────────────┬─────────────────────┘  │
│         │                           │                        │
│  Crank  │ settle_funding()          │ open/close/liquidate  │
│  (bot)  │                           ▼                        │
│         │               ┌───────────────────────┐            │
│         └──────────────▶│       Position        │            │
│                         │  user, side, lots     │            │
│                         └───────────────────────┘            │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                    LP Pool                           │   │
│  │  PoolState + pool_vault (per market)                 │   │
│  │  • Absorbs net imbalance as counterparty             │   │
│  │  • Earns 0.3–1.0% dynamic fee on directional flow    │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
         ▲
         │ live rates (on-chain read)
┌────────┴────────┐
│  Drift Protocol │  (read-only PerpMarket account)
│  lastFundingRate│
│  lastFundingOracleTwap │
└─────────────────┘
```

### 3.1 State Accounts

| Account | Seeds | Purpose |
|---|---|---|
| `RateOracle` | `[rate_oracle, perp_index]` | EMA of realized funding rates, shared across durations |
| `MarketState` | `[market, perp_index, duration]` | Fixed rate, cumulative indices, OI, expiry |
| `Position` | `[position, user, market]` | User's open position (side, lots, entry indices) |
| `Vault` | `[vault, market]` | Isolated USDC vault for trader collateral |
| `PoolState` | `[pool, market]` | LP shares, last sync index, realized pool PnL |
| `LpPosition` | `[lp_position, user, pool]` | Per-LP share balance |
| `PoolVault` | `[pool_vault, market]` | Isolated USDC vault for LP liquidity |

**Isolation property.** Every market has its own user vault and its own pool vault. Losses in one market cannot drain collateral from another. This trades capital efficiency for simplicity and safety — a deliberate choice for a reference implementation.

### 3.2 Instructions (13 total)

**Core trading (7):** `initialize_rate_oracle`, `initialize_market`, `open_position`, `settle_funding`, `close_position`, `liquidate_position`, `close_market`
**LP pool (5):** `initialize_pool`, `deposit_lp`, `withdraw_lp`, `sync_pool_pnl`, `close_pool`
**Admin (1):** `admin_reset_oracle` — resets `RateOracle` EMA after a rate-formula bug fix; gated by market admin.

---

## 4. Protocol Mechanics

### 4.1 Fixed-for-Floating Swap

A Fundex position is a promise to exchange a stream of rates over the life of the market:

- **Fixed Payer** pays `fixed_rate × notional` each hour, receives `actual_rate × notional`.
- **Fixed Receiver** does the reverse.

Per-settlement PnL:

```
PnL(Fixed Payer)    = (actual_rate − entry_fixed_rate) × notional
PnL(Fixed Receiver) = (entry_fixed_rate − actual_rate) × notional
```

Both are priced in Fundex's rate precision: **1e6 = 100% per hour**. Settlement runs once per hour (`FUNDING_INTERVAL = 3_600s`), so per-hour rates accumulate directly with no time-scaling multiplier.

### 4.2 Cumulative Index Accounting

To avoid walking every position on every settlement, Fundex uses two cumulative indices per market:

```
cumulative_actual_index += actual_rate    (at each settle_funding)
cumulative_fixed_index  += market.fixed_rate  (at each settle_funding)
```

A position records `entry_actual_index` and `entry_fixed_index` at `open_position`. Its realized PnL on close is:

```
Δ_actual = cumulative_actual_index − entry_actual_index
Δ_fixed  = cumulative_fixed_index  − entry_fixed_index

PnL(Fixed Payer)    = (Δ_actual − Δ_fixed) × notional / RATE_PRECISION
PnL(Fixed Receiver) = (Δ_fixed − Δ_actual) × notional / RATE_PRECISION
```

**The fixed leg is accumulated per market, not per position.** Each settlement adds the *current* `market.fixed_rate` to `cumulative_fixed_index`. This means a position's PnL is cleanly isolated from any history *before* it opened (the `Δ` formulation cancels it out), but it is **not** frozen to the fixed rate at which it opened: if `fixed_rate` re-anchors mid-life (see §4.3), the position's subsequent `Δ_fixed` accumulates at the new rate.

This is a deliberate design choice, not an oversight. Fundex markets are short-to-medium duration (7–180 days), and continuously re-anchoring `fixed_rate` to the oracle EMA keeps the mark-to-market spread close to fair value. Traders who want a rate locked for the full duration can close and re-open, or hold to expiry; traders who want exposure to rate *volatility* rather than a single forward curve point get it for free under this model. A future version could add an optional per-position `entry_fixed_rate` snapshot for swap-like behavior — see §12.

### 4.3 Fixed Rate Discovery

Each market is initialized with a fixed rate copied from the shared `RateOracle`'s EMA. As `settle_funding` accumulates new observations, the oracle EMA updates:

```
EMA ← (sample + (w − 1) × EMA) / w    where w = EMA_WINDOW = 10
```

Once the oracle has at least `MIN_ORACLE_SAMPLES = 24` observations, `settle_funding` re-anchors `market.fixed_rate` to the clamped EMA on every interval. New positions always enter at the latest EMA-backed fair value. Existing positions retain their full PnL accrued *up to* the re-anchor (via the cumulative-index `Δ` mechanism), and from that point forward accrue at the new rate — see the second paragraph of §4.2.

---

## 5. On-Chain Rate Verification

Fundex's central technical claim: **the floating rate is read from Drift's `PerpMarket` account on-chain, not from an off-chain oracle or relay.** `settle_funding` takes the Drift account as an `UncheckedAccount`, verifies its owner is the Drift program, and reads two fields at known byte offsets.

### 5.1 The Raw Drift Fields

Drift stores funding state in `PerpMarket.amm`:

| Field | Byte offset | Unit |
|---|---|---|
| `last_funding_rate` | 480 | i64, **quote-per-base in FUNDING_RATE_PRECISION (1e9)** |
| `last_funding_oracle_twap` | 968 | i64, price × 1e6 |

The non-obvious part is that `last_funding_rate` is *not* a rate — it's a quote-denominated funding amount per unit base, stored in 1e9 precision. To recover a per-hour rate you must divide by the oracle TWAP:

```
rate_per_hour (fraction) = (last_funding_rate / 1e9) / (twap / 1e6)
                         = last_funding_rate / (1e3 × twap)
```

Fundex stores rates in 1e6 = 100%/h precision, so the final conversion is:

```
fundex_rate = last_funding_rate × 1_000 / twap   (i128-safe)
```

The naive conversion `last_funding_rate / 1_000` treats the raw field as if it were already a rate and inflates displayed APR by ~4 orders of magnitude. This was the original implementation; see §11 for the postmortem.

### 5.2 Trust Boundary

```rust
let drift_acct = &ctx.accounts.drift_perp_market;
let expected_owner = Pubkey::new_from_array(DRIFT_PROGRAM_ID_BYTES);
require!(drift_acct.owner == &expected_owner, FundexError::InvalidDriftAccount);

let data = drift_acct.try_borrow_data()?;
let rate = i64::from_le_bytes(data[480..488].try_into()?);
let twap = i64::from_le_bytes(data[968..976].try_into()?);
require!(twap > 0, FundexError::InvalidDriftAccount);

let scaled = (rate as i128).checked_mul(1_000).ok_or(MathOverflow)?;
let actual_rate: i64 = (scaled / (twap as i128)).try_into().map_err(|_| MathOverflow)?;
let actual_rate = actual_rate.clamp(-MAX_FIXED_RATE_ABS, MAX_FIXED_RATE_ABS);
```

The trust boundary here is **owner verification against the well-known Drift program ID** plus the pinned byte-offset read. As long as Drift's program layout is stable and the program ID is correct, there is no off-chain trust — the rate is whatever Drift most recently wrote into its own account.

**Known gap.** The current implementation does *not* cross-validate that the passed Drift `PerpMarket` matches the Fundex `market.perp_index`. A crank could pass BTC's Drift market to Fundex's SOL market and the owner check would still succeed, producing a settlement against the wrong underlying. This is a correctness hole, not a fund-loss hole — the worst case is that a crank bug (or malicious crank) settles the wrong rate into a market; positions still only hold collateral they deposited. Fix requires decoding `PerpMarket.market_index` at its own byte offset and comparing it to `market.perp_index`. Tracked in §12.

### 5.3 Drift Market Mapping

| Fundex `perp_index` | Asset | Drift `market_index` |
|---|---|---|
| 0 | BTC-PERP | 1 |
| 1 | ETH-PERP | 2 |
| 2 | SOL-PERP | 0 |
| 3 | JTO-PERP | 20 |

---

## 6. LP Pool — Residual Counterparty

Funding rate swaps are two-sided markets: for every Fixed Payer there must be an equivalent Fixed Receiver. In practice one side is almost always thicker than the other. Without a residual counterparty, a 60/40 imbalance means the minority side has no trade to take and the market effectively closes.

Fundex solves this with a per-market **LP Pool**:

1. LPs deposit USDC to `pool_vault`, receive pro-rata shares in `PoolState`.
2. At any given moment, the pool acts as the virtual counterparty for exactly `|payer_lots − receiver_lots|` lots on the thinner side.
3. `sync_pool_pnl` is a permissionless instruction that settles the pool's P&L by moving USDC between `user_vault` and `pool_vault` based on the change in cumulative rate indices since the pool's last sync.
4. The dynamic fee (§7) flows directly into `pool_vault` at every `open_position`.

Pool PnL, in closed form:

```
pool_pnl = −(net_lots) × (Δ_actual − Δ_fixed) × notional_per_lot / 1_000_000
```

The divisor is the Fundex rate precision (1e6 = 100%/h). The source constant is named `DRIFT_PRICE_PRECISION` in `constants.rs` — a misnomer left over from early development; the value is the Fundex rate precision, unrelated to Drift's own price precision. Both happen to be 1e6, so the code is numerically correct but the name is misleading. Tracked in §12 as a rename.

LPs earn when rates move against the imbalanced (majority) side, plus the continuous dynamic fee stream. They lose when rates move with the imbalanced side faster than fees accumulate. No impermanent-loss-style divergence math — the risk is purely directional funding rate exposure in proportion to imbalance.

---

## 7. AMM-Style Dynamic Fee

A flat fee is the wrong incentive for an imbalanced market. Fundex instead charges a fee proportional to how much a trade *worsens* the pool's imbalance.

```
imbalance_ratio = |payer_lots − receiver_lots| / (payer_lots + receiver_lots)
fee_bps = 30 + imbalance_ratio × 70
```

| State | Fee |
|---|---|
| Perfectly balanced | 0.30% (base) |
| 50% imbalanced | ~0.65% |
| Fully one-sided | 1.00% (cap) |

- **Imbalance-increasing trade** → pays the full dynamic fee.
- **Imbalance-reducing trade** → pays **0 bps**.

This creates a self-balancing incentive: when imbalance is severe, entering on the minority side is free and entering on the majority side is maximally expensive. Arbitrageurs who take the free side earn the entry discount plus the expected directional edge on the rate. No active management is required.

---

## 8. Margin and Liquidation

| Parameter | Value |
|---|---|
| Initial margin | 10% of notional |
| Maintenance margin | 5% of notional |
| Liquidator reward | 3% of notional (from remaining collateral) |
| Max fixed-rate magnitude | ±50% per hour (prevents index overflow) |
| Lot size | 100 USDC |
| Durations | 7D / 30D / 90D / 180D |

Liquidation is permissionless. Any wallet may call `liquidate_position` once `equity / notional < 5%`. The liquidator receives the 3% reward from the position's collateral; the rest is returned to the user. This mirrors the Drift liquidation model at a smaller scale.

---

## 9. Term Structure

Each underlying has 4 duration maturities (7D / 30D / 90D / 180D), producing a **funding rate yield curve** analogous to a TradFi rates curve. The Markets page visualizes it live. This enables:

- **Term-structure trades** — long the short end, short the long end if you expect mean reversion.
- **Duration-matched hedges** — a trader running a 30-day perp thesis can hedge with the 30D market.
- **Curve-shape signals** — inverted curves typically coincide with crowded payer positioning.

All durations share the same `RateOracle` per perp, so the curve reflects differential `fixed_rate` pricing at initialization plus whatever path-dependence emerges as different markets re-anchor at different times.

---

## 10. AI Layer

Fundex ships three AI features. All three are wrappers, not core protocol logic — they exist to improve UX and to make the rate curve legible to traders who aren't already thinking in funding-rate terms.

**Rate Advisor.** An ML ensemble (Ridge regression for magnitude, Logistic regression + LightGBM for direction) trained on 2019→present Binance BTC/ETH/SOL perp funding history. Out-of-sample directional accuracy from purged walk-forward CV:

| Horizon | Accuracy |
|---|---|
| 7-day | 75.7% |
| 30-day | 76.7% |
| 90-day | 63.5% |
| 180-day | 62.7% |

Ridge + Logistic coefficients ship as JSON and run via JS dot-product; LightGBM runs through `onnxruntime-node`. No Python runtime in production.

**Risk Scoring.** Each open position is scored 0–100 by Claude Haiku, given margin ratio, unrealized PnL, days to expiry, current vs. entry rate, and live OI imbalance. Cache keys are quantized so the LLM is only re-called when a bucket boundary is crossed.

**Trading Assistant.** A conversational chat bound to the market context the user is viewing. Answers questions about market conditions, hedging strategies, and protocol mechanics.

---

## 11. Scope and Limitations

This section exists because the protocol is a reference implementation, not a claim of product-market fit.

- **Devnet only.** No mainnet deployment is planned in the current scope.
- **No audit.** The code is small and readable but has not been reviewed by a third party.
- **Prior-art category.** Pendle Boros on Arbitrum predates Fundex. Pendle has announced Solana expansion on its 2025 roadmap. Fundex is an independent implementation, not a claim of being first.
- **Open demand question.** 12 months of historical data (`data/funding/`) show SOL-PERP realized funding averaging −5.03% APR (longs *receive*) and BTC-PERP +5.18% APR. At these magnitudes most traders would not pay to hedge. Fundex does not claim these rates justify a product; it only provides the primitive.
- **Rate-formula fragility.** The Drift field layout is pinned by byte offset. If Drift changes its `amm` account layout in a major version bump, `settle_funding` breaks until the offsets are updated. A code-level breaking change caught by runtime ownership checks — not silent corruption — but still a tight coupling.
- **Oracle formula bug (resolved 2026-04-15).** An earlier version of `settle_funding` treated `last_funding_rate` as if it were already a rate, producing displayed APRs of ~236,000% on BTC. Root cause: misreading the Drift IDL — the field is quote-per-base in `FUNDING_RATE_PRECISION` (1e9), not a rate. Fix: divide by `last_funding_oracle_twap` (§5.1), and add an `admin_reset_oracle` instruction to purge EMA samples computed with the wrong formula. Deployed on devnet the same day. The bug is disclosed here because the whole point of §11 is to make fragility explicit.
- **Drift account binding gap.** `settle_funding` does not cross-check the passed Drift `PerpMarket` against the Fundex `perp_index`. See §5.2 for the impact model and §12 for the fix.

---

## 12. Future Work

Documenting direction, not promising delivery.

1. **Drift market-index binding.** Close the §5.2 gap by decoding `PerpMarket.market_index` at its byte offset and requiring equality with `market.perp_index`. Mechanically trivial, materially improves correctness.
2. **Drift layout decoupling.** Replace byte-offset reads with a narrow IDL-backed reader so a Drift account-layout bump does not immediately break `settle_funding`.
3. **Rename `DRIFT_PRICE_PRECISION` → `RATE_PRECISION`.** The current name is a misnomer (see §6) — it is the Fundex rate precision, not Drift's price precision.
4. **Optional entry-rate snapshot.** Let a position choose at open time between the current "re-anchoring" behavior and a "locked rate" mode that stores `entry_fixed_rate` and computes PnL as `(Δ_actual − entry_fixed_rate × elapsed_settlements)`. Restores swap-like semantics for traders who want them (see §4.2).
5. **Cross-margin across durations.** The isolated-vault model is safe but capital-inefficient. A same-perp cross-margin account would let a trader net offsetting positions across maturities.
6. **Liquidation keeper economics.** The 3% reward is flat; a utilization-weighted reward would better match keeper incentives during stress events.
7. **Real-rate stress backtests.** Replay the 12 months of historical rates against a simulated order-flow generator to characterize LP P&L distributions under extreme imbalances.
8. **Options on the rate curve.** A natural extension once the underlying IRS primitive is stable: short-dated options on the Fundex fixed-rate index, cash-settled against `RateOracle.ema_funding_rate`.

---

## Appendix A — Key Parameters

| Parameter | Value | Rationale |
|---|---|---|
| `RATE_PRECISION` | 1e6 | 100% per hour = 1e6 |
| `FUNDING_INTERVAL` | 3600 s | Matches Drift's hourly funding rhythm |
| `EMA_WINDOW` | 10 | α = 0.1 → half-life ≈ 6.6 samples ≈ 6.6h at hourly cadence; smooths Drift noise without lagging regime changes |
| `MIN_ORACLE_SAMPLES` | 24 | Minimum 24h of data before `fixed_rate` tracks EMA |
| `MAX_FIXED_RATE_ABS` | 500_000 (50%/h) | Clamp to prevent cumulative-index overflow |
| `INITIAL_MARGIN_BPS` | 1000 (10%) | |
| `MAINT_MARGIN_BPS` | 500 (5%) | |
| `LIQUIDATION_REWARD_BPS` | 300 (3%) | |
| `LP_FEE_BPS` | 30 (0.30%) | Base fee when balanced |
| `MAX_IMBALANCE_FEE_BPS` | 70 (0.70%) | Additional fee at full imbalance → 1.0% cap |
| `NOTIONAL_PER_LOT_USDC` | 100 | Smallest trade unit |

## Appendix B — Deployment (Devnet)

| Item | Value |
|---|---|
| Program ID | `BVyfQfmD6yCXqgqGQm6heYg85WYypqVxLnxb7MrGEKPb` |
| USDC Mint (mock) | `BqLbRiRvDNMzryGjtAh9qn44iM4F2VPD3Df7m4MsV5e4` |
| Markets | 16 active (4 perps × 4 durations) |
| LP Pools | 16 active |
| Rate source | Drift Protocol v2 PerpMarket accounts |
| App | https://fundex-weld.vercel.app |

## Appendix C — Measured Compute Units

All numbers from `meta.computeUnitsConsumed` on confirmed devnet transactions. Full table at `docs/benchmarks/cu-table.md`.

| Instruction | Samples | Mean CU | Range |
|---|---:|---:|---|
| `settle_funding` | 32 | **8,091** | 7,765 – 8,217 |
| `initialize_market` | 16 | 22,053 | 18,865 – 30,865 |
| `initialize_rate_oracle` | 4 | 8,761 | 7,261 – 10,261 |
| `open_position` / `close_position` / `liquidate_position` | — | *pending* | measured once `MIN_ORACLE_SAMPLES = 24` is reached and a full trade flow runs |
| `deposit_lp` / `withdraw_lp` / `sync_pool_pnl` | — | *pending* | measured after first LP seed + post-settlement sync |

At ~8k CU, `settle_funding` consumes ≈ 4% of the default 200k per-transaction budget and ≈ 0.017% of Solana's 48M block budget. All 16 markets can be settled inside one transaction or trivially in parallel.
