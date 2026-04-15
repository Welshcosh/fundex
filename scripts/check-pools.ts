import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("BVyfQfmD6yCXqgqGQm6heYg85WYypqVxLnxb7MrGEKPb");
const NAMES = ["BTC", "ETH", "SOL", "JTO"];
const DURS  = ["7D", "30D", "90D", "180D"];

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  for (const p of [0, 1, 2, 3]) {
    for (const d of [0, 1, 2, 3]) {
      const pb = Buffer.alloc(2); pb.writeUInt16LE(p);
      const [mkt] = PublicKey.findProgramAddressSync([Buffer.from("market"), pb, Buffer.from([d])], PROGRAM_ID);
      const [pool] = PublicKey.findProgramAddressSync([Buffer.from("pool"), mkt.toBuffer()], PROGRAM_ID);
      const [pv]   = PublicKey.findProgramAddressSync([Buffer.from("pool_vault"), mkt.toBuffer()], PROGRAM_ID);
      const poolInfo = await provider.connection.getAccountInfo(pool);
      const pvInfo   = await provider.connection.getAccountInfo(pv);
      const poolStr  = poolInfo ? `${poolInfo.data.length}b` : "MISSING";
      const pvStr    = pvInfo   ? `${pvInfo.data.length}b`   : "MISSING";
      console.log(`${NAMES[p]} ${DURS[d]}: pool=${poolStr} vault=${pvStr}`);
    }
  }
}

main().catch(console.error);
