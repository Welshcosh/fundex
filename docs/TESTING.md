# Fundex — Test Coverage Status

A self-honest report on what is verified, how, and what gaps remain. The
goal is **not** to claim a green test suite — it is to make the actual
verification level visible to reviewers so they can judge confidence
themselves.

---

## TL;DR

- **No automated test suite currently runs green.** The two test files
  (`tests/fundex.ts`, `scripts/test-e2e.ts`) were written against an
  earlier API where `settle_funding` accepted a rate parameter; the
  current handler reads `last_funding_rate` from a Drift PerpMarket
  account on-chain. Both files are documented as **stale** below.
- **Live production verification is the primary signal today**: the
  devnet crank (`scripts/crank-devnet.ts`) has been running continuously,
  and every instruction in the user-facing flow has been exercised
  end-to-end against the deployed program from the web app.
- **Compute-unit and security audit signals are independent**: see
  `docs/benchmarks/cu-table.md` (32 live `settle_funding` samples) and
  `docs/SECURITY.md` (manual T1–T10 review with file:line evidence).

---

## Coverage matrix

Per instruction, what verification level exists today. *Methods*: U =
unit/Mocha, E = scripted e2e, M = manual via app + crank, A = static audit
(see `SECURITY.md`), C = CU-bench measurement (see `cu-table.md`).

| Instruction              | Happy path | Error path | Audit | CU-bench | Notes |
|---|:-:|:-:|:-:|:-:|---|
| `initialize_rate_oracle` | M          | —          | A     | C        | 4 live samples |
| `initialize_market`      | M          | —          | A     | C        | 16 live samples; permissionless caller (L1) |
| `initialize_pool`        | M          | —          | A     | —        | LP path |
| `deposit_lp`             | M          | —          | A     | —        | needs LP seeding for CU |
| `withdraw_lp`            | M          | —          | A     | —        | needs LP seeding for CU |
| `sync_pool_pnl`          | M          | —          | A     | —        | runs implicitly during settlement w/ open positions |
| `open_position`          | M          | —          | A     | —        | gated on oracle warmup (`numSamples ≥ 24`) |
| `close_position`         | M          | —          | A     | —        | covers profit + loss + over-vault clamp |
| `liquidate_position`     | M*         | A          | A     | —        | *manual liquidation has not been triggered on a real underwater position; logic verified by audit |
| `settle_funding`         | M          | A          | A     | C        | 32 live crank samples; rate clamp + interval guard verified by audit |
| `close_market`           | —          | A          | A     | —        | not exercised; admin-gated, requires `total_collateral == 0` |
| `close_pool`             | —          | A          | A     | —        | not exercised |

**Legend reminder.** `M` (manual via app + crank) is the dominant
verification today. It means a human or the automated crank has driven
the instruction against the deployed devnet program with real accounts
and observed correct on-chain state changes — but there is no green CI
job asserting it.

---

## Stale test files

### `tests/fundex.ts` (Mocha suite)

**Status:** does not compile against current program IDL.

**What it covered (intent):**
- Oracle init + first 3 settlements
- Market init V1 (`fixed_rate_override = Some(rate)`)
- Market init V2 (`fixed_rate_override = None`, EMA path)
- `open_position` happy path + `lots = 0` revert
- `settle_funding` × 3 with cumulative-index assertions
- `close_position` profit + loss
- `liquidate_position` margin guard + adverse-settlement liquidation

**Why it is stale:**
- Calls `.settleFunding(new BN(rate))` — the current handler takes no
  arguments and reads from a Drift PerpMarket account. No call site
  compiles.
- Asserts on `market.cumulativeRateIndex`, which was split into
  `cumulativeActualIndex` and `cumulativeFixedIndex` when the
  fixed-vs-floating accounting was separated. Field no longer exists.
- The `initialize_market` V1 path passes a `fixed_rate` directly; the
  current handler also accepts `Option<i64>` but the test uses the
  unwrapped form.

### `scripts/test-e2e.ts` (devnet integration runner)

**Status:** same root cause — uses the pre-Drift `settleFunding(BN(rate))`
API and `cumulativeRateIndex`.

**Additional blocker beyond the field renames:** the new `settle_funding`
requires a real Drift PerpMarket account passed in. Reproducing this in
an e2e test means either:

1. **Use Drift devnet markets directly.** Drift deploys to devnet under
   the same program ID, so the on-chain owner check passes. This is the
   path the live crank already takes — `scripts/crank-devnet.ts:142`
   derives the Drift PerpMarket PDA and passes it into `settleFunding`.
   The catch is that the test then loses control over `actual_rate` and
   cannot assert exact PnL values — assertions become directional
   (`payout > collateral` rather than `payout == 65 USDC`).
