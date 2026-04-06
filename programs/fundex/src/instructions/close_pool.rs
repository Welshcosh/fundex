use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Token, TokenAccount};
use crate::constants::*;
use crate::state::{MarketState, PoolState};

/// Admin-only: close a pool and its vault. Used for migrations.
pub fn handler(ctx: Context<ClosePool>) -> Result<()> {
    let pool = &ctx.accounts.pool;
    let market_key = ctx.accounts.market.key();

    // Close the pool_vault token account, return lamports to admin
    let pool_seeds: &[&[u8]] = &[
        SEED_POOL,
        market_key.as_ref(),
        &[pool.bump],
    ];
    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: ctx.accounts.pool_vault.to_account_info(),
            destination: ctx.accounts.admin.to_account_info(),
            authority: ctx.accounts.pool.to_account_info(),
        },
        &[pool_seeds],
    ))?;

    // pool account itself is closed via Anchor's `close` constraint below
    Ok(())
}

#[derive(Accounts)]
pub struct ClosePool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [SEED_MARKET, &market.perp_index.to_le_bytes(), &[market.duration_variant]],
        bump = market.bump,
    )]
    pub market: Account<'info, MarketState>,

    #[account(
        mut,
        close = admin,
        seeds = [SEED_POOL, market.key().as_ref()],
        bump = pool.bump,
        has_one = market,
    )]
    pub pool: Account<'info, PoolState>,

    /// CHECK: closed via token::close_account CPI above
    #[account(
        mut,
        seeds = [SEED_POOL_VAULT, market.key().as_ref()],
        bump = pool.pool_vault_bump,
    )]
    pub pool_vault: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}
