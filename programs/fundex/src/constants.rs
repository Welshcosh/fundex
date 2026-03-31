// ─── Seeds ───────────────────────────────────────────────────────────────────
pub const SEED_RATE_ORACLE: &[u8] = b"rate_oracle";
pub const SEED_MARKET: &[u8] = b"market";
pub const SEED_POSITION: &[u8] = b"position";
pub const SEED_VAULT: &[u8] = b"vault";

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
// Drift stores funding rates with PRICE_PRECISION = 1_000_000 (1e6)
// 1 Drift rate unit ≈ 0.000001 (0.0001%) of notional per funding interval
pub const DRIFT_PRICE_PRECISION: i64 = 1_000_000;

// ─── Duration options (seconds) ──────────────────────────────────────────────
pub const DURATION_7D: i64 = 7 * 24 * 3_600;
pub const DURATION_30D: i64 = 30 * 24 * 3_600;
pub const DURATION_90D: i64 = 90 * 24 * 3_600;
pub const DURATION_180D: i64 = 180 * 24 * 3_600;

// ─── Rate bounds ─────────────────────────────────────────────────────────────
// Max allowed fixed_rate: ±50% annualized ≈ ±5000 bps hourly in Drift units
// Drift unit per 1% per hour ≈ 10_000
pub const MAX_FIXED_RATE_ABS: i64 = 500_000;
