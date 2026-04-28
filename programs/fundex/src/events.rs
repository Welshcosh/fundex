use anchor_lang::prelude::*;

#[event]
pub struct OracleInitialized {
    pub perp_index: u16,
    pub oracle: Pubkey,
    pub slot: u64,
}

#[event]
pub struct MarketInitialized {
    pub market: Pubkey,
    pub perp_index: u16,
    pub duration_variant: u8,
    pub fixed_rate: i64,
    pub expiry_ts: i64,
    pub notional_per_lot: u64,
    pub skew_k: i64,
    pub slot: u64,
}

#[event]
pub struct PositionOpened {
    pub user: Pubkey,
    pub market: Pubkey,
    pub side: u8, // 0=FixedPayer, 1=FixedReceiver
    pub lots: u64,
    pub collateral_deposited: u64,
    pub entry_actual_index: i64,
    pub entry_fixed_index: i64,
    // α: time-weighted pre-bias applied to entry indices (1e6 fraction of an
    // interval that had already elapsed since last settlement at open).
    pub elapsed_frac_e6: i64,
    // β: skew premium locked at open (1e6/h units).
    pub entry_skew_premium: i64,
    // β: market.settlement_count at open.
    pub entry_settlement_count: u64,
    pub slot: u64,
}

#[event]
pub struct FundingSettled {
    pub market: Pubkey,
    pub actual_rate: i64,
    pub fixed_rate: i64,            // fixed_rate used this settlement
    pub new_fixed_rate: i64,        // fixed_rate updated toward oracle EMA
    pub new_cumulative_actual_index: i64,
    pub new_cumulative_fixed_index: i64,
    pub new_oracle_ema: i64,
    pub new_settlement_count: u64,
    pub slot: u64,
}

#[event]
pub struct PositionClosed {
    pub user: Pubkey,
    pub market: Pubkey,
    pub side: u8,
    pub lots: u64,
    pub collateral_deposited: u64,
    pub unrealized_pnl: i64,
    pub payout: u64,
    // β: signed USDC lamport amount routed between vault and pool_vault to
    // realise the position's locked skew accrual. Positive = vault → pool.
    pub skew_pool_pnl: i64,
    pub slot: u64,
}

#[event]
pub struct PositionLiquidated {
    pub user: Pubkey,
    pub liquidator: Pubkey,
    pub market: Pubkey,
    pub collateral_deposited: u64,
    pub unrealized_pnl: i64,
    pub liquidator_reward: u64,
    pub skew_pool_pnl: i64,
    pub slot: u64,
}
