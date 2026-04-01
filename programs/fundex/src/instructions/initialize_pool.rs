use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};
use crate::constants::*;
use crate::state::{MarketState, PoolState};

pub fn handler(ctx: Context<InitializePool>) -> Result<()> {
    let market = &ctx.accounts.market;
    let pool = &mut ctx.accounts.pool;

    pool.market = market.key();
    pool.total_shares = 0;
    pool.last_rate_index = market.cumulative_rate_index;
    pool.last_net_lots = market.total_fixed_payer_lots as i64
        - market.total_fixed_receiver_lots as i64;
    pool.bump = ctx.bumps.pool;
    pool.pool_vault_bump = ctx.bumps.pool_vault;

    Ok(())
}

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [SEED_MARKET, &market.perp_index.to_le_bytes(), &[market.duration_variant]],
        bump = market.bump,
    )]
    pub market: Account<'info, MarketState>,

    #[account(
        init,
        payer = admin,
        space = PoolState::LEN,
        seeds = [SEED_POOL, market.key().as_ref()],
        bump,
    )]
    pub pool: Account<'info, PoolState>,

    #[account(
        init,
        payer = admin,
        seeds = [SEED_POOL_VAULT, market.key().as_ref()],
        bump,
        token::mint = collateral_mint,
        token::authority = pool,
    )]
    pub pool_vault: Account<'info, TokenAccount>,

    pub collateral_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
