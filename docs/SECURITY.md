# Fundex — Security Checklist

A threat-by-threat audit of the on-chain program at
`programs/fundex/src/` (~1,560 LoC Rust, Anchor 0.32.1). Every mitigation
below is cross-referenced to a specific source line so that reviewers can
verify the claim directly. This is an **audit-lite** self-review for
hackathon submission — not a substitute for a professional audit before a
mainnet deployment that holds real funds.

---

## Trust boundaries

| Input | Trust status | Enforcement point |
|---|---|---|
| `drift_perp_market` account data (funding rate) | **Trusted** — owner-checked against hard-coded Drift program ID; fixed byte offset; clamped to `±MAX_FIXED_RATE_ABS` | `settle_funding.rs:32-59` |
| `settle_funding` caller (crank) | **Untrusted** — permissionless; any signer may invoke | `settle_funding.rs:104-106` |
| `liquidate_position` caller | **Untrusted** — permissionless; gated by on-chain margin check | `liquidate_position.rs:8-18` |
| `close_position` caller | Restricted to position owner via `has_one = user` | `close_position.rs:90` |
| `close_market` caller | Restricted to market admin via `has_one = admin` | `close_market.rs:44` |
| `initialize_market` caller | Currently **permissionless** (see L1) | `initialize_market.rs:69-72` |
| Off-chain oracle feeds | **None accepted.** Every rate Fundex acts on is read directly from Drift on-chain state. | n/a |

---

## Threat analysis

### T1 — Oracle manipulation

**Risk.** An attacker feeds a crafted funding rate to `settle_funding`, either by spoofing the Drift account or by substituting an arbitrary account at the same position in the instruction.

**Mitigation.**
- The `drift_perp_market` account is `UncheckedAccount`, but its **owner pubkey** is verified in-handler against a compile-time constant before any byte is read (`settle_funding.rs:33-37`).
- Data length is checked before indexing (`settle_funding.rs:41-44`), so a short account cannot trigger an out-of-bounds read.
- The value is read from a **fixed byte offset** (`DRIFT_LAST_FUNDING_RATE_OFFSET = 480`, `constants.rs:50`) computed from Drift's published layout — not from a deserialiser that could be tricked by malformed account data.
- The raw rate is converted from Drift's 1e9/h precision to Fundex's 1e6/h precision via `checked_div` (`settle_funding.rs:54-56`) and then **hard-clamped** to `±MAX_FIXED_RATE_ABS = 500_000` (`settle_funding.rs:59`), which caps a single settlement's impact at ±50 % per hour even if Drift itself reports an extreme value.

**Residual risk.** Compromise of the Drift program itself would feed Fundex a bad rate — but this is the same trust assumption every Drift-consuming protocol makes.

### T2 — Settlement spam / DoS

**Risk.** An attacker calls `settle_funding` thousands of times in one slot to exhaust the market's cumulative-index variance or burn crank operators' SOL.

**Mitigation.** `ENFORCE_FUNDING_INTERVAL` (`constants.rs:17-20`) guards the handler at `settle_funding.rs:22-27`: a second settlement is rejected with `TooEarlyToSettle` unless `clock.unix_timestamp >= last_settled_ts + FUNDING_INTERVAL (3600s)`. The `testing` feature flag disables this only in local test builds.

### T3 — Reentrancy

**Risk.** A CPI from Fundex into another program that calls back into Fundex mid-handler with stale state.

**Mitigation.** Structurally impossible on Solana: programs cannot invoke themselves recursively via CPI, and the only external programs Fundex calls are SPL Token (`transfer`, `close_account`) and the System Program, neither of which issues callbacks. State mutations in every instruction follow the check-effects-interactions pattern — accounting updates (`market.total_*`) occur before or immediately after the token CPI, within the same handler, without yielding control.

### T4 — Unauthorized position access

**Risk.** A user closes or withdraws from another user's position.

**Mitigation.** `close_position` declares `has_one = user @ Unauthorized` and `has_one = market @ Unauthorized` on the position account (`close_position.rs:90-91`), so Anchor rejects the transaction at deserialisation if the signer is not the stored `position.user`. The position PDA is further keyed by `[SEED_POSITION, user.key(), market.key()]` (`close_position.rs:88`), so an attacker cannot even submit a fake PDA for a target user.

### T5 — Liquidation griefing

**Risk 1: premature liquidation.** A liquidator triggers liquidation on a healthy position and steals the 3 % reward.
**Mitigation.** `liquidate_position.rs:14-18` requires `margin_ratio_bps < MAINT_MARGIN_BPS` (500 bps = 5 %) using the same on-chain PnL computation that `close_position` uses — an attacker cannot liquidate a position that is above maintenance margin.

**Risk 2: reward drain.** A liquidator claims a reward larger than the vault balance.
**Mitigation.** Reward is `.min(vault.amount)` at `liquidate_position.rs:30-33`, so the payout is clamped to what the vault can actually pay. If the vault is empty the liquidation still succeeds (position is closed) but no reward is transferred.

