use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::constants::*;
use crate::errors::FundexError;
use crate::state::{MarketState, PoolState};

/// Permissionless: anyone can call to rebalance pool based on net market imbalance.
/// Transfers USDC between user_vault and pool_vault proportional to
/// pool_pnl = -last_net_lots * rate_delta * notional_per_lot / DRIFT_PRICE_PRECISION
pub fn handler(ctx: Context<SyncPoolPnl>) -> Result<()> {
    // Snapshot values before any borrows
    let market_key = ctx.accounts.market.key();
    let market_perp = ctx.accounts.market.perp_index;
    let market_dur = ctx.accounts.market.duration_variant;
    let market_bump = ctx.accounts.market.bump;
    let market_notional = ctx.accounts.market.notional_per_lot;
    let market_rate_index = ctx.accounts.market.cumulative_rate_index;
    let market_payer_lots = ctx.accounts.market.total_fixed_payer_lots;
    let market_receiver_lots = ctx.accounts.market.total_fixed_receiver_lots;

    let pool_bump = ctx.accounts.pool.bump;
    let last_rate_index = ctx.accounts.pool.last_rate_index;
    let last_net_lots = ctx.accounts.pool.last_net_lots;

    // rate_delta since last sync
    let rate_delta = market_rate_index.wrapping_sub(last_rate_index);

    // pool_pnl = -(last_net_lots) * rate_delta * notional_per_lot / precision
    // Positive = pool gained; Negative = pool lost
    let raw = (last_net_lots as i128)
        .saturating_mul(rate_delta as i128)
        .saturating_mul(market_notional as i128)
        / DRIFT_PRICE_PRECISION as i128;
    let pool_pnl = (-raw).clamp(i64::MIN as i128, i64::MAX as i128) as i64;

    if pool_pnl > 0 {
        // Pool gained: transfer from user_vault → pool_vault (market PDA signs)
        let transfer_amount = (pool_pnl as u64).min(ctx.accounts.vault.amount);
        if transfer_amount > 0 {
            let perp_bytes = market_perp.to_le_bytes();
            let market_seeds: &[&[u8]] = &[
                SEED_MARKET,
                &perp_bytes,
                &[market_dur],
                &[market_bump],
            ];
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.pool_vault.to_account_info(),
                        authority: ctx.accounts.market.to_account_info(),
                    },
                    &[market_seeds],
                ),
                transfer_amount,
            )?;
        }
    } else if pool_pnl < 0 {
        // Pool lost: transfer from pool_vault → user_vault (pool PDA signs)
        let transfer_amount = ((-pool_pnl) as u64).min(ctx.accounts.pool_vault.amount);
        if transfer_amount > 0 {
            let pool_seeds: &[&[u8]] = &[
                SEED_POOL,
                market_key.as_ref(),
                &[pool_bump],
            ];
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.pool_vault.to_account_info(),
                        to: ctx.accounts.vault.to_account_info(),
                        authority: ctx.accounts.pool.to_account_info(),
                    },
                    &[pool_seeds],
                ),
                transfer_amount,
            )?;
        }
    }

    // Update pool sync state
    let pool = &mut ctx.accounts.pool;
    pool.last_rate_index = market_rate_index;
    pool.last_net_lots = market_payer_lots as i64 - market_receiver_lots as i64;

    Ok(())
}

#[derive(Accounts)]
pub struct SyncPoolPnl<'info> {
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_MARKET, &market.perp_index.to_le_bytes(), &[market.duration_variant]],
        bump = market.bump,
    )]
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
        seeds = [SEED_VAULT, market.key().as_ref()],
        bump = market.vault_bump,
        token::mint = market.collateral_mint,
        token::authority = market,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [SEED_POOL_VAULT, market.key().as_ref()],
        bump = pool.pool_vault_bump,
        token::mint = market.collateral_mint,
        token::authority = pool,
    )]
    pub pool_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}
