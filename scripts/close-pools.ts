/**
 * close-pools.ts — Close all pool accounts so they can be re-initialized.
 * Run this when pool_vault was created with the wrong mint.
 */
import * as anchor from "@coral-xyz/anchor";
import { Fundex } from "../target/types/fundex";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

const PERPS = [0, 1, 2, 3];
const DURATIONS = [0, 1, 2, 3];

function marketPda(perpIndex: number, duration: number, programId: PublicKey): PublicKey {
  const pb = Buffer.alloc(2); pb.writeUInt16LE(perpIndex);
  return PublicKey.findProgramAddressSync([Buffer.from("market"), pb, Buffer.from([duration])], programId)[0];
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Fundex as anchor.Program<Fundex>;
  const admin = provider.wallet.publicKey;

  let closed = 0, skipped = 0;
  for (const perpIndex of PERPS) {
    for (const duration of DURATIONS) {
      const market = marketPda(perpIndex, duration, program.programId);
      const [pool] = PublicKey.findProgramAddressSync([Buffer.from("pool"), market.toBuffer()], program.programId);
      const [poolVault] = PublicKey.findProgramAddressSync([Buffer.from("pool_vault"), market.toBuffer()], program.programId);

      try {
        await program.account.poolState.fetch(pool);
      } catch {
        console.log(`  ~ perp=${perpIndex} dur=${duration}: no pool, skipping`);
        skipped++;
        continue;
      }

      try {
        await (program.methods as any).closePool()
          .accounts({ admin, market, pool, poolVault, tokenProgram: TOKEN_PROGRAM_ID })
          .rpc();
        console.log(`  ✓ Closed pool perp=${perpIndex} dur=${duration}`);
        closed++;
      } catch (e: any) {
        console.error(`  ✗ perp=${perpIndex} dur=${duration}: ${e.message?.slice(0, 80)}`);
      }
    }
  }
  console.log(`Done: ${closed} closed, ${skipped} skipped`);
}

main().catch(console.error);
