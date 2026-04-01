use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::constants::*;
use crate::errors::FundexError;
use crate::state::{MarketState, PoolState, LpPosition};

pub fn handler(ctx: Context<WithdrawLp>, shares: u64) -> Result<()> {
    require!(shares > 0, FundexError::InvalidLots);
    require!(ctx.accounts.lp_position.shares >= shares, FundexError::InsufficientShares);
    require!(ctx.accounts.pool.total_shares > 0, FundexError::PoolEmpty);

    let pool_vault_balance = ctx.accounts.pool_vault.amount;
    let total_shares = ctx.accounts.pool.total_shares;
    let pool_bump = ctx.accounts.pool.bump;
    let market_key = ctx.accounts.market.key();

    // payout = shares * vault_balance / total_shares
    let payout = (shares as u128)
        .checked_mul(pool_vault_balance as u128)
        .ok_or(FundexError::MathOverflow)?
        .checked_div(total_shares as u128)
        .ok_or(FundexError::MathOverflow)? as u64;

    require!(payout <= pool_vault_balance, FundexError::InsufficientPoolBalance);

    // Transfer: pool_vault → user (pool PDA signs)
    if payout > 0 {
        let pool_seeds: &[&[u8]] = &[SEED_POOL, market_key.as_ref(), &[pool_bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.pool_vault.to_account_info(),
                    to: ctx.accounts.user_token_account.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                &[pool_seeds],
            ),
            payout,
        )?;
    }

    // Update state
    ctx.accounts.pool.total_shares = ctx.accounts.pool.total_shares.saturating_sub(shares);
    ctx.accounts.lp_position.shares = ctx.accounts.lp_position.shares.saturating_sub(shares);

    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawLp<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub market: Account<'info, MarketState>,

    #[account(
        mut,
        seeds = [SEED_POOL, market.key().as_ref()],
        bump = pool.bump,
        has_one = market @ FundexError::Unauthorized,
    )]
    pub pool: Account<'info, PoolState>,

    #[account(
        mut,
        seeds = [SEED_LP_POSITION, user.key().as_ref(), pool.key().as_ref()],
        bump = lp_position.bump,
        has_one = user @ FundexError::Unauthorized,
        has_one = pool @ FundexError::Unauthorized,
    )]
    pub lp_position: Account<'info, LpPosition>,

    #[account(
        mut,
        seeds = [SEED_POOL_VAULT, market.key().as_ref()],
        bump = pool.pool_vault_bump,
        token::mint = market.collateral_mint,
        token::authority = pool,
    )]
    pub pool_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = market.collateral_mint,
        token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}
