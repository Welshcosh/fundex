# Compute-Unit Benchmarks

Measured directly from successful on-chain transactions on Solana devnet
(program `BVyfQfmD6yCXqgqGQm6heYg85WYypqVxLnxb7MrGEKPb`). Each figure is the
`meta.computeUnitsConsumed` value returned by the RPC for a real, confirmed
invocation — not a local simulation or an estimate.

Reproduce with:

```bash
yarn ts-node -P tsconfig.json scripts/bench-cu.ts
```

## Results

| Instruction | Samples | Mean CU | Median | Min | Max | Status |
|---|---:|---:|---:|---:|---:|---|
| `settle_funding`        |  32 |  8,091 |  8,115 |  7,765 |  8,217 | measured |
| `initialize_market`     |  16 | 22,053 | 21,865 | 18,865 | 30,865 | measured |
| `initialize_rate_oracle`|   4 |  8,761 |  8,761 |  7,261 | 10,261 | measured |
| `open_position`         |   — |      — |      — |      — |      — | pending oracle warmup (24h) |
| `close_position`        |   — |      — |      — |      — |      — | pending first trading flow |
| `liquidate_position`    |   — |      — |      — |      — |      — | pending adverse-settlement test |
| `deposit_lp`            |   — |      — |      — |      — |      — | pending LP seeding |
| `withdraw_lp`           |   — |      — |      — |      — |      — | pending LP seeding |
| `sync_pool_pnl`         |   — |      — |      — |      — |      — | pending first settlement w/ open positions |

Pending rows will be filled in once the devnet deployment accumulates
`MIN_ORACLE_SAMPLES = 24` (required before `open_position` succeeds) and a
representative trading flow runs end-to-end.

## Context

- **Solana block compute-unit limit:** 48,000,000 CU
- **Default per-transaction limit:** 200,000 CU (can be raised with
  `ComputeBudgetProgram.setComputeUnitLimit`)

A `settle_funding` call therefore consumes **~0.017 % of a single block's
capacity** and **~4 % of the default per-transaction budget**. At this cost,
all 16 Fundex markets (4 perps × 4 durations) can be settled in a single
transaction well inside the 200k CU envelope, or in parallel transactions
with no meaningful contention.

### Why `settle_funding` matters most

`settle_funding` runs **every hour on every market** — it is the protocol's
only scheduled hot path. Everything else is user-driven (open, close, LP
deposit/withdraw) and happens a few times per user per market over its
lifetime. Keeping `settle_funding` cheap is the core scalability argument for
hourly settlement on Solana.

### What drives the variance

- `initialize_market` shows 18k–30k because each invocation does different
  amounts of account init work depending on which durations/variants are
  being bootstrapped in a single batch.
- `settle_funding` has a tight 7,765–8,217 range (≈ 5 % spread), which is the
  normal Solana CU noise floor from account-read branching.

## Methodology notes

- Only transactions where `meta.err === null` are counted (failed txs
  excluded — partial CU from a revert would skew the mean downward).
- The instruction name is extracted from the first `Program log:
  Instruction: <Name>` line Anchor emits, so CPI-inner invocations of other
  programs (SPL Token, System Program) are correctly attributed to their
  parent Fundex instruction.
- Live crank transactions (program `crank-devnet.ts`) provide the
  `settle_funding` sample set. No synthetic load was generated for the
  numbers above.
