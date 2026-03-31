use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::constants::*;
use crate::errors::FundexError;
use crate::events::PositionOpened;
use crate::state::{MarketState, Position};

pub fn handler(ctx: Context<OpenPosition>, side: u8, lots: u64) -> Result<()> {
    require!(side <= 1, FundexError::InvalidSide);
    require!(lots > 0, FundexError::InvalidLots);

    let clock = Clock::get()?;
    let market = &mut ctx.accounts.market;

    require!(market.is_active, FundexError::MarketInactive);
    require!(clock.unix_timestamp < market.expiry_ts, FundexError::MarketExpired);

    // collateral = lots * notional_per_lot * INITIAL_MARGIN_BPS / 10_000
    let notional = (market.notional_per_lot as u128)
        .checked_mul(lots as u128)
        .ok_or(FundexError::MathOverflow)?;
    let collateral = notional
        .checked_mul(INITIAL_MARGIN_BPS as u128)
        .ok_or(FundexError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(FundexError::MathOverflow)? as u64;

    // Transfer collateral from user → vault
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
    position.entry_rate_index = market.cumulative_rate_index;
    position.open_ts = clock.unix_timestamp;
    position.bump = ctx.bumps.position;

    emit!(PositionOpened {
        user: position.user,
        market: market.key(),
        side,
        lots,
        collateral_deposited: collateral,
        entry_rate_index: market.cumulative_rate_index,
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

    #[account(
        mut,
        token::mint = market.collateral_mint,
        token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
