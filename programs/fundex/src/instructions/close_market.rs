use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Token, TokenAccount};
use crate::constants::*;
use crate::errors::FundexError;
use crate::state::MarketState;

/// Admin-only: close a market and its vault. Only allowed when no collateral remains.
pub fn handler(ctx: Context<CloseMarket>) -> Result<()> {
    let market = &ctx.accounts.market;
    let perp_bytes = market.perp_index.to_le_bytes();

    let market_seeds: &[&[u8]] = &[
        SEED_MARKET,
        &perp_bytes,
        &[market.duration_variant],
        &[market.bump],
    ];

    // Close vault token account, return lamports to admin
    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.admin.to_account_info(),
            authority: ctx.accounts.market.to_account_info(),
        },
        &[market_seeds],
    ))?;

    // market account is closed via Anchor `close` constraint below
    Ok(())
}

#[derive(Accounts)]
pub struct CloseMarket<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        close = admin,
        seeds = [SEED_MARKET, &market.perp_index.to_le_bytes(), &[market.duration_variant]],
        bump = market.bump,
        has_one = admin @ FundexError::Unauthorized,
        constraint = market.total_collateral == 0 @ FundexError::MarketHasOpenPositions,
    )]
    pub market: Account<'info, MarketState>,

    /// CHECK: closed via token::close_account CPI above
    #[account(
        mut,
        seeds = [SEED_VAULT, market.key().as_ref()],
        bump = market.vault_bump,
    )]
    pub vault: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}
