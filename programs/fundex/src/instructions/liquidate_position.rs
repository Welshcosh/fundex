use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::constants::*;
use crate::errors::FundexError;
use crate::events::PositionLiquidated;
use crate::state::{MarketState, Position};

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

    // Transfer reward from vault → liquidator
    if liquidator_reward > 0 {
        let perp_bytes = market.perp_index.to_le_bytes();
        let seeds: &[&[u8]] = &[
            SEED_MARKET,
            &perp_bytes,
            &[market.duration_variant],
            &[market.bump],
        ];
        let signer_seeds = &[seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.liquidator_token_account.to_account_info(),
                    authority: market.to_account_info(),
                },
                signer_seeds,
            ),
            liquidator_reward,
        )?;
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
        token::authority = liquidator,
    )]
    pub liquidator_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}