**Risk 3: denial of liquidation.** A user holds an underwater position and races a liquidator with `close_position` to claim full PnL.
**Known limitation.** `close_position` is not blocked when margin is below maintenance — users retain the option to close themselves. This is intentional: it prevents liquidators from holding positions hostage. The downside is that a user with a profitable side can exit without ever being liquidated. See L3 below.

### T6 — Rent exhaustion

**Risk.** An attacker creates many positions or LP accounts without paying their own rent, or prevents closure so that rent is permanently locked.

**Mitigation.**
- All user-created accounts (`Position`, `LpPosition`) are initialized with `payer = user` / `payer = admin` — the caller funds their own rent (`open_position.rs:151-157`, `deposit_lp.rs`).
- `close_position` uses `close = user` (`close_position.rs:92`) to refund rent to the user when the position is closed.
- `liquidate_position` uses `close = liquidator` (`liquidate_position.rs:100`) so the liquidator recovers the position rent — a small but real incentive on top of the 3 % reward.
- Position account size is fixed at `Position::LEN = 114 bytes` (`state.rs:119`); there is no dynamic growth vector that could inflate rent over time.

### T7 — Arbitrary account substitution

**Risk.** Supplying an unrelated `TokenAccount` or `MarketState` in the place of the one the PDA derives to.

**Mitigation.** Every account in every `#[derive(Accounts)]` struct carries explicit `seeds = [...]` and `bump = ...` constraints that Anchor verifies on deserialisation. Token accounts additionally carry `token::mint` and `token::authority` constraints (e.g. `open_position.rs:162-166`, `close_position.rs:98-102`), so a vault belonging to a different market or mint is rejected automatically.

### T8 — Math overflow

**Risk.** A crafted input causes a silent wraparound in the PnL or cumulative-index arithmetic, stealing collateral or evading liquidation.

**Mitigation.** The code uses a deliberate mix of `checked_*`, `saturating_*`, and explicit clamping. The choice is per-call-site, not blanket:

- **`checked_*` in instruction hot paths** where any wraparound would be catastrophic and there is no downstream backstop: `open_position.rs:19-26, 62-68, 101-111`, `settle_funding.rs:54-71`. Cumulative indices use `checked_add` so that even a hypothetical pathological accumulation pattern aborts the transaction rather than silently wrapping.
- **Rate clamp before accumulation.** Every `actual_rate` added to `cumulative_actual_index` is first clamped to `±MAX_FIXED_RATE_ABS = ±500_000` (`settle_funding.rs:59`). Even 1 billion settlements cannot grow the index beyond ±5e14, well below `i64::MAX ≈ 9.2e18` — so the `checked_add` above is redundancy, not the primary safety.
- **`saturating_*` in PnL with a defense-in-depth chain.** `unrealized_pnl` (`state.rs:128-143`) promotes the multiplication to `i128`, which is enough headroom for any realistic input (`notional_per_lot ≤ 1e9` × `lots ≤ 1e6` × `net_delta ≤ 4.4e9` for a 1-year settlement run = ~4.4e24, vs. `i128::MAX ≈ 1.7e38`). Saturation is therefore unreachable with realistic on-chain state, but the code still does not rely on that: a saturated `i128` result is **explicitly `clamp()`-ed to `i64::MIN..=i64::MAX`** at `state.rs:141`, and the user-visible payout is **further clamped to `vault.amount`** at `close_position.rs:20`. Three independent layers (i128 headroom → i64 clamp → vault cap) — any single one is sufficient on its own.
- **Margin check uses the same PnL function.** `margin_ratio_bps` (`state.rs:147-162`) calls `unrealized_pnl` and inherits the same clamp. A saturated PnL would propagate to the margin calculation, which could theoretically prevent a liquidator from triggering liquidation on an underwater position — but the i128-headroom analysis above means this is unreachable for any market parameters Fundex actually deploys (1–4 perps × 100 USDC per lot).
- **RateOracle EMA stability** (`state.rs:21-29`). The EMA update `(sample + (w-1) × old) / w` consumes only already-clamped samples (every input is clamped at `settle_funding.rs:59` before reaching `oracle.update_ema`). By induction, if `|old| ≤ MAX_FIXED_RATE_ABS` and `|sample| ≤ MAX_FIXED_RATE_ABS`, then `|new| ≤ MAX_FIXED_RATE_ABS` — the EMA cannot drift beyond the clamp window even over unbounded samples, so no overflow check is needed inside the update itself.

### T9 — Market expiry / stale state

**Risk.** Opening or settling a position after the market's duration has elapsed, or initialising a market with a past expiry.

**Mitigation.**
- `open_position.rs:15-16` and `settle_funding.rs:19-20` both check `clock.unix_timestamp < market.expiry_ts` before doing any work.
- `initialize_market.rs:41` sets `expiry_ts = clock.unix_timestamp + duration_secs` directly from the clock sysvar — the value cannot be supplied by the caller.
- `duration_seconds(variant)` returns `None` for any variant outside 0..=3 (`state.rs:58-66`), raising `InvalidDuration` instead of silently defaulting.

