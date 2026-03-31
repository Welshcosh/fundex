import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const RPC_URL = "https://api.devnet.solana.com";
const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT ?? "BqLbRiRvDNMzryGjtAh9qn44iM4F2VPD3Df7m4MsV5e4"
);

/** 1000 USDC in lamports (6 decimals) */
const FAUCET_AMOUNT = 1_000_000_000;

/** Rate limit: one airdrop per wallet per 10 minutes */
const lastDrop = new Map<string, number>();
const COOLDOWN_MS = 1 * 60 * 1000;

export async function POST(req: NextRequest) {
  const { wallet } = await req.json();
  if (!wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 });

  let walletPubkey: PublicKey;
  try {
    walletPubkey = new PublicKey(wallet);
  } catch {
    return NextResponse.json({ error: "invalid wallet address" }, { status: 400 });
  }

  // Rate limit
  const last = lastDrop.get(wallet) ?? 0;
  const remaining = COOLDOWN_MS - (Date.now() - last);
  if (remaining > 0) {
    return NextResponse.json(
      { error: `Rate limited. Try again in ${Math.ceil(remaining / 60000)} minutes.` },
      { status: 429 }
    );
  }

  // Load admin keypair from env
  const adminSecretRaw = process.env.ADMIN_SECRET_KEY;
  if (!adminSecretRaw) {
    return NextResponse.json({ error: "Faucet not configured (missing ADMIN_SECRET_KEY)" }, { status: 500 });
  }

  let adminKeypair: Keypair;
  try {
    const secret = JSON.parse(adminSecretRaw) as number[];
    adminKeypair = Keypair.fromSecretKey(Uint8Array.from(secret));
  } catch {
    return NextResponse.json({ error: "Faucet misconfigured" }, { status: 500 });
  }

  const conn = new Connection(RPC_URL, "confirmed");
  const userAta = getAssociatedTokenAddressSync(USDC_MINT, walletPubkey);

  try {
    const tx = new Transaction();

    // Create ATA if it doesn't exist
    const ataInfo = await conn.getAccountInfo(userAta);
    if (!ataInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          adminKeypair.publicKey,
          userAta,
          walletPubkey,
          USDC_MINT,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
    }

    tx.add(
      createMintToInstruction(
        USDC_MINT,
        userAta,
        adminKeypair.publicKey,
        FAUCET_AMOUNT
      )
    );

    const sig = await sendAndConfirmTransaction(conn, tx, [adminKeypair], {
      commitment: "confirmed",
    });

    lastDrop.set(wallet, Date.now());
    return NextResponse.json({ sig, amount: FAUCET_AMOUNT / 1_000_000 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg.slice(0, 200) }, { status: 500 });
  }
}
