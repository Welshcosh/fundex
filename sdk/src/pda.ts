import { PublicKey } from "@solana/web3.js";
import {
  FUNDEX_PROGRAM_ID,
  SEED_RATE_ORACLE,
  SEED_MARKET,
  SEED_POSITION,
  SEED_VAULT,
  SEED_POOL,
  SEED_POOL_VAULT,
  SEED_LP_POSITION,
} from "./constants";

export function oraclePda(
  perpIndex: number,
  programId: PublicKey = FUNDEX_PROGRAM_ID
): [PublicKey, number] {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(perpIndex);
  return PublicKey.findProgramAddressSync(
    [SEED_RATE_ORACLE, buf],
    programId
  );
}

export function marketPda(
  perpIndex: number,
  durationVariant: number,
  programId: PublicKey = FUNDEX_PROGRAM_ID
): [PublicKey, number] {
  const perpBuf = Buffer.alloc(2);
  perpBuf.writeUInt16LE(perpIndex);
  return PublicKey.findProgramAddressSync(
    [SEED_MARKET, perpBuf, Buffer.from([durationVariant])],
    programId
  );
}

export function vaultPda(
  market: PublicKey,
  programId: PublicKey = FUNDEX_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED_VAULT, market.toBuffer()],
    programId
  );
}

export function positionPda(
  user: PublicKey,
  market: PublicKey,
  programId: PublicKey = FUNDEX_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED_POSITION, user.toBuffer(), market.toBuffer()],
    programId
  );
}

export function poolPda(
  market: PublicKey,
  programId: PublicKey = FUNDEX_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED_POOL, market.toBuffer()],
    programId
  );
}

export function poolVaultPda(
  market: PublicKey,
  programId: PublicKey = FUNDEX_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED_POOL_VAULT, market.toBuffer()],
    programId
  );
}

export function lpPositionPda(
  user: PublicKey,
  pool: PublicKey,
  programId: PublicKey = FUNDEX_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED_LP_POSITION, user.toBuffer(), pool.toBuffer()],
    programId
  );
}
