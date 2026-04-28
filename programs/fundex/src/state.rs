use anchor_lang::prelude::*;
use crate::constants::*;

// ─── RateOracle ──────────────────────────────────────────────────────────────
// One per perp_index. Tracks EMA of actual Drift funding rates.
// Updated every time settle_funding is called.
#[account]
pub struct RateOracle {
    pub perp_index: u16,
    pub ema_funding_rate: i64,  // EMA of actual Drift funding rates
    pub last_update_ts: i64,
    pub num_samples: u64,       // total settlements recorded
    pub bump: u8,
}

impl RateOracle {
    pub const LEN: usize = 8 + 2 + 8 + 8 + 8 + 1; // = 35

    /// EMA update: new = (sample + (WINDOW-1) * old) / WINDOW
    /// α = 1/WINDOW = 0.1 with WINDOW=10
    pub fn update_ema(&mut self, new_sample: i64) {
        self.ema_funding_rate = if self.num_samples == 0 {
            new_sample
        } else {
            let w = EMA_WINDOW;
            (new_sample + (w - 1) * self.ema_funding_rate) / w
        };
        self.num_samples = self.num_samples.saturating_add(1);
    }
}

// ─── MarketState ─────────────────────────────────────────────────────────────
// seeds: [SEED_MARKET, perp_index.to_le_bytes(), duration_variant]
// One market per (perp_index, duration). Reusable after expiry.
#[account]
pub struct MarketState {
    pub perp_index: u16,
    pub duration_variant: u8,         // 0=7d, 1=30d, 2=90d, 3=180d
    pub fixed_rate: i64,              // current fixed rate (updated toward oracle EMA each settlement)
    pub notional_per_lot: u64,        // USDC lamports per lot (e.g. 100_000_000 = 100 USDC)
    pub expiry_ts: i64,
    pub collateral_mint: Pubkey,
    pub cumulative_actual_index: i64, // ∑ actual_rate across all settlements
    pub cumulative_fixed_index: i64,  // ∑ fixed_rate across all settlements
    pub last_settled_ts: i64,
    pub total_fixed_payer_lots: u64,
    pub total_fixed_receiver_lots: u64,
    pub total_collateral: u64,        // total USDC lamports currently in vault
    pub is_active: bool,
    pub admin: Pubkey,
    pub bump: u8,
    pub vault_bump: u8,
    // β: skew sensitivity. quoted_fixed_at_open = fixed_rate + skew_k × signed_imbalance_ratio
    pub skew_k: i64,
    // β: incremented in settle_funding; positions snapshot it at open and use the
    // delta as "intervals_held" when realising their locked skew premium.
    pub settlement_count: u64,
}

impl MarketState {
    // 8 disc + 2 + 1 + 8 + 8 + 8 + 32 + 8 + 8 + 8 + 8 + 8 + 8 + 1 + 32 + 1 + 1 + 8 (skew_k) + 8 (settlement_count) = 166
    pub const LEN: usize = 8 + 2 + 1 + 8 + 8 + 8 + 32 + 8 + 8 + 8 + 8 + 8 + 8 + 1 + 32 + 1 + 1 + 8 + 8;

    pub fn duration_seconds(variant: u8) -> Option<i64> {
        match variant {
            0 => Some(DURATION_7D),
            1 => Some(DURATION_30D),
            2 => Some(DURATION_90D),
            3 => Some(DURATION_180D),
            _ => None,
        }
    }

    /// β: signed imbalance ratio in 1e6 precision, in [-1_000_000, 1_000_000].
    /// Positive = payer-heavy. Returns 0 when both sides empty.
    pub fn signed_imbalance_e6(&self) -> i64 {
        let total = self.total_fixed_payer_lots
            .saturating_add(self.total_fixed_receiver_lots);
        if total == 0 {
            return 0;
        }
        let net = self.total_fixed_payer_lots as i128 - self.total_fixed_receiver_lots as i128;
        let r = net.saturating_mul(1_000_000) / total as i128;
        r.clamp(-1_000_000, 1_000_000) as i64
    }

    /// β: skew premium quoted to a NEW position right now, in 1e6/h units.
    /// Same value applied to both sides — heavy side pays more, light side
    /// receives more (because PnL formulas have opposite signs per side).
    pub fn current_skew_premium(&self) -> i64 {
        let imb = self.signed_imbalance_e6() as i128;
        let p = (self.skew_k as i128).saturating_mul(imb) / 1_000_000;
        p.clamp(i64::MIN as i128, i64::MAX as i128) as i64
    }
}

// ─── PoolState ────────────────────────────────────────────────────────────────
// seeds: [SEED_POOL, market.key()]
// One pool per market. LPs deposit here; pool absorbs the net imbalance PnL.
#[account]
pub struct PoolState {
    pub market: Pubkey,
    pub total_shares: u64,
    pub last_actual_index: i64,  // market.cumulative_actual_index at last sync
    pub last_fixed_index: i64,   // market.cumulative_fixed_index at last sync
    pub last_net_lots: i64,      // (payer_lots - receiver_lots) at last sync
    pub bump: u8,
    pub pool_vault_bump: u8,
}

