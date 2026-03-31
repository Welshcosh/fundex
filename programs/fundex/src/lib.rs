use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("7UzjwBopedNuBzf5T4CYouJrGqgkQRnjtMAwjxdPFbQk");

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
    ) -> Result<()> {
        instructions::initialize_market::handler(ctx, perp_index, duration_variant, fixed_rate_override)
    }

    pub fn open_position(
        ctx: Context<OpenPosition>,
        side: u8,
        lots: u64,
    ) -> Result<()> {
        instructions::open_position::handler(ctx, side, lots)
    }

    pub fn settle_funding(
        ctx: Context<SettleFunding>,
        actual_rate: i64,
    ) -> Result<()> {
        instructions::settle_funding::handler(ctx, actual_rate)
    }

    pub fn close_position(ctx: Context<ClosePosition>) -> Result<()> {
        instructions::close_position::handler(ctx)
    }

    pub fn liquidate_position(ctx: Context<LiquidatePosition>) -> Result<()> {
        instructions::liquidate_position::handler(ctx)
    }
}
