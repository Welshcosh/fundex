# Fundex — Funding Rate Swap Market on Solana

> **Seoulana WarmUp Hackathon 2026**

Fundex is a fully on-chain funding rate swap (FRS) market built on Solana. Traders can go **long or short on perpetual funding rates** — hedging their perp positions or speculating on rate direction — across 16 markets (4 perps × 4 durations). A permissionless **LP Pool** provides deep liquidity as the counterparty for any net imbalance between payers and receivers.

**Live demo:** https://fundex-weld.vercel.app *(devnet)*

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
│  Drift Protocol  │  (mainnet, read-only)
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

**LP Pool**

| Instruction | Description |
|-------------|-------------|
| `initialize_pool` | Create PoolState + pool_vault for a market |
| `deposit_lp` | Deposit USDC into pool, receive pro-rata shares |
| `withdraw_lp` | Redeem shares for USDC |
| `sync_pool_pnl` | Settle pool P&L — transfers USDC between user_vault and pool_vault based on net imbalance |

### State Accounts

| Account | Seeds | Description |
|---------|-------|-------------|
| `RateOracle` | `[rate_oracle, perp_index]` | EMA of actual Drift funding rates |
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
| LP fee (imbalanced direction) | 0.3% of notional |
| Lot size | 100 USDC notional |
| Durations | 7D / 30D / 90D / 180D |
| Settlement interval | 1h (production) / unrestricted (devnet demo) |

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
4. **0.3% LP fee** is charged on any position that increases imbalance → goes directly to pool_vault
5. LPs withdraw their proportional share of the pool at any time

**LP P&L:**
```
pool_pnl = -(net_lots) × rate_delta × notional_per_lot / precision
```

LPs earn when the rate moves in their favor (opposite to the imbalanced side) plus the 0.3% fee stream.

---

## Tech Stack

| Layer | Tech |
|-------|------|
| On-chain | Anchor 0.32.1, Rust, Solana |
| Frontend | Next.js 16, TypeScript, Tailwind CSS v4 |
| Wallet | `@solana/wallet-adapter` |
| Rate source | Drift Protocol v2 (mainnet, read-only) |
| USDC | Custom SPL mock mint (devnet) |

---

## Project Structure

```
fundex/
├── programs/fundex/src/       # Anchor program (Rust)
│   ├── instructions/          # 10 instruction handlers
│   │   ├── open_position.rs   # Includes 0.3% LP fee logic
│   │   ├── initialize_pool.rs
│   │   ├── deposit_lp.rs
│   │   ├── withdraw_lp.rs
│   │   └── sync_pool_pnl.rs
│   ├── state.rs               # RateOracle, MarketState, Position, PoolState, LpPosition
│   ├── constants.rs           # Margin bps, LP_FEE_BPS, seeds
│   └── errors.rs              # Custom error codes
├── tests/fundex.ts            # Integration tests
├── scripts/
│   ├── setup-devnet.ts        # One-shot devnet bootstrap
│   ├── init-pools.ts          # Initialize LP pools for all 16 markets
│   ├── crank-devnet.ts        # Demo crank (mock rates, 1-min intervals)
│   ├── crank.ts               # Production crank (live Drift rates)
│   └── liquidator.ts          # Permissionless liquidator bot
├── sdk/src/                   # TypeScript client SDK
│   ├── client.ts              # All instructions + fetch methods incl. LP
│   └── pda.ts                 # PDA derivation helpers
└── app/                       # Next.js frontend
    └── src/
        ├── app/               # Pages: /, /trade, /pool, /markets, /portfolio
        ├── components/        # TradeHeader, OrderPanel, RateBook, etc.
        ├── hooks/             # useMarketData, usePositions, useOracleRates
        └── lib/fundex/        # Client SDK wrapper, constants, IDL
```

---

## Deployed Contracts (Devnet)

| Item | Address |
|------|---------|
| Program ID | `7UzjwBopedNuBzf5T4CYouJrGqgkQRnjtMAwjxdPFbQk` |
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
```

`ADMIN_SECRET_KEY` is required for the `/api/faucet` endpoint to mint devnet USDC.

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

### Providing Liquidity

1. Navigate to **[Pool]** tab
2. Select a market pool
3. Click **"Provide Liquidity"** → deposit USDC → receive LP shares
4. Earn 0.3% fee on every imbalance-increasing position opened in that market
5. Click **"Manage Position"** → **Withdraw** to redeem shares for USDC

---

## License

MIT
