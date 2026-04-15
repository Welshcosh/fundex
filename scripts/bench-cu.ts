/**
 * Compute-unit benchmark — reads real on-chain executions.
 *
 * Fetches the last N program transactions from devnet and extracts
 *   meta.computeUnitsConsumed
 * for each invocation of a known Fundex instruction (identified by the
 * `Program log: Instruction: <Name>` line Anchor emits).
 *
 * Only measures what has actually been executed. On a fresh deployment
 * that means settle_funding (crank runs every hour); open/close/liquidate
 * will appear after the first trading flow completes.
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

const INSTRUCTIONS = [
  "SettleFunding",
  "OpenPosition",
  "ClosePosition",
  "LiquidatePosition",
  "InitializeMarket",
  "InitializeRateOracle",
  "DepositLp",
  "WithdrawLp",
  "SyncPoolPnl",
];

const SAMPLE_LIMIT = 200;  // signatures to scan

interface Stat {
  name: string;
  samples: number[];
}

function fmtStats(samples: number[]): string {
  if (samples.length === 0) return "n=0";
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  return `n=${samples.length}  mean=${mean.toFixed(0)}  median=${median}  min=${sorted[0]}  max=${sorted[sorted.length - 1]}`;
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Fundex as anchor.Program;
  const conn = provider.connection;

  console.log("=".repeat(70));
  console.log(`Fundex compute-unit benchmark`);
  console.log(`Program: ${program.programId.toBase58()}`);
  console.log(`RPC: ${(conn as any)._rpcEndpoint}`);
  console.log(`Scanning last ${SAMPLE_LIMIT} program transactions...`);
  console.log("=".repeat(70));

  const sigs = await conn.getSignaturesForAddress(program.programId, { limit: SAMPLE_LIMIT }, "confirmed");
  console.log(`Fetched ${sigs.length} signatures. Downloading transactions...\n`);

  const stats: Record<string, Stat> = {};
  for (const name of INSTRUCTIONS) stats[name] = { name, samples: [] };

  let scanned = 0;
  for (const sig of sigs) {
    const tx = await conn.getTransaction(sig.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    if (!tx || !tx.meta) continue;
    if (tx.meta.err) continue;  // skip failed tx
    const cu = tx.meta.computeUnitsConsumed;
    if (cu === undefined || cu === null) continue;

    const logs = tx.meta.logMessages ?? [];
    // Find the top-level Anchor instruction log (first "Instruction: X" match)
    const match = logs.map((l) => l.match(/Program log: Instruction: (\w+)/)).find((m) => m);
    if (!match) continue;
    const instrName = match[1];
    if (stats[instrName]) {
      stats[instrName].samples.push(cu);
      scanned++;
    }
  }

  console.log(`Parsed ${scanned} successful instruction executions.\n`);
  console.log("Per-instruction compute units (from live on-chain transactions):");
  console.log("-".repeat(70));

  const rows: Array<{ name: string; line: string }> = [];
  for (const name of INSTRUCTIONS) {
    const s = stats[name];
    if (s.samples.length === 0) {
      rows.push({ name, line: `  ${name.padEnd(22)} —  (not yet executed on this deployment)` });
    } else {
      rows.push({ name, line: `  ${name.padEnd(22)} ${fmtStats(s.samples)}` });
    }
  }
  for (const r of rows) console.log(r.line);

  // ── Markdown table output ──────────────────────────────────────────────────
  console.log();
  console.log("-".repeat(70));
  console.log("Markdown table (paste into docs/benchmarks/cu-table.md):");
  console.log("-".repeat(70));
  console.log();
  console.log("| Instruction | Samples | Mean CU | Median | Min | Max |");
  console.log("|---|---:|---:|---:|---:|---:|");
  for (const name of INSTRUCTIONS) {
    const s = stats[name];
    if (s.samples.length === 0) {
      console.log(`| ${name} | 0 | — | — | — | — |`);
      continue;
    }
    const sorted = [...s.samples].sort((a, b) => a - b);
    const mean = Math.round(s.samples.reduce((a, b) => a + b, 0) / s.samples.length);
    const median = sorted[Math.floor(sorted.length / 2)];
    console.log(
      `| ${name} | ${s.samples.length} | ${mean.toLocaleString()} | ${median.toLocaleString()} | ${sorted[0].toLocaleString()} | ${sorted[sorted.length - 1].toLocaleString()} |`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
