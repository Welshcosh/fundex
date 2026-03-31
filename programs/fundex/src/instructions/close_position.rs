use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::constants::*;
use crate::errors::FundexError;
use crate::events::PositionClosed;
use crate::state::{MarketState, Position};

pub fn handler(ctx: Context<ClosePosition>) -> Result<()> {
    let clock = Clock::get()?;
    let market = &mut ctx.accounts.market;
    let position = &ctx.accounts.position;

    let pnl = position.unrealized_pnl(market);

    // Payout = deposited collateral ± PnL, clamped to vault balance
    let payout: u64 = if pnl >= 0 {
        position
            .collateral_deposited
            .saturating_add(pnl as u64)
            .min(ctx.accounts.vault.amount) // cannot exceed vault
    } else {
        position
            .collateral_deposited
            .saturating_sub((-pnl) as u64)
    };

    // Transfer from vault → user
    if payout > 0 {
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
                    to: ctx.accounts.user_token_account.to_account_info(),
                    authority: market.to_account_info(),
                },
                signer_seeds,
            ),
            payout,
        )?;
    }

    // Update market totals
    if position.side == 0 {
        market.total_fixed_payer_lots = market.total_fixed_payer_lots.saturating_sub(position.lots);
    } else {
        market.total_fixed_receiver_lots = market.total_fixed_receiver_lots.saturating_sub(position.lots);
    }
    market.total_collateral = market.total_collateral.saturating_sub(payout);

    emit!(PositionClosed {
        user: position.user,
        market: market.key(),
        side: position.side,
        lots: position.lots,
        collateral_deposited: position.collateral_deposited,
        unrealized_pnl: pnl,
        payout,
        slot: clock.slot,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct ClosePosition<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_MARKET, &market.perp_index.to_le_bytes(), &[market.duration_variant]],
        bump = market.bump,
    )]
    pub market: Account<'info, MarketState>,

    #[account(
        mut,
        seeds = [SEED_POSITION, user.key().as_ref(), market.key().as_ref()],
        bump = position.bump,
        has_one = user @ FundexError::Unauthorized,
        has_one = market @ FundexError::Unauthorized,
        close = user,
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
}
