import { PublicKey } from "@solana/web3.js";
import { FUNDEX_PROGRAM_ID } from "./constants";

const SEED_RATE_ORACLE = Buffer.from("rate_oracle");
const SEED_MARKET = Buffer.from("market");
const SEED_POSITION = Buffer.from("position");
const SEED_VAULT = Buffer.from("vault");

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
