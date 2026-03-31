use anchor_lang::prelude::*;
use crate::constants::*;
use crate::state::RateOracle;
use crate::events::OracleInitialized;

pub fn handler(ctx: Context<InitializeRateOracle>, perp_index: u16) -> Result<()> {
    let oracle = &mut ctx.accounts.oracle;
    oracle.perp_index = perp_index;
    oracle.ema_funding_rate = 0;
    oracle.last_update_ts = Clock::get()?.unix_timestamp;
    oracle.num_samples = 0;
    oracle.bump = ctx.bumps.oracle;

    emit!(OracleInitialized {
        perp_index,
        oracle: oracle.key(),
        slot: Clock::get()?.slot,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(perp_index: u16)]
pub struct InitializeRateOracle<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = RateOracle::LEN,
        seeds = [SEED_RATE_ORACLE, &perp_index.to_le_bytes()],
        bump,
    )]
    pub oracle: Account<'info, RateOracle>,

    pub system_program: Program<'info, System>,
}
