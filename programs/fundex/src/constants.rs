// ─── Seeds ───────────────────────────────────────────────────────────────────
pub const SEED_RATE_ORACLE: &[u8] = b"rate_oracle";
pub const SEED_MARKET: &[u8] = b"market";
pub const SEED_POSITION: &[u8] = b"position";
pub const SEED_VAULT: &[u8] = b"vault";
pub const SEED_POOL: &[u8] = b"pool";
pub const SEED_POOL_VAULT: &[u8] = b"pool_vault";
pub const SEED_LP_POSITION: &[u8] = b"lp_position";

// ─── Margin (bps) ────────────────────────────────────────────────────────────
pub const INITIAL_MARGIN_BPS: u64 = 1_000; // 10%
pub const MAINT_MARGIN_BPS: u64 = 500;     // 5%
pub const LIQUIDATION_REWARD_BPS: u64 = 300; // 3%

// ─── Settlement ──────────────────────────────────────────────────────────────
pub const FUNDING_INTERVAL: i64 = 3_600;    // 1 hour between settlements
#[cfg(not(feature = "testing"))]
pub const ENFORCE_FUNDING_INTERVAL: bool = true;
#[cfg(feature = "testing")]
pub const ENFORCE_FUNDING_INTERVAL: bool = false;

// ─── Oracle ──────────────────────────────────────────────────────────────────
pub const MIN_ORACLE_SAMPLES: u64 = 24;     // 1 day of hourly data
pub const EMA_WINDOW: i64 = 10; // α = 0.1

// ─── Precision ───────────────────────────────────────────────────────────────
// Fundex rate precision: 1e6 = 100% per hour (matches FUNDING_INTERVAL = 3_600s).
// 1 Fundex rate unit ≈ 0.000001 (0.0001%) of notional per hour.
// DRIFT_PRICE_PRECISION is the divisor used when multiplying rate × notional
// (both are 1e6 precision, so divide once to get USDC lamports).
pub const DRIFT_PRICE_PRECISION: i64 = 1_000_000;

// ─── Duration options (seconds) ──────────────────────────────────────────────
pub const DURATION_7D: i64 = 7 * 24 * 3_600;
pub const DURATION_30D: i64 = 30 * 24 * 3_600;
pub const DURATION_90D: i64 = 90 * 24 * 3_600;
pub const DURATION_180D: i64 = 180 * 24 * 3_600;

// ─── Drift Protocol integration ──────────────────────────────────────────────
// Same program ID on mainnet and devnet.
pub const DRIFT_PROGRAM_ID_BYTES: [u8; 32] = [
    // dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH
    0x09, 0x54, 0xdb, 0xbe, 0x9e, 0xc9, 0x60, 0xc9,
    0x8a, 0x7a, 0x29, 0x3f, 0xe2, 0x13, 0x36, 0x96,
    0x6f, 0xe1, 0x80, 0xd1, 0x51, 0xae, 0x4b, 0x81,
    0x79, 0x56, 0x1f, 0x89, 0x85, 0x4a, 0x53, 0xf6,
];
/// Byte offset of `amm.last_funding_rate` (i64) within a Drift PerpMarket account.
/// Verified against a live Drift devnet PerpMarket on 2026-04-15: i64 LE at offset 480.
pub const DRIFT_LAST_FUNDING_RATE_OFFSET: usize = 480;
/// Byte offset of `amm.last_funding_oracle_twap` (i64) within a Drift PerpMarket account.
/// Verified against a live Drift devnet PerpMarket on 2026-04-15: i64 LE at offset 968.
pub const DRIFT_LAST_FUNDING_ORACLE_TWAP_OFFSET: usize = 968;

// ─── Rate bounds ─────────────────────────────────────────────────────────────
// Fundex rate units: 10_000 = 1% per hour (1e6 precision).
// MAX = 500_000 = 50% per hour ≈ 4380% APR — a very loose cap that allows
// absorbing extreme Drift funding spikes while still preventing i64 overflow.
pub const MAX_FIXED_RATE_ABS: i64 = 500_000;

// ─── LP Fee (AMM-style dynamic pricing) ──────────────────────────────────────
// Charged when opening a position that increases net imbalance.
// Goes directly to pool_vault to reward LPs.
// Fee = BASE_FEE + imbalance_ratio × MAX_IMBALANCE_FEE
//   imbalance_ratio = |payer_lots − receiver_lots| / (payer_lots + receiver_lots)
//   At 0% imbalance: 0.3%  |  At 50% imbalance: ~0.65%  |  At 100% imbalance: 1.0%
pub const LP_FEE_BPS: u64 = 30;             // 0.3% base
pub const MAX_IMBALANCE_FEE_BPS: u64 = 70;  // 0.7% max premium → total max 1.0%

// ─── Skew premium (β) ────────────────────────────────────────────────────────
// Adjusts the quoted fixed rate at open based on signed imbalance, locked
// per-position. 1e6/h precision (matches fixed_rate).
//
//   skew_premium_at_open = market.skew_k × (payer_lots − receiver_lots)
//                                          ───────────────────────────────
//                                            (payer_lots + receiver_lots)
//
// Positive when payer-heavy → quoted fixed rises for new entrants on both sides
// (payers pay more, receivers receive more — pushing the market toward balance).
//
// Default 50_000 = 5%/h max premium at full one-sided imbalance.
// MAX caps the admin-tunable value to prevent extreme quotes.
pub const DEFAULT_SKEW_K: i64 = 50_000;
pub const MAX_SKEW_K_ABS: i64 = 200_000;
