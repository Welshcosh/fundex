# Fundex — Funding Rate Swap Market on Solana

**English** | [한국어](./README.ko.md)

> **Seoulana WarmUp Hackathon 2026** | **Colosseum 2026 — DeFi & Payments Track**

Fundex is a fully on-chain fixed-for-floating interest rate swap (IRS) protocol that uses Solana's native perpetual funding rate as the underlying. Traders take **Fixed Payer** or **Fixed Receiver** positions across 16 markets (4 perps × 4 durations), and a permissionless **LP Pool** acts as counterparty for any net imbalance between the two sides.

Built solo as a reference implementation of a Solana-native funding rate swap primitive — categorically similar to [Pendle Boros](https://docs.pendle.finance/Boros) (Arbitrum, 2025) — with on-chain rate verification, sub-200k CU settlements, and a fixed rate curve backed by 12 months of historical backtesting (SOL-PERP, BTC-PERP).

**Live demo:** https://fundex-weld.vercel.app *(devnet)*

---

## Scope & Prior Art

Fundex is a **reference implementation**, not a production trading venue. Its purpose is to explore what a Solana-native, perp-native, oracle-free funding rate swap actually looks like.

**Prior art.** [Pendle Boros](https://docs.pendle.finance/Boros) (Arbitrum, early 2025) is the first production funding rate swap in this category, using Binance as its rate source. Pendle has officially announced Solana expansion on its 2025 roadmap. Fundex does not claim category novelty — it is an independent implementation that makes different architectural choices from the Solana-native angle:

- **On-chain rate source** — reads the perp market account's `lastFundingRate` directly, with program-owner verification for trustlessness. No off-chain oracle or relay.
- **Perp-native market mapping** — 1:1 mapping to Solana perp markets (BTC / ETH / SOL / JTO).
- **Per-market isolated vaults** — each market has its own USDC vault and LP pool. No cross-collateralization.
- **AMM-style dynamic fees** — imbalance-reducing trades pay 0 bps; imbalance-increasing trades pay 30–100 bps on a continuous curve.

**What this is not.** Fundex is not audited, has not been stress-tested with real LP capital, and makes no strong claim about funding rate hedging demand in the current market. 12 months of backtesting (see `data/funding/`) show SOL-PERP realized funding averaging **−5.03% APR** (longs actually receive funding) and BTC-PERP at **+5.18%** — far below the threshold where most traders would pay to hedge. Fundex is submitted as a technical reference for the IRS primitive; real product-market fit for funding rate swaps is an open question this project does not try to answer.

---

## What Is a Funding Rate Swap?

In a funding rate swap:

- **Fixed Payer** pays a fixed rate, receives the variable (live) funding rate → profits when rates **rise**
- **Fixed Receiver** receives a fixed rate, pays the variable rate → profits when rates **fall** (natural hedge for perp longs paying funding)

PnL settles every funding period based on the difference between the oracle EMA rate and the market's fixed rate:

```
PnL per settlement (Fixed Payer) = (variable_rate − fixed_rate) × notional
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        Solana Devnet                         │
│                                                              │
│  ┌──────────────┐    ┌────────────────────────────────────┐  │
│  │  RateOracle  │    │           MarketState              │  │
│  │  (per perp)  │───▶│      (per perp × duration)         │  │
│  │  EMA tracker │    │  fixedRate, cumulativeRateIndex    │  │
│  └──────┬───────┘    └──────────────┬─────────────────────┘  │
│         │                           │                         │
│  Crank  │ settle_funding()          │ open/close/liquidate   │
│  (bot)  │                           ▼                         │
│         │               ┌───────────────────────┐            │
│         └──────────────▶│       Position        │            │
│                         │  user, side, lots     │            │
│                         └───────────────────────┘            │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                    LP Pool                           │   │
│  │  PoolState + pool_vault (per market)                 │   │
│  │  • Absorbs net imbalance as counterparty             │   │
│  │  • Earns 0.3% fee on imbalance-increasing positions  │   │
│  │  • LPs deposit/withdraw USDC, receive pro-rata PnL  │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
         ▲
         │ live rates
┌────────┴────────┐
│  On-chain Perp   │  (Solana perp program, read-only)
│  lastFundingRate │
└─────────────────┘
```

### On-Chain Program (Anchor 0.32.1)

**Core Trading**

| Instruction | Description |
|-------------|-------------|
| `initialize_rate_oracle` | Create per-perp EMA oracle |
| `initialize_market` | Create a market (perp × duration), set fixed rate from oracle EMA |
| `open_position` | Deposit collateral, open Fixed Payer or Fixed Receiver position |
| `settle_funding` | Update cumulative rate index + oracle EMA (crank) |
| `close_position` | Realise PnL, return collateral |
| `liquidate_position` | Permissionless liquidation when margin < 5% |
| `close_market` | Admin closes a market once all positions are unwound |

**LP Pool**

| Instruction | Description |
|-------------|-------------|
| `initialize_pool` | Create PoolState + pool_vault for a market |
| `deposit_lp` | Deposit USDC into pool, receive pro-rata shares |
| `withdraw_lp` | Redeem shares for USDC |
| `sync_pool_pnl` | Settle pool P&L — transfers USDC between user_vault and pool_vault based on net imbalance |
| `close_pool` | Admin closes an LP pool when all shares are withdrawn |

### State Accounts

| Account | Seeds | Description |
|---------|-------|-------------|
| `RateOracle` | `[rate_oracle, perp_index]` | EMA of on-chain perp funding rates |
| `MarketState` | `[market, perp_index, duration]` | Per-market state, rates, OI |
| `Position` | `[position, user, market]` | Per-user per-market position |
| `Vault` | `[vault, market]` | Isolated USDC vault per market (user collateral) |
| `PoolState` | `[pool, market]` | LP pool state — shares, last sync index |
| `LpPosition` | `[lp_position, user, pool]` | Per-LP share balance |
| `PoolVault` | `[pool_vault, market]` | Isolated USDC vault per market (LP liquidity) |

### Key Parameters

| Parameter | Value |
|-----------|-------|
| Initial margin | 10% of notional |
| Maintenance margin | 5% of notional |
| Liquidation reward | 3% of notional |
| LP base fee | 0.3% of notional |
| LP max fee (fully imbalanced) | 1.0% of notional |
| Lot size | 100 USDC notional |
| Durations | 7D / 30D / 90D / 180D |
| Settlement interval | 1h (enforced on devnet and mainnet) |

---

## LP Pool — How It Works

The LP Pool solves the cold-start liquidity problem inherent to peer-to-peer funding rate swaps.

**Without LP Pool:**
- If payer_lots ≠ receiver_lots, unmatched positions have no counterparty
- Vault can be drained if imbalance is large and rates move against the minority side

**With LP Pool:**
1. LPs deposit USDC → receive shares proportional to pool value
2. Pool automatically acts as counterparty for the net imbalance:
   - `payer_lots > receiver_lots` → pool is the virtual receiver for the difference
   - `receiver_lots > payer_lots` → pool is the virtual payer for the difference
3. `sync_pool_pnl` (permissionless) settles accumulated P&L by transferring USDC between vaults
4. **AMM-style dynamic fee** is charged on positions that increase imbalance → goes directly to pool_vault
5. LPs withdraw their proportional share of the pool at any time

**LP P&L:**
```
pool_pnl = -(net_lots) × rate_delta × notional_per_lot / precision
```

LPs earn when the rate moves in their favor (opposite to the imbalanced side) plus the dynamic fee stream.

---

## AMM-Style Dynamic Fee

Fundex uses a dynamic LP fee modeled on Uniswap v3's concentrated liquidity fee tiers, but adapted for funding rate imbalance:

```
imbalance_ratio = |payer_lots − receiver_lots| / (payer_lots + receiver_lots)
fee_bps = 30 + imbalance_ratio × 70
```

| Market State | Fee |
|---|---|
| Perfectly balanced | 0.3% (base) |
| 50% imbalanced | ~0.65% |
| Fully imbalanced (one side only) | 1.0% (max) |

- **Imbalance-increasing position**: pays the dynamic fee
- **Imbalance-reducing position**: pays 0.0% (incentivized to balance the market)

This creates a natural AMM mechanism: arbitrageurs earn zero-fee entry on the minority side, while the imbalanced side faces increasing cost — naturally pushing the market back toward balance without active management.

---

## On-Chain Rate Verification

Fundex reads funding rates **directly from the on-chain perp market account** — no trusted off-chain input.

```
settle_funding():
  1. Verify perp_market.owner == EXPECTED_PERP_PROGRAM_ID
  2. Read lastFundingRate       (i64) at byte offset 480
     Read lastFundingOracleTwap (i64) at byte offset 968
  3. Convert (i128-safe):
       fundex_rate = lastFundingRate × 1_000 / lastFundingOracleTwap
     (lastFundingRate is stored as quote-per-base in FUNDING_RATE_PRECISION
      1e9, not as a rate — recovering a per-hour fraction requires dividing by
      the oracle TWAP; final scale lands in Fundex's 1e6/h precision.)
  4. Clamp to ±MAX_FIXED_RATE_ABS (±50% per hour)
```

The crank passes the perp market PDA as an account — the program verifies the account's owner and reads the rate trustlessly. This removes the need for a trusted oracle or off-chain rate relay. See `docs/WHITEPAPER.md` §5 for the full derivation and §11 for the April 2026 postmortem on the original (incorrect) formula.

**Perp market mapping:**

| Fundex perpIndex | Asset | Source marketIndex | Devnet PDA |
|---|---|---|---|
| 0 | BTC-PERP | 1 | `2UZMvVT…` |
| 1 | ETH-PERP | 2 | `25Eax9W…` |
| 2 | SOL-PERP | 0 | `8UJgxai…` |
| 3 | JTO-PERP | 20 | `FH6CkSY…` |

---

## Funding Rate Term Structure (Yield Curve)

Fundex offers 4 duration maturities (7D / 30D / 90D / 180D) for each underlying. The fixed rates across durations form a **funding rate yield curve** — analogous to interest rate term structures in TradFi (and to Pendle's PT yield curves on the spot side, but applied to perpetual funding instead of staking yields).

The markets page visualizes this curve in real-time, showing:
- **Normal curve** — longer durations price in higher expected rates
- **Inverted curve** — short-term rates exceed long-term (crowded payer positioning)
- **Flat curve** — market expects stable rates

This enables term-structure trading strategies — e.g. long the short end and short the long end if you expect rates to mean-revert — which require a multi-maturity venue.

---

## AI-Powered Trading Intelligence

Fundex combines Claude Haiku with a small ML ensemble to provide a trading assistant, rate advisor, and position risk scoring.

### AI Rate Advisor

An ML ensemble trained on **Binance perpetual funding rate history** (2019–present) predicts rate direction and recommends an appropriate fixed rate.

```
Input:  Current oracle rate + market stats (MAs, volatility, Fear & Greed, BTC cross signals)
     ↓
ML:    Ridge (magnitude, log-ratio) + Logistic (direction) + LightGBM (direction)
     ↓
Signal: Emitted when avg Logistic/LightGBM probability ≥ 70% AND agrees with Ridge direction
     ↓
Output: Predicted rate, direction (↑/↓/→), confidence, reasoning (Claude Haiku)
```

| Duration | Model | Directional Accuracy (out-of-sample) |
|----------|-------|---------------------|
| 7-day    | Ridge + Logistic + LightGBM | **75.7%** |
| 30-day   | Ridge + Logistic + LightGBM | **76.7%** |
| 90-day   | Ridge + Logistic + LightGBM | **63.5%** |
| 180-day  | Ridge + Logistic + LightGBM | **62.7%** |

Accuracy figures are from purged walk-forward CV on Binance BTC/ETH/SOL perp funding history (2019-09 → 2026-04). The 90/180-day horizons are harder by design — funding-rate signal decays with prediction horizon. See `app/public/charts/ml-dir-accuracy.png` for the comparison against a Ridge+Logistic baseline.

**Features (24 dims)**: log-transformed rate, z-scores (7d/30d), volatility ratio, trend, BTC cross momentum, BTC z30, Fear & Greed normalize/trend, one-hot market encoding.

Ridge + Logistic coefficients are exported as JSON and run via JS dot-product inference; LightGBM runs through `onnxruntime-node` in Node.js — no Python runtime needed in production. Results are memoized in a per-process LRU cache (15 min TTL).

### AI Risk Scoring

Each open position is scored 0–100 by Claude, with inputs:

- **Position state** — side, margin ratio (bps), unrealized PnL, collateral, days to expiry
- **Live market context** — current oracle rate vs. position's fixed rate (favorable/unfavorable classification), and live payer / receiver OI lot counts for the position's (perp × duration) market, passed in directly from the `useMarketData` hook
- **Cache key quantization** — margin 50bps, rate 1M Fundex unit, expiry 0.5d, notional 100 USD, payer-share 10% buckets. The LLM is only re-called when a meaningful change crosses a bucket boundary.

| Score | Level | Meaning |
|-------|-------|---------|
| 0–30  | Low   | Healthy margin, favorable rate direction |
| 31–60 | Medium | Watch closely — rate or margin pressure |
| 61–100 | High | Near liquidation or severe adverse conditions |

### AI Trading Assistant

A conversational chat interface (bottom-right floating panel) that answers questions about:
- Current market conditions and rate outlook
- Trading strategies (hedging, speculation)
- How funding rate swaps work
- Position-specific advice

The assistant sees **live market context** (current variable/fixed rates, OI imbalance) from whatever market the user is viewing.

### API Routes

| Route | Model | Purpose |
|-------|-------|---------|
| `POST /api/ai/rate-advisor` | ML ensemble + Claude Haiku | Rate prediction + reasoning |
| `POST /api/ai/risk` | Claude Haiku | Position risk scoring |
| `POST /api/ai/chat` | Claude Haiku | Trading assistant chat |

---

## Tech Stack

| Layer | Tech |
|-------|------|
| On-chain | Anchor 0.32.1, Rust, Solana |
| Frontend | Next.js 16, TypeScript, Tailwind CSS v4 |
| Wallet | `@solana/wallet-adapter` |
| Rate source | Solana-native perp funding rate — read on-chain directly |
| AI | Claude Haiku (Anthropic) + custom ML ensemble |
| ML Training | Python, scikit-learn, Binance API |
| USDC | Custom SPL mock mint (devnet) |

---

## Project Structure

```
fundex/
├── programs/fundex/src/       # Anchor program (Rust)
│   ├── instructions/          # 12 instruction handlers
│   │   ├── open_position.rs   # Includes 0.3% LP fee logic
│   │   ├── initialize_pool.rs
│   │   ├── deposit_lp.rs
│   │   ├── withdraw_lp.rs
│   │   └── sync_pool_pnl.rs
│   ├── state.rs               # RateOracle, MarketState, Position, PoolState, LpPosition
│   ├── constants.rs           # Margin bps, LP_FEE_BPS, perp program ID, seeds
│   └── errors.rs              # Custom error codes
├── tests/fundex.ts            # Integration tests
├── scripts/
│   ├── setup-devnet.ts        # One-shot devnet bootstrap
│   ├── init-pools.ts          # Initialize LP pools for all 16 markets
│   ├── crank-devnet.ts        # Demo crank (mock rates, 1-min intervals)
│   ├── crank.ts               # Production crank (live on-chain rates)
│   ├── liquidator.ts          # Permissionless liquidator bot
│   └── train-rate-model-v2.py # ML model training (Binance funding rates + purged walk-forward CV)
├── sdk/src/                   # TypeScript client SDK
│   ├── client.ts              # All instructions + fetch methods incl. LP
│   └── pda.ts                 # PDA derivation helpers
└── app/                       # Next.js frontend
    └── src/
        ├── app/               # Pages + API routes (/api/ai/*)
        ├── components/        # TradeHeader, OrderPanel, RateAdvisor, TradingAssistant, etc.
        ├── hooks/             # useMarketData, usePositions, useRiskScore
        └── lib/fundex/        # Client SDK, constants, IDL, rate-model.json
```

---

## Deployed Contracts (Devnet)

| Item | Address |
|------|---------|
| Program ID | `BVyfQfmD6yCXqgqGQm6heYg85WYypqVxLnxb7MrGEKPb` |
| USDC Mint | `BqLbRiRvDNMzryGjtAh9qn44iM4F2VPD3Df7m4MsV5e4` |
| Markets | 16 active (BTC/ETH/SOL/JTO × 7D/30D/90D/180D) |
| LP Pools | 16 active (one per market) |

---

## Local Development

### Prerequisites

```bash
# Solana CLI ≥ 1.18
solana --version

# Anchor CLI 0.32.1
anchor --version

# Node ≥ 18
node --version
```

### 1. Install dependencies

```bash
# Root (Anchor + scripts)
yarn install

# Frontend
cd app && npm install
```

### 2. Run the frontend

```bash
cd app
cp .env.local.example .env.local   # copy env template
npm run dev
# → http://localhost:3000
```

### 3. Run the demo crank (separate terminal)

```bash
# Settle all 16 markets every 60 seconds with mock rates
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
yarn ts-node -P tsconfig.json scripts/crank-devnet.ts
```

### 4. Full devnet bootstrap (fresh deployment)

```bash
# Configure Solana for devnet
solana config set --url devnet
solana airdrop 2

# Build + deploy
anchor build
anchor deploy --provider.cluster devnet

# Initialize oracles + markets
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
yarn ts-node -P tsconfig.json scripts/setup-devnet.ts

# Initialize LP pools for all 16 markets
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
yarn ts-node -P tsconfig.json scripts/init-pools.ts
```

### 5. Run tests (localnet)

```bash
anchor test
```

---

## Frontend `.env.local`

```bash
NEXT_PUBLIC_USDC_MINT=BqLbRiRvDNMzryGjtAh9qn44iM4F2VPD3Df7m4MsV5e4
ADMIN_SECRET_KEY=[...your admin keypair JSON array...]
ANTHROPIC_API_KEY=sk-ant-...your-api-key...
```

- `ADMIN_SECRET_KEY` — required for the `/api/faucet` endpoint to mint devnet USDC
- `ANTHROPIC_API_KEY` — required for AI features (Rate Advisor, Risk Score, Trading Assistant)

---

## Demo Walkthrough

### Trading

1. Open the app → **[Launch App]**
2. Connect your Solana wallet (Phantom, Backpack, etc.)
3. Click **"Get 1000 USDC"** in the order panel to receive devnet USDC
4. Select a market (e.g. SOL-PERP 30D)
5. Choose **Fixed Payer** (long funding rate) and set lot size
6. Click **"Open Fixed Payer"** → confirm wallet transaction
7. Watch PnL update in the Positions tab as the crank settles every minute
8. Click **"Close"** to realise PnL and withdraw collateral

### AI Features

1. On the trade page, check the **AI Rate Advisor** panel in the sidebar — it shows predicted rate direction, recommended fixed rate, and confidence level
2. In the **Positions** tab, each open position shows an **AI Risk Score** (0–100) with color-coded badge
3. Click the **AI Assistant** button (bottom-right) to ask questions like:
   - "Should I go long or short on SOL funding rates?"
   - "How can I hedge my perp position with Fundex?"
   - "What's the current market outlook for BTC rates?"

### Providing Liquidity

1. Navigate to **[Pool]** tab
2. Select a market pool
3. Click **"Provide Liquidity"** → deposit USDC → receive LP shares
4. Earn 0.3% fee on every imbalance-increasing position opened in that market
5. Click **"Manage Position"** → **Withdraw** to redeem shares for USDC

---

## License

MIT
