use anchor_lang::prelude::*;
use crate::constants::*;
use crate::errors::FundexError;
use crate::events::FundingSettled;
use crate::state::{MarketState, RateOracle};

/// Called by anyone (crank) once per funding interval.
/// Reads `lastFundingRate` directly from the Drift PerpMarket account at byte
/// offset DRIFT_LAST_FUNDING_RATE_OFFSET, verifying the account is owned by
/// the Drift program. No trusted off-chain input — fully on-chain verified.
pub fn handler(ctx: Context<SettleFunding>) -> Result<()> {
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

    // ── Read Drift lastFundingRate on-chain ───────────────────────────────────
    let drift_acct = &ctx.accounts.drift_perp_market;

    // Verify owner == Drift program
    let expected_owner = Pubkey::new_from_array(DRIFT_PROGRAM_ID_BYTES);
    require!(
        drift_acct.owner == &expected_owner,
        FundexError::InvalidDriftAccount
    );

    // Read i64 at byte offset DRIFT_LAST_FUNDING_RATE_OFFSET (little-endian)
    let data = drift_acct.try_borrow_data()?;
    require!(
        data.len() >= DRIFT_LAST_FUNDING_RATE_OFFSET + 8,
        FundexError::InvalidDriftAccount
    );
    let raw_bytes: [u8; 8] = data[DRIFT_LAST_FUNDING_RATE_OFFSET..DRIFT_LAST_FUNDING_RATE_OFFSET + 8]
        .try_into()
        .map_err(|_| error!(FundexError::InvalidDriftAccount))?;
    let last_funding_rate = i64::from_le_bytes(raw_bytes);

    // Convert: Drift uses 1e9 precision per hour; we use 1e6 precision per 8h.
    // actual_rate (1e6/8h) = last_funding_rate (1e9/1h) * 8 / 1_000
    let actual_rate = last_funding_rate
        .checked_mul(8)
        .and_then(|v| v.checked_div(1_000))
        .ok_or(error!(FundexError::MathOverflow))?;

    // Clamp to allowed range
    let actual_rate = actual_rate.clamp(-MAX_FIXED_RATE_ABS, MAX_FIXED_RATE_ABS);

    // ── Update market & oracle ────────────────────────────────────────────────
    let delta = actual_rate
        .checked_sub(market.fixed_rate)
        .ok_or(FundexError::MathOverflow)?;
    market.cumulative_rate_index = market.cumulative_rate_index
        .checked_add(delta)
        .ok_or(FundexError::MathOverflow)?;
    market.last_settled_ts = clock.unix_timestamp;

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

    /// Drift PerpMarket account — owner verified on-chain against DRIFT_PROGRAM_ID_BYTES.
    /// CHECK: We verify owner and read lastFundingRate at DRIFT_LAST_FUNDING_RATE_OFFSET.
    pub drift_perp_market: UncheckedAccount<'info>,
}
