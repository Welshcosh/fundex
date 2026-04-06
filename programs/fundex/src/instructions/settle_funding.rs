use anchor_lang::prelude::*;
use crate::constants::*;
use crate::errors::FundexError;
use crate::events::FundingSettled;
use crate::state::{MarketState, RateOracle};

/// Called by anyone (crank) once per funding interval.
/// Reads `lastFundingRate` directly from the Drift PerpMarket account at byte
/// offset DRIFT_LAST_FUNDING_RATE_OFFSET, verifying the account is owned by
/// the Drift program. No trusted off-chain input — fully on-chain verified.
///
/// After settlement, `fixed_rate` is updated toward the oracle EMA so that
/// new positions always enter at the market's best estimate of fair value.
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

    // ── Update cumulative indices ─────────────────────────────────────────────
    // Accumulate actual and fixed separately so each position's PnL is isolated
    // to the fixed_rate it agreed to at open, even if fixed_rate changes later.
    let fixed_rate_this_settlement = market.fixed_rate;

    market.cumulative_actual_index = market.cumulative_actual_index
        .checked_add(actual_rate)
        .ok_or(FundexError::MathOverflow)?;
    market.cumulative_fixed_index = market.cumulative_fixed_index
        .checked_add(fixed_rate_this_settlement)
        .ok_or(FundexError::MathOverflow)?;
    market.last_settled_ts = clock.unix_timestamp;

    // ── Update oracle EMA ─────────────────────────────────────────────────────
    oracle.update_ema(actual_rate);
    oracle.last_update_ts = clock.unix_timestamp;

    // ── Update fixed_rate toward oracle EMA (Task 2) ─────────────────────────
    // Once the oracle has enough samples, new positions enter at the EMA rate.
    // Existing positions are unaffected — their PnL uses entry_fixed_index.
    let new_fixed_rate = if oracle.num_samples >= MIN_ORACLE_SAMPLES {
        let clamped = oracle.ema_funding_rate.clamp(-MAX_FIXED_RATE_ABS, MAX_FIXED_RATE_ABS);
        market.fixed_rate = clamped;
        clamped
    } else {
        market.fixed_rate
    };

    emit!(FundingSettled {
        market: market.key(),
        actual_rate,
        fixed_rate: fixed_rate_this_settlement,
        new_fixed_rate,
        new_cumulative_actual_index: market.cumulative_actual_index,
        new_cumulative_fixed_index: market.cumulative_fixed_index,
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
