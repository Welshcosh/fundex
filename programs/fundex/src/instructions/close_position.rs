use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::constants::*;
use crate::errors::FundexError;
use crate::events::PositionClosed;
use crate::state::{MarketState, PoolState, Position};

pub fn handler(ctx: Context<ClosePosition>) -> Result<()> {
    let clock = Clock::get()?;
    let market = &mut ctx.accounts.market;
    let position = &ctx.accounts.position;

    // PnL already includes the skew accrual baked into Position::unrealized_pnl
    let pnl = position.unrealized_pnl(market);
    // β: signed flow vault → pool_vault that realises this position's locked
    // skew premium. + = vault pays pool, − = pool pays vault.
    let skew_pool_pnl = position.skew_pool_pnl(market);

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

    // ── Build PDA seeds we'll need for vault- and pool-authorised transfers ──
    let perp_bytes = market.perp_index.to_le_bytes();
    let market_seeds: &[&[u8]] = &[
        SEED_MARKET,
        &perp_bytes,
        &[market.duration_variant],
        &[market.bump],
    ];
    let market_signer = &[market_seeds];

    // Transfer from vault → user
    if payout > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.user_token_account.to_account_info(),
                    authority: market.to_account_info(),
                },
                market_signer,
            ),
            payout,
        )?;
    }

    // ── β: realise skew premium between vault and pool_vault ─────────────────
    // After paying the user (which already used pnl_with_skew), the vault
    // either holds a surplus (for payers in payer-heavy market) or is short
    // (for receivers being paid the skew bonus). Move the residual to/from
    // the LP pool. Across balanced flows this nets to 0; the residual under
    // imbalance is the LP's compensation for absorbing one-sided risk.
    //
    // Clamping to the source-vault balance keeps the program safe in extreme
    // states; in seeded LP markets it should not bind.
    let market_key = market.key();
    let pool_bump = ctx.accounts.pool.bump;
    let pool_seeds: &[&[u8]] = &[SEED_POOL, market_key.as_ref(), &[pool_bump]];
    let pool_signer = &[pool_seeds];

    if skew_pool_pnl > 0 {
        // vault → pool_vault
        let amt = (skew_pool_pnl as u64).min(ctx.accounts.vault.amount.saturating_sub(payout));
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
        // pool_vault → vault
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
        skew_pool_pnl,
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

    /// β: pool state — receives or pays the position's locked skew premium at close
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
        token::authority = user,
    )]
    pub user_token_account: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}
