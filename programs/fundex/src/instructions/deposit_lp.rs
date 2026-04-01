use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::constants::*;
use crate::errors::FundexError;
use crate::state::{MarketState, PoolState, LpPosition};

pub fn handler(ctx: Context<DepositLp>, amount: u64) -> Result<()> {
    require!(amount > 0, FundexError::InvalidLots);

    let pool_vault_balance = ctx.accounts.pool_vault.amount;
    let total_shares = ctx.accounts.pool.total_shares;

    // Shares to mint: 1:1 on first deposit, proportional thereafter.
    let new_shares: u64 = if total_shares == 0 || pool_vault_balance == 0 {
        amount
    } else {
        (amount as u128)
            .checked_mul(total_shares as u128)
            .ok_or(FundexError::MathOverflow)?
            .checked_div(pool_vault_balance as u128)
            .ok_or(FundexError::MathOverflow)? as u64
    };
    require!(new_shares > 0, FundexError::InvalidLots);

    // Transfer USDC: user → pool_vault
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.pool_vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;

    // Update pool shares
    ctx.accounts.pool.total_shares = ctx.accounts.pool.total_shares
        .checked_add(new_shares)
        .ok_or(FundexError::MathOverflow)?;

    // Update LP position
    let lp = &mut ctx.accounts.lp_position;
    lp.user = ctx.accounts.user.key();
    lp.pool = ctx.accounts.pool.key();
    lp.shares = lp.shares
        .checked_add(new_shares)
        .ok_or(FundexError::MathOverflow)?;
    lp.bump = ctx.bumps.lp_position;

    Ok(())
}

#[derive(Accounts)]
pub struct DepositLp<'info> {
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
        init_if_needed,
        payer = user,
        space = LpPosition::LEN,
        seeds = [SEED_LP_POSITION, user.key().as_ref(), pool.key().as_ref()],
        bump,
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
    pub system_program: Program<'info, System>,
}
