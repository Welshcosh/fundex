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
    pub duration_variant: u8,    // 0=7d, 1=30d, 2=90d, 3=180d
    pub fixed_rate: i64,         // fixed rate per settlement interval (Drift units)
    pub notional_per_lot: u64,   // USDC lamports per lot (e.g. 100_000_000 = 100 USDC)
    pub expiry_ts: i64,
    pub collateral_mint: Pubkey,
    pub cumulative_rate_index: i64,  // ∑(actual - fixed) across all settlements
    pub last_settled_ts: i64,
    pub total_fixed_payer_lots: u64,
    pub total_fixed_receiver_lots: u64,
    pub total_collateral: u64,   // total USDC lamports currently in vault
    pub is_active: bool,
    pub admin: Pubkey,
    pub bump: u8,
    pub vault_bump: u8,
}

impl MarketState {
    pub const LEN: usize = 8 + 2 + 1 + 8 + 8 + 8 + 32 + 8 + 8 + 8 + 8 + 8 + 1 + 32 + 1 + 1; // = 142

    pub fn duration_seconds(variant: u8) -> Option<i64> {
        match variant {
            0 => Some(DURATION_7D),
            1 => Some(DURATION_30D),
            2 => Some(DURATION_90D),
            3 => Some(DURATION_180D),
            _ => None,
        }
    }
}

// ─── Position ─────────────────────────────────────────────────────────────────
// seeds: [SEED_POSITION, user.key(), market.key()]
// One position per (user, market).
#[account]
pub struct Position {
    pub user: Pubkey,
    pub market: Pubkey,
    pub side: u8,               // 0=FixedPayer, 1=FixedReceiver
    pub lots: u64,
    pub collateral_deposited: u64,
    pub entry_rate_index: i64,  // market.cumulative_rate_index at open
    pub open_ts: i64,
    pub bump: u8,
}

impl Position {
    pub const LEN: usize = 8 + 32 + 32 + 1 + 8 + 8 + 8 + 8 + 1; // = 106

    /// Unrealized PnL in USDC lamports.
    /// Fixed Payer:   pnl = +delta * lots * notional_per_lot / DRIFT_PRICE_PRECISION
    /// Fixed Receiver: pnl = -delta * lots * notional_per_lot / DRIFT_PRICE_PRECISION
    pub fn unrealized_pnl(&self, market: &MarketState) -> i64 {
        let rate_delta = market
            .cumulative_rate_index
            .saturating_sub(self.entry_rate_index);
        let raw = (rate_delta as i128)
            .saturating_mul(self.lots as i128)
            .saturating_mul(market.notional_per_lot as i128)
            / DRIFT_PRICE_PRECISION as i128;
        let pnl = raw.clamp(i64::MIN as i128, i64::MAX as i128) as i64;
        if self.side == 0 { pnl } else { -pnl }
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
