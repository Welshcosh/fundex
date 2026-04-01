import { PublicKey } from "@solana/web3.js";
import { FUNDEX_PROGRAM_ID } from "./constants";

const SEED_RATE_ORACLE = Buffer.from("rate_oracle");
const SEED_MARKET = Buffer.from("market");
const SEED_POSITION = Buffer.from("position");
const SEED_VAULT = Buffer.from("vault");
const SEED_POOL = Buffer.from("pool");
const SEED_POOL_VAULT = Buffer.from("pool_vault");
const SEED_LP_POSITION = Buffer.from("lp_position");

export function oraclePda(perpIndex: number): [PublicKey, number] {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(perpIndex);
  return PublicKey.findProgramAddressSync([SEED_RATE_ORACLE, buf], FUNDEX_PROGRAM_ID);
}

export function marketPda(perpIndex: number, durationVariant: number): [PublicKey, number] {
  const perpBuf = Buffer.alloc(2);
  perpBuf.writeUInt16LE(perpIndex);
  return PublicKey.findProgramAddressSync(
    [SEED_MARKET, perpBuf, Buffer.from([durationVariant])],
    FUNDEX_PROGRAM_ID
  );
}

export function vaultPda(market: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([SEED_VAULT, market.toBuffer()], FUNDEX_PROGRAM_ID);
}

export function positionPda(user: PublicKey, market: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED_POSITION, user.toBuffer(), market.toBuffer()],
    FUNDEX_PROGRAM_ID
  );
}

export function poolPda(market: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([SEED_POOL, market.toBuffer()], FUNDEX_PROGRAM_ID);
}

export function poolVaultPda(market: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([SEED_POOL_VAULT, market.toBuffer()], FUNDEX_PROGRAM_ID);
}

export function lpPositionPda(user: PublicKey, pool: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED_LP_POSITION, user.toBuffer(), pool.toBuffer()],
    FUNDEX_PROGRAM_ID
  );
}
