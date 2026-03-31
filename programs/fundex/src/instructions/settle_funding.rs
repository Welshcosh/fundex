use anchor_lang::prelude::*;
use crate::constants::*;
use crate::errors::FundexError;
use crate::events::FundingSettled;
use crate::state::{MarketState, RateOracle};

/// Called by anyone (crank) once per funding interval.
/// `actual_rate`: the Drift funding rate for this interval, read off-chain from
/// Drift's PerpMarket account and passed in. In production, the crank verifies
/// this by reading PerpMarket.amm.last_funding_rate on-chain; the on-chain program
/// trusts the crank for MVP simplicity.
///
/// TODO (v2): pass Drift PerpMarket AccountInfo and verify on-chain using byte offset
/// DRIFT_LAST_FUNDING_RATE_OFFSET = 496 (8 disc + 32 pubkey + 456 AMM prefix).
pub fn handler(ctx: Context<SettleFunding>, actual_rate: i64) -> Result<()> {
    let clock = Clock::get()?;
    let market = &mut ctx.accounts.market;
    let oracle = &mut ctx.accounts.oracle;

    require!(market.is_active, FundexError::MarketInactive);
    require!(clock.unix_timestamp < market.expiry_ts, FundexError::MarketExpired);

    if ENFORCE_FUNDING_INTERVAL {
        require!(
            clock.unix_timestamp >= market.last_settled_ts + FUNDING_INTERVAL,
            FundexError::TooEarlyToSettle
        );
    }

    // Update cumulative rate index: ∑(actual - fixed) per interval
    let delta = actual_rate
        .checked_sub(market.fixed_rate)
        .ok_or(FundexError::MathOverflow)?;
    market.cumulative_rate_index = market.cumulative_rate_index
        .checked_add(delta)
        .ok_or(FundexError::MathOverflow)?;
    market.last_settled_ts = clock.unix_timestamp;

    // Update oracle EMA
    oracle.update_ema(actual_rate);
    oracle.last_update_ts = clock.unix_timestamp;

    emit!(FundingSettled {
        market: market.key(),
        actual_rate,
        fixed_rate: market.fixed_rate,
        delta,
        new_cumulative_rate_index: market.cumulative_rate_index,
        new_oracle_ema: oracle.ema_funding_rate,
        slot: clock.slot,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct SettleFunding<'info> {
    /// Anyone can call — permissionless crank
    pub crank: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_MARKET, &market.perp_index.to_le_bytes(), &[market.duration_variant]],
        bump = market.bump,
    )]
    pub market: Account<'info, MarketState>,

    #[account(
        mut,
        seeds = [SEED_RATE_ORACLE, &market.perp_index.to_le_bytes()],
        bump = oracle.bump,
    )]
    pub oracle: Account<'info, RateOracle>,
}