2. **Add a `feature = "testing"` mock path** in `settle_funding.rs` that
   reads the rate from an instruction argument instead of an account.
   This is the cleanest way to keep deterministic assertions, but it
   means shipping two code paths and gating one with a build feature —
   acceptable on devnet, undesirable on mainnet.

Both options are reasonable; neither has been done.

---

## What *has* been verified, and how

### Live crank loop (continuous)

`scripts/crank-devnet.ts` runs against the devnet deployment on a
configurable interval. Every successful tx contributes a real
`computeUnitsConsumed` sample to `bench-cu.ts`, and the absence of any
panicked or rolled-back tx over 32+ consecutive runs is positive
evidence that:

- T1 oracle owner-check passes against real Drift PerpMarket accounts
- T2 funding-interval guard accepts settlements at the configured cadence
- T8 cumulative-index `checked_add` does not trip with realistic Drift
  rates over an extended sample stream
- The `RateOracle` EMA update converges as expected (oracle
  `numSamples` is climbing toward 24 as of writing)

### Web app manual flow (`app/`)

The Next.js app in `app/` exercises the full happy path against the
deployed devnet program. As of the last manual session:

- `initialize_market` — invoked for all 16 (perp × duration) cells via
  `setup-devnet.ts` and `fix-7d-markets.ts`
- `open_position`, `close_position` — exercised manually from the
  trading UI; PnL settled correctly against the live crank's index
- `deposit_lp`, `withdraw_lp` — exercised from the LP page
- `liquidate_position` — code path verified by audit; not yet triggered
  on a real underwater position (would require either an extreme rate
  excursion or a tiny-collateral test position)

This is *not* a substitute for an assertion-bearing test — but it is the
load-bearing verification today, and it is what the demo flow depends on.

### Static audit (T1–T10)

See `docs/SECURITY.md`. Every threat is cross-referenced to a
file:line-level mitigation, and the analysis was re-checked against
source after writing. The audit is the primary signal for the
`liquidate_position`, `close_market`, and `close_pool` rows in the
matrix above, since those are not exercised in the live flow yet.

### CU benchmarks (`docs/benchmarks/cu-table.md`)

32 live `settle_funding` samples, 16 `initialize_market`, 4
`initialize_rate_oracle`. Pending rows (`open_position`, `close_position`,
`liquidate_position`, LP) will be filled in once oracle warmup completes
and a representative trading flow runs end-to-end.

---

## Gap list (what would be needed for a green suite)

Ordered roughly by ROI:

1. **Restore `tests/fundex.ts` against the current API** — the highest
   leverage. Needs:
   - Remove rate parameter from every `settleFunding(...)` call
   - Replace `cumulativeRateIndex` assertions with directional checks
     against `cumulativeActualIndex` − `cumulativeFixedIndex`
   - Add `driftPerpMarket` account to every settlement call (use Drift
     devnet PDA path from `crank-devnet.ts:28-32`)
   - Drop exact-USDC payout assertions; use `>` / `<` comparisons
2. **Add a feature-gated mock-Drift instruction** for deterministic PnL
   tests. Behind `#[cfg(feature = "testing")]`, expose
   `settle_funding_mock(rate: i64)` that bypasses the Drift account
   read. This restores exact-payout assertions in unit tests without
   contaminating the mainnet build.
3. **Property tests for `unrealized_pnl`** (`state.rs:128-143`). Random
   `(net_delta, lots, notional)` triples up to realistic bounds → assert
   `clamp` never returns a value outside `[i64::MIN, i64::MAX]` and that
   sign is correct for both sides.
4. **Adversarial fuzzing of `open_position` fee math.** The dynamic LP
   fee depends on `imbalance_ratio` which is a piecewise function;
   property tests should verify monotonicity (rebalancing trades never
   pay more than imbalance-widening trades for the same lot count).
5. **Liquidation simulation.** A scripted scenario that walks a small
   position into the underwater zone via repeated extreme settlements,
   then triggers `liquidate_position` and asserts the reward + position
   close. Closes the `liquidate_position` `M*` cell in the matrix.

Items 1, 3, 4 are pure devnet work. Item 2 requires a small program
change (one new instruction behind a feature flag). Item 5 is
script-only.

---

## Out of scope for this hackathon submission

- Formal verification of PnL arithmetic (mentioned in `SECURITY.md`)
- Adversarial fuzzing against `open_position` / `close_position` /
  `liquidate_position` with random sequences
- Professional audit (out of scope; flagged in `SECURITY.md`)
- LP insolvency simulation under sustained extreme funding regimes
