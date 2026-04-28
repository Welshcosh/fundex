use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::constants::*;
use crate::errors::FundexError;
use crate::events::PositionLiquidated;
use crate::state::{MarketState, PoolState, Position};

pub fn handler(ctx: Context<LiquidatePosition>) -> Result<()> {
    let clock = Clock::get()?;
    let market = &mut ctx.accounts.market;
    let position = &ctx.accounts.position;

    // Check margin is below maintenance threshold
    let margin_bps = position.margin_ratio_bps(market);
    require!(
        margin_bps < MAINT_MARGIN_BPS,
        FundexError::PositionAboveMaintenanceMargin
    );

    let pnl = position.unrealized_pnl(market);
    let skew_pool_pnl = position.skew_pool_pnl(market);

    // Effective collateral after PnL
    let effective_collateral: u64 = if pnl >= 0 {
        position.collateral_deposited.saturating_add(pnl as u64)
    } else {
        position.collateral_deposited.saturating_sub((-pnl) as u64)
    };

    // Liquidator reward = 3% of effective collateral (clamped to vault balance)
    let liquidator_reward = (effective_collateral as u128)
        .saturating_mul(LIQUIDATION_REWARD_BPS as u128)
        .saturating_div(10_000)
        .min(ctx.accounts.vault.amount as u128) as u64;

    let perp_bytes = market.perp_index.to_le_bytes();
    let market_seeds: &[&[u8]] = &[
        SEED_MARKET,
        &perp_bytes,
        &[market.duration_variant],
        &[market.bump],
    ];
    let market_signer = &[market_seeds];

    // Transfer reward from vault → liquidator
    if liquidator_reward > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.liquidator_token_account.to_account_info(),
                    authority: market.to_account_info(),
                },
                market_signer,
            ),
            liquidator_reward,
        )?;
    }

    // β: realise skew premium between vault and pool_vault — same logic as
    // close_position. The liquidated position's locked skew flow still nets
    // to the LP, so don't strand it in vault.
    let market_key = market.key();
    let pool_bump = ctx.accounts.pool.bump;
    let pool_seeds: &[&[u8]] = &[SEED_POOL, market_key.as_ref(), &[pool_bump]];
    let pool_signer = &[pool_seeds];

    if skew_pool_pnl > 0 {
        let amt = (skew_pool_pnl as u64)
            .min(ctx.accounts.vault.amount.saturating_sub(liquidator_reward));
        if amt > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.pool_vault.to_account_info(),
                        authority: market.to_account_info(),
                    },
                    market_signer,
                ),
                amt,
            )?;
            market.total_collateral = market.total_collateral.saturating_sub(amt);
        }
    } else if skew_pool_pnl < 0 {
        let amt = ((-skew_pool_pnl) as u64).min(ctx.accounts.pool_vault.amount);
        if amt > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.pool_vault.to_account_info(),
                        to: ctx.accounts.vault.to_account_info(),
                        authority: ctx.accounts.pool.to_account_info(),
                    },
                    pool_signer,
                ),
                amt,
            )?;
            market.total_collateral = market.total_collateral.saturating_add(amt);
        }
    }

    // Remaining collateral (effective - reward) stays in vault to cover other side's PnL
    // Update market totals
    if position.side == 0 {
        market.total_fixed_payer_lots = market.total_fixed_payer_lots.saturating_sub(position.lots);
    } else {
        market.total_fixed_receiver_lots = market.total_fixed_receiver_lots.saturating_sub(position.lots);
    }
    market.total_collateral = market.total_collateral.saturating_sub(liquidator_reward);

    emit!(PositionLiquidated {
        user: position.user,
        liquidator: ctx.accounts.liquidator.key(),
        market: market.key(),
        collateral_deposited: position.collateral_deposited,
        unrealized_pnl: pnl,
        liquidator_reward,
        skew_pool_pnl,
        slot: clock.slot,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct LiquidatePosition<'info> {
    #[account(mut)]
    pub liquidator: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_MARKET, &market.perp_index.to_le_bytes(), &[market.duration_variant]],
        bump = market.bump,
    )]
    pub market: Account<'info, MarketState>,

    /// The position being liquidated (any user)
    #[account(
        mut,
        seeds = [SEED_POSITION, position.user.as_ref(), market.key().as_ref()],
        bump = position.bump,
        has_one = market @ FundexError::Unauthorized,
        close = liquidator,
    )]
    pub position: Account<'info, Position>,

    // BPF stack is 4 KB per frame. Box() the fat token-account fields so their
    // deserialised data lives on the heap, not the stack — required after we
    // added pool + pool_vault to this struct.
    #[account(
        mut,
        seeds = [SEED_VAULT, market.key().as_ref()],
        bump = market.vault_bump,
        token::mint = market.collateral_mint,
        token::authority = market,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    /// β: pool state — receives or pays the position's locked skew premium at liquidation
    #[account(
        seeds = [SEED_POOL, market.key().as_ref()],
        bump = pool.bump,
        has_one = market @ FundexError::Unauthorized,
    )]
    pub pool: Box<Account<'info, PoolState>>,

    /// β: pool vault — counterparty for the skew transfer
    #[account(
        mut,
        seeds = [SEED_POOL_VAULT, market.key().as_ref()],
        bump = pool.pool_vault_bump,
        token::mint = market.collateral_mint,
        token::authority = pool,
    )]
    pub pool_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = market.collateral_mint,
        token::authority = liquidator,
    )]
    pub liquidator_token_account: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}