### T10 — MEV / front-running

**Risk.** A searcher observes a pending `open_position` and front-runs it with an imbalance-widening trade of their own to pay a lower LP fee.

**Mitigation.** Fundex's dynamic LP fee is asymmetric by design (`open_position.rs:28-69`, `constants.rs:67-68`): a trade that *increases* net imbalance pays `30 bps + up to 70 bps` on top, while a trade that *decreases* imbalance is completely free. A front-runner cannot gain any advantage by stepping in ahead of a balancing trade — their own trade would cost more than the trade they displaced. The only MEV attack surface is liquidations, where the permissionless design is the standard and intended behaviour.

---

## Known limitations

These are documented gaps that would need to be closed before any mainnet deployment handling real funds.

### L1 — `initialize_market` is permissionless

Any signer can call `initialize_market` and will become the resulting market's admin (`initialize_market.rs:50`). PDA collision prevents duplicates per `(perp_index, duration_variant)`, so a griefer can at best race the intended admin for the first slot. Because the market's admin rights are limited to `close_market` (which itself requires `total_collateral == 0`, `close_market.rs:45`), the economic damage of a griefed init is bounded to *nuisance*: the real admin has to pick a different duration variant or close the grief market after its positions unwind. Before mainnet, this should either (a) become admin-gated by a hard-coded upgrade authority check, or (b) require the oracle to have `≥ MIN_ORACLE_SAMPLES` and accept only `fixed_rate_override = None`, so a griefer cannot plant a bad fixed rate.

### L2 — Program upgrade authority

The program is deployed with Anchor's default upgrade authority (the deployer wallet). A compromised deployer key could push arbitrary bytecode and drain all vaults. This is the *central* trust assumption of the current deployment — a production launch would require either (a) renouncing the upgrade authority, or (b) transferring it to a multisig with timelocked upgrades.

### L3 — Close-vs-liquidate race

`close_position` does not block the margin-below-maintenance case, so an underwater user holding the profitable side of a swap can still self-close for their full PnL. Intentional (see T5), but the side effect is that the liquidation reward path is only useful for *truly stuck* positions (e.g. keys lost, bot offline). A more aggressive design would disallow self-close while underwater.

### L4 — No per-user position caps

There is no upper bound on `lots` per user per market. A single whale could concentrate enough notional to make imbalance fees punitive for every other participant. This is the correct behaviour for a pure-market system but should be documented in user-facing risk disclosures before mainnet.

### L5 — No circuit breaker on `fixed_rate`

When `oracle.num_samples ≥ MIN_ORACLE_SAMPLES`, every settlement unconditionally updates `market.fixed_rate` to the clamped oracle EMA (`settle_funding.rs:81-87`). A 24-hour funding-rate regime change is therefore transmitted directly into new-position pricing, with no rate-of-change limiter. Existing positions are protected by the split-index PnL design (`state.rs:128-143`), so this is a new-entry-pricing issue only — but an aggressive design would cap the per-settlement delta.

### L6 — Liquidate on expired market

Neither `liquidate_position` nor `close_position` checks market expiry. Positions can be unwound after expiry — intentional — but no code path prevents a liquidator from collecting a reward off an expired market where no further settlements will occur. This is not a vulnerability (the PnL math still holds at the last settled index) but is worth flagging for reviewers.

---

## Test coverage status

Current verification level per threat:

| Threat | Unit test | Integration (devnet) | Fuzz / property | Manual audit |
|---|:-:|:-:|:-:|:-:|
| T1 Oracle manipulation | — | partial (crank) | — | ✓ |
| T2 Settlement spam | — | ✓ (crank interval) | — | ✓ |
| T3 Reentrancy | — | — | — | ✓ (structural) |
| T4 Unauthorized access | — | partial | — | ✓ |
| T5 Liquidation griefing | — | partial | — | ✓ |
| T6 Rent exhaustion | — | — | — | ✓ |
| T7 Account substitution | — | — | — | ✓ (Anchor constraints) |
| T8 Math overflow | — | — | — | ✓ |
| T9 Market expiry | — | partial (7D refresh cycle) | — | ✓ |
| T10 MEV / front-run | — | — | — | ✓ (design) |

The `—` cells are the gap `docs/TESTING.md` (P1 #8) is meant to close.

---

## Audit scope not covered

The following are out of scope for this self-review and should be covered before mainnet:
- Professional security audit (OtterSec, Ottersec, Zellic, Neodyme, Trail of Bits…).
- Formal verification of the PnL and cumulative-index arithmetic.
- Adversarial fuzzing against `open_position` / `close_position` / `liquidate_position` with random sequences.
- Economic simulation of LP insolvency under extreme funding regimes (e.g. the −75 % APR SOL spike visible in `app/public/charts/funding-history.png`).
