use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("E7bxJfAT1quS1CLV1zWeVVnSD5m6oHLHequ5mgqgqMQa");

#[program]
pub mod fundex {
    use super::*;

    pub fn initialize_rate_oracle(
        ctx: Context<InitializeRateOracle>,
        perp_index: u16,
    ) -> Result<()> {
        instructions::initialize_rate_oracle::handler(ctx, perp_index)
    }

    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        perp_index: u16,
        duration_variant: u8,
        fixed_rate_override: Option<i64>,
        skew_k_override: Option<i64>,
    ) -> Result<()> {
        instructions::initialize_market::handler(
            ctx,
            perp_index,
            duration_variant,
            fixed_rate_override,
            skew_k_override,
        )
    }

    pub fn open_position(
        ctx: Context<OpenPosition>,
        side: u8,
        lots: u64,
    ) -> Result<()> {
        instructions::open_position::handler(ctx, side, lots)
    }

    pub fn settle_funding(ctx: Context<SettleFunding>) -> Result<()> {
        instructions::settle_funding::handler(ctx)
    }

    pub fn close_position(ctx: Context<ClosePosition>) -> Result<()> {
        instructions::close_position::handler(ctx)
    }

    pub fn liquidate_position(ctx: Context<LiquidatePosition>) -> Result<()> {
        instructions::liquidate_position::handler(ctx)
    }

    pub fn initialize_pool(ctx: Context<InitializePool>) -> Result<()> {
        instructions::initialize_pool::handler(ctx)
    }

    pub fn deposit_lp(ctx: Context<DepositLp>, amount: u64) -> Result<()> {
        instructions::deposit_lp::handler(ctx, amount)
    }

    pub fn withdraw_lp(ctx: Context<WithdrawLp>, shares: u64) -> Result<()> {
        instructions::withdraw_lp::handler(ctx, shares)
    }

    pub fn sync_pool_pnl(ctx: Context<SyncPoolPnl>) -> Result<()> {
        instructions::sync_pool_pnl::handler(ctx)
    }

    pub fn close_pool(ctx: Context<ClosePool>) -> Result<()> {
        instructions::close_pool::handler(ctx)
    }

    pub fn close_market(ctx: Context<CloseMarket>) -> Result<()> {
        instructions::close_market::handler(ctx)
    }

    pub fn admin_reset_oracle(ctx: Context<AdminResetOracle>) -> Result<()> {
        instructions::admin_reset_oracle::handler(ctx)
    }
}
