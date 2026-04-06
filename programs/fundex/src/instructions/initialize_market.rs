use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};
use crate::constants::*;
use crate::errors::FundexError;
use crate::events::MarketInitialized;
use crate::state::{MarketState, RateOracle};

pub fn handler(
    ctx: Context<InitializeMarket>,
    perp_index: u16,
    duration_variant: u8,          // 0=7d, 1=30d, 2=90d, 3=180d
    fixed_rate_override: Option<i64>, // None → use oracle EMA (V2)
) -> Result<()> {
    let clock = Clock::get()?;
    let oracle = &ctx.accounts.oracle;

    // Determine fixed rate
    let fixed_rate = match fixed_rate_override {
        Some(rate) => {
            require!(rate.abs() <= MAX_FIXED_RATE_ABS, FundexError::FixedRateOutOfBounds);
            rate
        }
        None => {
            // V2: auto-set from oracle EMA
            require!(
                oracle.num_samples >= MIN_ORACLE_SAMPLES,
                FundexError::OracleNotReady
            );
            oracle.ema_funding_rate
        }
    };

    let duration_secs = MarketState::duration_seconds(duration_variant)
        .ok_or(FundexError::InvalidDuration)?;

    let market = &mut ctx.accounts.market;
    market.perp_index = perp_index;
    market.duration_variant = duration_variant;
    market.fixed_rate = fixed_rate;
    market.notional_per_lot = 100_000_000; // 100 USDC (6 decimals)
    market.expiry_ts = clock.unix_timestamp + duration_secs;
    market.collateral_mint = ctx.accounts.collateral_mint.key();
    market.cumulative_actual_index = 0;
    market.cumulative_fixed_index = 0;
    market.last_settled_ts = clock.unix_timestamp;
    market.total_fixed_payer_lots = 0;
    market.total_fixed_receiver_lots = 0;
    market.total_collateral = 0;
    market.is_active = true;
    market.admin = ctx.accounts.admin.key();
    market.bump = ctx.bumps.market;
    market.vault_bump = ctx.bumps.vault;

    emit!(MarketInitialized {
        market: market.key(),
        perp_index,
        duration_variant,
        fixed_rate,
        expiry_ts: market.expiry_ts,
        notional_per_lot: market.notional_per_lot,
        slot: clock.slot,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(perp_index: u16, duration_variant: u8)]
pub struct InitializeMarket<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [SEED_RATE_ORACLE, &perp_index.to_le_bytes()],
        bump = oracle.bump,
    )]
    pub oracle: Account<'info, RateOracle>,

    #[account(
        init,
        payer = admin,
        space = MarketState::LEN,
        seeds = [SEED_MARKET, &perp_index.to_le_bytes(), &[duration_variant]],
        bump,
    )]
    pub market: Account<'info, MarketState>,

    /// Token account controlled by market PDA — holds all collateral
    #[account(
        init,
        payer = admin,
        seeds = [SEED_VAULT, market.key().as_ref()],
        bump,
        token::mint = collateral_mint,
        token::authority = market,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub collateral_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
