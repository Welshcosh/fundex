# Fundex — Funding Rate Swap Market on Solana

> **Seoulana WarmUp Hackathon 2026**

Fundex is a fully on-chain funding rate swap (FRS) market built on Solana. It lets traders go **long or short on perpetual funding rates** — hedging their perp positions or speculating on rate direction — across 16 markets (4 perps × 4 durations).

**Live demo:** https://fundex-weld.vercel.app *(devnet)*

---

## What Is a Funding Rate Swap?

In a funding rate swap:

- **Fixed Payer** pays a fixed rate, receives the variable (live) funding rate → profits when rates **rise**
- **Fixed Receiver** receives a fixed rate, pays the variable rate → profits when rates **fall** (hedge for perp shorts paying funding)

Fundex implements this as an on-chain swap where PnL settles every funding period based on the difference between the oracle EMA rate and the market's fixed rate.

```
PnL per settlement (Fixed Payer) = (variable_rate − fixed_rate) × notional
```

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Solana Devnet                     │
│                                                     │
│  ┌──────────────┐    ┌──────────────────────────┐  │
│  │  RateOracle  │    │       MarketState        │  │
│  │  (per perp)  │───▶│  (per perp × duration)   │  │
│  │  EMA tracker │    │  fixedRate, cumulIdx     │  │
│  └──────┬───────┘    └──────────────────────────┘  │
│         │                        │                  │
│  Crank  │ settle_funding()       │ open/close       │
│  (bot)  │                        ▼                  │
│         │            ┌──────────────────────────┐  │
│         └───────────▶│       Position           │  │
│                      │  user, side, lots, PnL   │  │
│                      └──────────────────────────┘  │
└─────────────────────────────────────────────────────┘
         ▲
         │ live rates
┌────────┴────────┐
│  Drift Protocol  │  (mainnet, read-only)
│  lastFundingRate │
└─────────────────┘
```

### On-Chain Program (Anchor 0.32.1)

| Instruction | Description |
|-------------|-------------|
| `initialize_rate_oracle` | Create per-perp EMA oracle |
| `initialize_market` | Create a market (perp × duration), set fixed rate from oracle EMA |
| `open_position` | Deposit collateral, open Fixed Payer or Fixed Receiver position |
| `settle_funding` | Update cumulative rate index + oracle EMA (called by crank) |
| `close_position` | Realise PnL, return collateral |
| `liquidate_position` | Permissionless liquidation when margin < 5% |

### State Accounts

| Account | Seeds | Description |
|---------|-------|-------------|
| `RateOracle` | `[rate_oracle, perp_index]` | EMA of actual Drift funding rates |
| `MarketState` | `[market, perp_index, duration]` | Per-market state, rates, OI |
| `Position` | `[position, user, market]` | Per-user per-market position |
| `Vault` | `[vault, market]` | Isolated USDC token vault per market |

### Key Parameters

| Parameter | Value |
|-----------|-------|
| Initial margin | 10% of notional |
| Maintenance margin | 5% of notional |
| Liquidation reward | 3% of notional |
| Lot size | 100 USDC notional |
| Durations | 7D / 30D / 90D / 180D |
| Settlement interval | 1h (production) / unrestricted (devnet demo) |

---

## Tech Stack

| Layer | Tech |
|-------|------|
| On-chain | Anchor 0.32.1, Rust, Solana |
| Frontend | Next.js 16, TypeScript, Tailwind CSS |
| Wallet | `@solana/wallet-adapter` |
| Rate source | Drift Protocol v2 (mainnet, read-only) |
| USDC | Custom SPL mock mint (devnet) |

---

## Project Structure

```
fundex/
├── programs/fundex/src/       # Anchor program (Rust)
│   ├── instructions/          # 6 instruction handlers
│   ├── state.rs               # Account structs + PnL logic
│   ├── constants.rs           # Margin bps, precision, seeds
│   └── errors.rs              # Custom error codes
├── tests/fundex.ts            # 14 integration tests
├── scripts/
│   ├── setup-devnet.ts        # One-shot devnet bootstrap
│   ├── crank-devnet.ts        # Demo crank (mock rates, 1-min intervals)
│   ├── crank.ts               # Production crank (live Drift rates)
│   ├── reset-oracle.ts        # Reset oracle EMA to target values
│   └── liquidator.ts          # Permissionless liquidator bot
├── sdk/src/                   # TypeScript client SDK
│   ├── FundexClient.ts        # All instructions + fetch methods
│   └── pda.ts                 # PDA derivation helpers
└── app/                       # Next.js frontend
    └── src/
        ├── app/               # Pages: /, /trade, /markets, /portfolio
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
# From project root — settle all 16 markets every 60 seconds
yarn crank:demo:fast

# Or every 5 minutes
yarn crank:demo
```

### 4. Full devnet bootstrap (if deploying fresh)

```bash
# Configure Solana for devnet
solana config set --url devnet
solana airdrop 2

# Build + deploy
anchor build -- --features testing
anchor deploy --provider.cluster devnet

# Initialize oracles + markets + mint USDC
yarn setup:devnet

# Reset oracle EMA to realistic values
yarn reset:oracle
```

### 5. Run tests (localnet)

```bash
anchor test
# 14/14 tests pass
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

1. Open the app → **[Launch App]**
2. Connect your Solana wallet (Phantom, Backpack, etc.)
3. Click **"Get 1000 USDC"** in the order panel to receive devnet USDC
4. Select a market (e.g. SOL-PERP 30D)
5. Choose **Fixed Payer** (long funding rate) and set lot size
6. Click **"Open Fixed Payer"** → confirm wallet transaction
7. Watch PnL update in Positions tab as crank settles every minute
8. Click **"Close"** to realise PnL and withdraw collateral

---

## License

MIT
