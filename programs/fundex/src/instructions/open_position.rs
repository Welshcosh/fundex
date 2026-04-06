use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::constants::*;
use crate::errors::FundexError;
use crate::events::PositionOpened;
use crate::state::{MarketState, Position};

pub fn handler(ctx: Context<OpenPosition>, side: u8, lots: u64) -> Result<()> {
    require!(side <= 1, FundexError::InvalidSide);
    require!(lots > 0, FundexError::InvalidLots);

    let clock = Clock::get()?;
    let market = &mut ctx.accounts.market;

    require!(market.is_active, FundexError::MarketInactive);
    require!(clock.unix_timestamp < market.expiry_ts, FundexError::MarketExpired);

    // collateral = lots * notional_per_lot * INITIAL_MARGIN_BPS / 10_000
    let notional = (market.notional_per_lot as u128)
        .checked_mul(lots as u128)
        .ok_or(FundexError::MathOverflow)?;
    let collateral = notional
        .checked_mul(INITIAL_MARGIN_BPS as u128)
        .ok_or(FundexError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(FundexError::MathOverflow)? as u64;

    // AMM-style LP fee: charged when this position increases net imbalance.
    // Fee scales with imbalance ratio: base 0.3% + up to 0.7% premium → max 1.0%
    // This creates AMM-like spread pricing — the more imbalanced the market,
    // the more expensive it is to push it further out of balance.
    //
    // side=0 (Payer) increases imbalance if payer_lots >= receiver_lots
    // side=1 (Receiver) increases imbalance if receiver_lots >= payer_lots
    let increases_imbalance = if side == 0 {
        market.total_fixed_payer_lots >= market.total_fixed_receiver_lots
    } else {
        market.total_fixed_receiver_lots >= market.total_fixed_payer_lots
    };
    let lp_fee = if increases_imbalance {
        // imbalance_ratio in [0, 10_000]: |payer - receiver| / (payer + receiver)
        let total_lots = market.total_fixed_payer_lots
            .saturating_add(market.total_fixed_receiver_lots);
        let net_lots_abs = if market.total_fixed_payer_lots > market.total_fixed_receiver_lots {
            market.total_fixed_payer_lots - market.total_fixed_receiver_lots
        } else {
            market.total_fixed_receiver_lots - market.total_fixed_payer_lots
        };
        let imbalance_ratio = if total_lots > 0 {
            (net_lots_abs as u128)
                .saturating_mul(10_000)
                .saturating_div(total_lots as u128)
                .min(10_000)
        } else {
            0
        };
        // dynamic_fee_bps = BASE(30) + imbalance_ratio × MAX_PREMIUM(70) / 10_000
        let dynamic_fee_bps = LP_FEE_BPS as u128
            + imbalance_ratio
                .saturating_mul(MAX_IMBALANCE_FEE_BPS as u128)
                .saturating_div(10_000);
        notional
            .checked_mul(dynamic_fee_bps)
            .ok_or(FundexError::MathOverflow)?
            .checked_div(10_000)
            .ok_or(FundexError::MathOverflow)? as u64
    } else {
        0
    };

    // Transfer collateral: user → vault
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        collateral,
    )?;

    // Transfer LP fee: user → pool_vault (if fee > 0)
    if lp_fee > 0 {
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token_account.to_account_info(),
                    to: ctx.accounts.pool_vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            lp_fee,
        )?;
    }

    // Update market state
    if side == 0 {
        market.total_fixed_payer_lots = market.total_fixed_payer_lots
            .checked_add(lots)
            .ok_or(FundexError::MathOverflow)?;
    } else {
        market.total_fixed_receiver_lots = market.total_fixed_receiver_lots
            .checked_add(lots)
            .ok_or(FundexError::MathOverflow)?;
    }
    market.total_collateral = market.total_collateral
        .checked_add(collateral)
        .ok_or(FundexError::MathOverflow)?;

    // Initialize position
    let position = &mut ctx.accounts.position;
    position.user = ctx.accounts.user.key();
    position.market = market.key();
    position.side = side;
    position.lots = lots;
    position.collateral_deposited = collateral;
    position.entry_actual_index = market.cumulative_actual_index;
    position.entry_fixed_index = market.cumulative_fixed_index;
    position.open_ts = clock.unix_timestamp;
    position.bump = ctx.bumps.position;

    emit!(PositionOpened {
        user: position.user,
        market: market.key(),
        side,
        lots,
        collateral_deposited: collateral,
        entry_actual_index: market.cumulative_actual_index,
        entry_fixed_index: market.cumulative_fixed_index,
        slot: clock.slot,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct OpenPosition<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_MARKET, &market.perp_index.to_le_bytes(), &[market.duration_variant]],
        bump = market.bump,
    )]
    pub market: Account<'info, MarketState>,

    #[account(
        init,
        payer = user,
        space = Position::LEN,
        seeds = [SEED_POSITION, user.key().as_ref(), market.key().as_ref()],
        bump,
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

    /// Pool vault — receives LP fee when position increases imbalance
    #[account(
        mut,
        seeds = [SEED_POOL_VAULT, market.key().as_ref()],
        bump,
        token::mint = market.collateral_mint,
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
