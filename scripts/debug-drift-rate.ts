import { DriftClient, Wallet, BN } from "@drift-labs/sdk";
import { Connection, Keypair } from "@solana/web3.js";

async function main() {
  const rpcUrl = process.env.MAINNET_RPC ?? "https://api.mainnet-beta.solana.com";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conn = new Connection(rpcUrl, "confirmed") as any;
  const dummyKp = Keypair.generate();
  const driftClient = new DriftClient({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connection: conn as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wallet: new Wallet(dummyKp as any),
    env: "mainnet-beta",
    accountSubscription: { type: "websocket" },
  });
  await driftClient.subscribe();
  await new Promise((r) => setTimeout(r, 4000));

  const TARGET = [0, 1, 2, 25]; // BTC, ETH, SOL, JTO (from init-pools.ts — verify)
  const markets = driftClient.getPerpMarketAccounts();

  for (const m of markets) {
    if (!TARGET.includes(m.marketIndex)) continue;
    const name = String.fromCharCode(...m.name).replace(/\0/g, "").trim();
    const raw: BN = m.amm.lastFundingRate;
    const twap: BN = m.amm.lastFundingOracleTwap;
    const fundingPeriod: BN = m.amm.fundingPeriod;

    // Current Fundex formula: raw / 1_000
    const fundexCurrent = raw.div(new BN(1_000)).toNumber();

    // Drift SDK's own "hourly %" formula: raw × 1e3 / 1e9 = raw / 1e6
    const hourlyPct = raw.toNumber() / 1e6;

    // Drift's trigger-price derivation for reference: lastFundingRate * PRICE / twap * 24
    // (tells us raw is quote-denominated, not a rate)

    console.log(`\n=== ${name} (idx ${m.marketIndex}) ===`);
    console.log(`  raw lastFundingRate:      ${raw.toString()}`);
    console.log(`  lastFundingOracleTwap:    ${twap.toString()}`);
    console.log(`  fundingPeriod (s):        ${fundingPeriod.toString()}`);
    console.log(`  current Fundex (/1000):   ${fundexCurrent}`);
    console.log(`  Drift SDK getFundingRatePct → ${hourlyPct.toFixed(6)}% (if per-hour %)`);
    console.log(`  -> APR if %/h: ${(hourlyPct * 24 * 365).toFixed(2)}%`);

    // Alternative: raw is quote_per_base per hour; rate_pct/h = raw / twap
    if (twap.gt(new BN(0))) {
      const ratePct = (raw.mul(new BN(1e6)).div(twap).toNumber() / 1e6) * 100; // percent
      console.log(`  raw/twap rate/h:          ${ratePct.toFixed(6)}%`);
      console.log(`  -> APR:                   ${(ratePct * 24 * 365).toFixed(2)}%`);
    }
  }

  await driftClient.unsubscribe();
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