impl PoolState {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 8 + 8 + 1 + 1; // = 74
}

// ─── LpPosition ───────────────────────────────────────────────────────────────
// seeds: [SEED_LP_POSITION, user.key(), pool.key()]
// One LP position per (user, pool).
#[account]
pub struct LpPosition {
    pub user: Pubkey,
    pub pool: Pubkey,
    pub shares: u64,
    pub bump: u8,
}

impl LpPosition {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 1; // = 81
}

// ─── Position ─────────────────────────────────────────────────────────────────
// seeds: [SEED_POSITION, user.key(), market.key()]
// One position per (user, market).
#[account]
pub struct Position {
    pub user: Pubkey,
    pub market: Pubkey,
    pub side: u8,                  // 0=FixedPayer, 1=FixedReceiver
    pub lots: u64,
    pub collateral_deposited: u64,
    pub entry_actual_index: i64,   // market.cumulative_actual_index at open (α-prebiased)
    pub entry_fixed_index: i64,    // market.cumulative_fixed_index at open (α-prebiased)
    pub open_ts: i64,
    pub bump: u8,
    // β: skew premium locked at open, in 1e6/h. Added to fixed_delta per
    // settlement during this position's life.
    pub entry_skew_premium: i64,
    // β: market.settlement_count at open. (settle_count_now − this) gives the
    // number of intervals over which entry_skew_premium has accrued.
    pub entry_settlement_count: u64,
}

impl Position {
    // 8 disc + 32 + 32 + 1 + 8 + 8 + 8 + 8 + 8 + 1 + 8 (skew) + 8 (settle_count) = 130
    pub const LEN: usize = 8 + 32 + 32 + 1 + 8 + 8 + 8 + 8 + 8 + 1 + 8 + 8;

    /// Skew accrual contribution to fixed_delta (in 1e6/h precision-units, NOT lamports).
    /// = entry_skew_premium × intervals_held.
    pub fn skew_fixed_delta(&self, market: &MarketState) -> i64 {
        let intervals = market
            .settlement_count
            .saturating_sub(self.entry_settlement_count) as i128;
        let r = (self.entry_skew_premium as i128).saturating_mul(intervals);
        r.clamp(i64::MIN as i128, i64::MAX as i128) as i64
    }

    /// Unrealized PnL in USDC lamports.
    ///
    /// total_fixed_delta = (cum_fixed − entry_fixed) + entry_skew_premium × intervals
    /// net_delta = (cum_actual − entry_actual) − total_fixed_delta
    ///
    /// Fixed Payer profits when actual > total_fixed (net_delta > 0).
    /// Fixed Receiver profits when actual < total_fixed (net_delta < 0).
    pub fn unrealized_pnl(&self, market: &MarketState) -> i64 {
        let actual_delta = market
            .cumulative_actual_index
            .saturating_sub(self.entry_actual_index);
        let base_fixed_delta = market
            .cumulative_fixed_index
            .saturating_sub(self.entry_fixed_index);
        let total_fixed_delta = base_fixed_delta.saturating_add(self.skew_fixed_delta(market));
        let net_delta = actual_delta.saturating_sub(total_fixed_delta);

        let raw = (net_delta as i128)
            .saturating_mul(self.lots as i128)
            .saturating_mul(market.notional_per_lot as i128)
            / DRIFT_PRICE_PRECISION as i128;
        let pnl = raw.clamp(i64::MIN as i128, i64::MAX as i128) as i64;
        if self.side == 0 { pnl } else { -pnl }
    }

    /// β: signed amount (in USDC lamports) that should flow vault → pool_vault
    /// at this position's close. Positive = pool receives; negative = pool pays.
    /// Aggregated across balanced position pairs this nets to zero; under
    /// imbalance the residual is the LP's skew revenue / cost.
    pub fn skew_pool_pnl(&self, market: &MarketState) -> i64 {
        let skew_units = self.skew_fixed_delta(market) as i128;
        let raw = skew_units
            .saturating_mul(self.lots as i128)
            .saturating_mul(market.notional_per_lot as i128)
            / DRIFT_PRICE_PRECISION as i128;
        let amount = raw.clamp(i64::MIN as i128, i64::MAX as i128) as i64;
        if self.side == 0 { amount } else { -amount }
    }

    /// Effective margin ratio in bps (10_000 = 100%).
    /// Returns u64::MAX if notional is zero.
    pub fn margin_ratio_bps(&self, market: &MarketState) -> u64 {
        let notional = (market.notional_per_lot as u128)
            .saturating_mul(self.lots as u128);
        if notional == 0 {
            return u64::MAX;
        }
        let pnl = self.unrealized_pnl(market);
        let effective = if pnl >= 0 {
            (self.collateral_deposited as i128).saturating_add(pnl as i128)
        } else {
            (self.collateral_deposited as i128).saturating_sub((-pnl) as i128)
        }
        .max(0) as u128;
        let ratio = effective.saturating_mul(10_000) / notional;
        ratio.min(u64::MAX as u128) as u64
    }
}
