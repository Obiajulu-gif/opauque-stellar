#!/usr/bin/env tsx
/**
 * Check contract WASM sizes against documented byte budgets.
 *
 * Usage:
 *   npx tsx scripts/check-wasm-sizes.ts              # check all contracts
 *   npx tsx scripts/check-wasm-sizes.ts --ci          # JSON output for CI
 *
 * Budgets are defined here (the single source of truth).
 * Increase only with justification in the PR description.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

type WasmBudget = {
  package: string;
  maxBytes: number;
  reason: string;
};

const BUDGETS: WasmBudget[] = [
  {
    package: "stealth-registry",
    maxBytes: 64_000,
    reason: "Registry stores meta-addresses; small ABI",
  },
  {
    package: "stealth-announcer",
    maxBytes: 64_000,
    reason: "Announcer emits events; minimal logic",
  },
  {
    package: "groth16-verifier",
    maxBytes: 96_000,
    reason: "Groth16 pairings on alt-bn128; largest contract",
  },
  {
    package: "reputation-verifier",
    maxBytes: 80_000,
    reason: "Reputation verification with schema lookups",
  },
  {
    package: "schema-registry",
    maxBytes: 48_000,
    reason: "Schema registry; mostly storage reads",
  },
  {
    package: "attestation-engine-v2",
    maxBytes: 80_000,
    reason: "Attestation engine with EIP-712 style payloads",
  },
];

const WASM_TARGETS: Record<string, string> = {
  "stealth-registry": "target/wasm32v1-none/release/stealth_registry.wasm",
  "stealth-announcer": "target/wasm32v1-none/release/stealth_announcer.wasm",
  "groth16-verifier": "target/wasm32v1-none/release/groth16_verifier.wasm",
  "reputation-verifier": "target/wasm32v1-none/release/reputation_verifier.wasm",
  "schema-registry": "target/wasm32v1-none/release/schema_registry.wasm",
  "attestation-engine-v2": "target/wasm32v1-none/release/attestation_engine_v2.wasm",
};

function parseArgs(argv: string[]): { ci: boolean } {
  return { ci: argv.includes("--ci") };
}

function main(): void {
  const opts = parseArgs(process.argv);
  const errors: string[] = [];
  const results: { package: string; bytes: number; budget: number; pass: boolean }[] = [];

  for (const budget of BUDGETS) {
    const wasmPath = resolve(ROOT, WASM_TARGETS[budget.package]);
    if (!existsSync(wasmPath)) {
      errors.push(`${budget.package}: WASM not found at ${wasmPath} (run stellar contract build)`);
      continue;
    }
    const bytes = readFileSync(wasmPath).length;
    const pass = bytes <= budget.maxBytes;
    results.push({ package: budget.package, bytes, budget: budget.maxBytes, pass });

    if (!pass) {
      errors.push(
        `${budget.package}: ${bytes} bytes exceeds budget of ${budget.maxBytes} bytes. ${budget.reason}`,
      );
    }
  }

  if (opts.ci) {
    console.log(JSON.stringify({ results, errors, success: errors.length === 0 }, null, 2));
  } else {
    console.log("\nWASM Size Budget Report\n");
    for (const r of results) {
      const status = r.pass ? "PASS" : "FAIL";
      const pct = ((r.bytes / r.budget) * 100).toFixed(1);
      console.log(`  ${status}: ${r.package} ${r.bytes}/${r.budget} bytes (${pct}%)`);
    }
    if (errors.length > 0) {
      console.log("\nErrors:");
      for (const e of errors) console.log(`  - ${e}`);
    }
    console.log();
  }

  if (errors.length > 0) process.exit(1);
}

main();
