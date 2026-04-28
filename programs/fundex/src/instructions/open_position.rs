use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::constants::*;
use crate::errors::FundexError;
use crate::events::PositionOpened;
use crate::state::{MarketState, Position, RateOracle};

pub fn handler(ctx: Context<OpenPosition>, side: u8, lots: u64) -> Result<()> {
    require!(side <= 1, FundexError::InvalidSide);
    require!(lots > 0, FundexError::InvalidLots);

    let clock = Clock::get()?;
    let market = &mut ctx.accounts.market;
    let oracle = &ctx.accounts.oracle;

    require!(market.is_active, FundexError::MarketInactive);
    require!(clock.unix_timestamp < market.expiry_ts, FundexError::MarketExpired);

    // β: snapshot the skew premium NEW entrants see, BEFORE adding this trade's
    // lots to the running totals. This is the rate the user is locking in.
    let entry_skew_premium = market.current_skew_premium();
    let entry_settlement_count = market.settlement_count;

    // α: time-weighted entry pre-bias.
    // We don't know the next settlement's actual_rate yet, so use the oracle
    // EMA as the unbiased best estimate for the partial interval that already
    // elapsed at open. The fixed leg is deterministic (market.fixed_rate).
    //
    //   elapsed = clamp(now − last_settled_ts, 0, FUNDING_INTERVAL)
    //   frac_e6 = elapsed × 1e6 / FUNDING_INTERVAL
    //   entry_actual_index += ema × frac_e6 / 1e6   (best-estimate)
    //   entry_fixed_index  += fixed_rate × frac_e6 / 1e6  (exact)
    //
    // Net effect: at the next settlement, this position's Δactual/Δfixed only
    // reflect the (1 − frac) tail of the interval, closing the "free funding"
    // exploit where opening just before settlement collected a full interval.
    let elapsed_raw = clock.unix_timestamp.saturating_sub(market.last_settled_ts);
    let elapsed = elapsed_raw.clamp(0, FUNDING_INTERVAL);
    let frac_e6: i64 = ((elapsed as i128).saturating_mul(1_000_000) / FUNDING_INTERVAL as i128) as i64;
    let actual_partial = ((oracle.ema_funding_rate as i128).saturating_mul(frac_e6 as i128) / 1_000_000) as i64;
    let fixed_partial = ((market.fixed_rate as i128).saturating_mul(frac_e6 as i128) / 1_000_000) as i64;

    // collateral = lots * notional_per_lot * INITIAL_MARGIN_BPS / 10_000
    let notional = (market.notional_per_lot as u128)
        .checked_mul(lots as u128)
        .ok_or(FundexError::MathOverflow)?;
    let collateral = notional
        .checked_mul(INITIAL_MARGIN_BPS as u128)
        .ok_or(FundexError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(FundexError::MathOverflow)? as u64;

    // AMM-style LP fee: charged when this position increases net imbalance.
    // Fee scales with imbalance ratio: base 0.3% + up to 0.7% premium → max 1.0%
    // This creates AMM-like spread pricing — the more imbalanced the market,
    // the more expensive it is to push it further out of balance.
    //
    // side=0 (Payer) increases imbalance if payer_lots >= receiver_lots
    // side=1 (Receiver) increases imbalance if receiver_lots >= payer_lots
    let increases_imbalance = if side == 0 {
        market.total_fixed_payer_lots >= market.total_fixed_receiver_lots
    } else {
        market.total_fixed_receiver_lots >= market.total_fixed_payer_lots
    };
    let lp_fee = if increases_imbalance {
        // imbalance_ratio in [0, 10_000]: |payer - receiver| / (payer + receiver)
        let total_lots = market.total_fixed_payer_lots
            .saturating_add(market.total_fixed_receiver_lots);
        let net_lots_abs = if market.total_fixed_payer_lots > market.total_fixed_receiver_lots {
            market.total_fixed_payer_lots - market.total_fixed_receiver_lots
        } else {
            market.total_fixed_receiver_lots - market.total_fixed_payer_lots
        };
        let imbalance_ratio = if total_lots > 0 {
            (net_lots_abs as u128)
                .saturating_mul(10_000)
                .saturating_div(total_lots as u128)
                .min(10_000)
        } else {
            0
        };
        // dynamic_fee_bps = BASE(30) + imbalance_ratio × MAX_PREMIUM(70) / 10_000
        let dynamic_fee_bps = LP_FEE_BPS as u128
            + imbalance_ratio
                .saturating_mul(MAX_IMBALANCE_FEE_BPS as u128)
                .saturating_div(10_000);
        notional
            .checked_mul(dynamic_fee_bps)
            .ok_or(FundexError::MathOverflow)?
            .checked_div(10_000)
            .ok_or(FundexError::MathOverflow)? as u64
    } else {
        0
    };

    // Transfer collateral: user → vault
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        collateral,
    )?;

    // Transfer LP fee: user → pool_vault (if fee > 0)
    if lp_fee > 0 {
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token_account.to_account_info(),
                    to: ctx.accounts.pool_vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            lp_fee,
        )?;
    }

    // Update market state
    if side == 0 {
        market.total_fixed_payer_lots = market.total_fixed_payer_lots
            .checked_add(lots)
            .ok_or(FundexError::MathOverflow)?;
    } else {
        market.total_fixed_receiver_lots = market.total_fixed_receiver_lots
            .checked_add(lots)
            .ok_or(FundexError::MathOverflow)?;
    }
    market.total_collateral = market.total_collateral
        .checked_add(collateral)
        .ok_or(FundexError::MathOverflow)?;

    // Initialize position
    let position = &mut ctx.accounts.position;
    position.user = ctx.accounts.user.key();
    position.market = market.key();
    position.side = side;
    position.lots = lots;
    position.collateral_deposited = collateral;
    // α pre-bias: shift entry indices forward by the elapsed-fraction of the
    // current interval at the expected (oracle EMA) and exact (fixed_rate) rates.
    position.entry_actual_index = market
        .cumulative_actual_index
        .saturating_add(actual_partial);
    position.entry_fixed_index = market
        .cumulative_fixed_index
        .saturating_add(fixed_partial);
    position.open_ts = clock.unix_timestamp;
    position.entry_skew_premium = entry_skew_premium;
    position.entry_settlement_count = entry_settlement_count;
    position.bump = ctx.bumps.position;

    emit!(PositionOpened {
        user: position.user,
        market: market.key(),
        side,
        lots,
        collateral_deposited: collateral,
        entry_actual_index: position.entry_actual_index,
        entry_fixed_index: position.entry_fixed_index,
        elapsed_frac_e6: frac_e6,
        entry_skew_premium,
        entry_settlement_count,
        slot: clock.slot,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct OpenPosition<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_MARKET, &market.perp_index.to_le_bytes(), &[market.duration_variant]],
        bump = market.bump,
    )]
    pub market: Account<'info, MarketState>,

    /// α: oracle is read (not mutated) so we can pre-bias entry_actual_index
    /// by the EMA × elapsed_frac for the partial interval at open time.
    #[account(
        seeds = [SEED_RATE_ORACLE, &market.perp_index.to_le_bytes()],
        bump = oracle.bump,
    )]
    pub oracle: Account<'info, RateOracle>,

    #[account(
        init,
        payer = user,
        space = Position::LEN,
        seeds = [SEED_POSITION, user.key().as_ref(), market.key().as_ref()],
        bump,
    )]
    pub position: Account<'info, Position>,

    #[account(
        mut,
        seeds = [SEED_VAULT, market.key().as_ref()],
        bump = market.vault_bump,
        token::mint = market.collateral_mint,
        token::authority = market,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Pool vault — receives LP fee when position increases imbalance
    #[account(
        mut,
        seeds = [SEED_POOL_VAULT, market.key().as_ref()],
        bump,
        token::mint = market.collateral_mint,
    )]
    pub pool_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = market.collateral_mint,
        token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
