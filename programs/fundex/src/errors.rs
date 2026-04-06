use anchor_lang::prelude::*;

#[error_code]
pub enum FundexError {
    #[msg("Oracle not warmed up — need at least MIN_ORACLE_SAMPLES settlements")]
    OracleNotReady,
    #[msg("Market has already expired")]
    MarketExpired,
    #[msg("Market has not expired yet")]
    MarketNotExpired,
    #[msg("Invalid duration: must be 0=7d, 1=30d, 2=90d, 3=180d")]
    InvalidDuration,
    #[msg("Invalid side: must be 0=FixedPayer, 1=FixedReceiver")]
    InvalidSide,
    #[msg("Lots must be greater than zero")]
    InvalidLots,
    #[msg("Too early to settle — funding interval not elapsed")]
    TooEarlyToSettle,
    #[msg("Position is above maintenance margin — cannot liquidate")]
    PositionAboveMaintenanceMargin,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Insufficient vault balance to pay out")]
    InsufficientVaultBalance,
    #[msg("Fixed rate override exceeds allowed bounds")]
    FixedRateOutOfBounds,
    #[msg("Market is not active")]
    MarketInactive,
    #[msg("Insufficient pool vault balance")]
    InsufficientPoolBalance,
    #[msg("Insufficient LP shares to withdraw")]
    InsufficientShares,
    #[msg("Pool has no shares — cannot calculate withdrawal")]
    PoolEmpty,
    #[msg("Drift PerpMarket account has wrong owner or is too small")]
    InvalidDriftAccount,
}
