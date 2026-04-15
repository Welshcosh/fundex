use anchor_lang::prelude::*;
use crate::constants::*;
use crate::errors::FundexError;
use crate::state::{MarketState, RateOracle};

/// Admin-only: reset a RateOracle's EMA and sample count. Used after bug fixes
/// that corrupt historical samples. Caller must be the market admin (any market
/// on the same perp_index works — all share the same oracle).
pub fn handler(ctx: Context<AdminResetOracle>) -> Result<()> {
    let oracle = &mut ctx.accounts.oracle;
    oracle.ema_funding_rate = 0;
    oracle.num_samples = 0;
    oracle.last_update_ts = Clock::get()?.unix_timestamp;
    Ok(())
}

#[derive(Accounts)]
pub struct AdminResetOracle<'info> {
    pub admin: Signer<'info>,

    #[account(
        seeds = [SEED_MARKET, &market.perp_index.to_le_bytes(), &[market.duration_variant]],
        bump = market.bump,
        constraint = market.admin == admin.key() @ FundexError::Unauthorized,
    )]
    pub market: Account<'info, MarketState>,

    #[account(
        mut,
        seeds = [SEED_RATE_ORACLE, &market.perp_index.to_le_bytes()],
        bump = oracle.bump,
    )]
    pub oracle: Account<'info, RateOracle>,
}
