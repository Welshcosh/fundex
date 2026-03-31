import { DriftClient, Wallet } from "@drift-labs/sdk";
import { Connection, Keypair } from "@solana/web3.js";

async function main() {
  const rpcUrl =
    process.env.MAINNET_RPC ?? "https://api.mainnet-beta.solana.com";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mainnetConn = new Connection(rpcUrl, "confirmed") as any;

  const dummyKp = Keypair.generate();

  const driftClient = new DriftClient({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connection: mainnetConn as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wallet: new Wallet(dummyKp as any),
    env: "mainnet-beta",
    accountSubscription: { type: "websocket" },
  });

  await driftClient.subscribe();
  await new Promise((r) => setTimeout(r, 3000)); // wait for WS data

  const markets = driftClient.getPerpMarketAccounts();

  // Sort by marketIndex for a clean listing
  markets.sort((a, b) => a.marketIndex - b.marketIndex);

  for (const market of markets) {
    const name = String.fromCharCode(...market.name).replace(/\0/g, "");
    console.log(`index: ${market.marketIndex}  name: ${name}`);
  }

  await driftClient.unsubscribe();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
