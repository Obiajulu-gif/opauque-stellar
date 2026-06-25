#!/usr/bin/env node
/**
 * Restore a known-good deployment manifest and optionally redeploy WASM hashes.
 *
 * Default mode is dry-run. Use --execute to write the active manifest and run
 * generated Stellar CLI commands.
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DEPLOYMENTS = join(ROOT, "deployments", "v1");
const CONTRACT_KEYS = [
  "stealthRegistry",
  "stealthAnnouncer",
  "groth16Verifier",
  "reputationVerifier",
  "schemaRegistry",
  "attestationEngineV2",
];

function parseArgs(argv) {
  const opts = {
    network: "testnet",
    previous: null,
    manifest: null,
    dryRun: true,
    execute: false,
    runSmoke: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--network" && argv[i + 1]) opts.network = argv[++i];
    else if (arg === "--previous" && argv[i + 1]) opts.previous = resolve(argv[++i]);
    else if (arg === "--manifest" && argv[i + 1]) opts.manifest = resolve(argv[++i]);
    else if (arg === "--execute") {
      opts.execute = true;
      opts.dryRun = false;
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
      opts.execute = false;
    } else if (arg === "--smoke") {
      opts.runSmoke = true;
    }
  }

  opts.manifest ??= join(DEPLOYMENTS, `${opts.network}.json`);
  opts.previous ??= join(DEPLOYMENTS, `${opts.network}.previous.json`);
  return opts;
}

function loadJson(path) {
  if (!existsSync(path)) throw new Error(`Missing file: ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function buildRedeployCommands(manifest, network) {
  const commands = [];
  for (const key of CONTRACT_KEYS) {
    const record = manifest.contracts?.[key];
    if (!record?.wasmHash) continue;
    commands.push({
      contract: key,
      command: [
        "stellar",
        "contract",
        "deploy",
        "--wasm-hash",
        record.wasmHash,
        "--network",
        network,
      ],
    });
  }
  return commands;
}

function run(command) {
  const [bin, ...args] = command;
  const result = spawnSync(bin, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`${command.join(" ")} failed with status ${result.status}`);
  }
}

function main() {
  const opts = parseArgs(process.argv);
  const previous = loadJson(opts.previous);
  const activeExists = existsSync(opts.manifest);
  const active = activeExists ? loadJson(opts.manifest) : null;
  const commands = buildRedeployCommands(previous, opts.network);

  const summary = {
    msg: "deployment.rollback.plan",
    network: opts.network,
    dryRun: opts.dryRun,
    activeManifest: opts.manifest,
    previousManifest: opts.previous,
    activeDeploymentLedger: active?.deploymentLedger ?? null,
    rollbackDeploymentLedger: previous.deploymentLedger ?? null,
    contractsWithKnownGoodWasm: commands.map((entry) => entry.contract),
  };
  console.log(JSON.stringify(summary, null, 2));

  if (commands.length === 0) {
    console.warn("No wasmHash values found in previous manifest; manifest restore can still proceed.");
  }

  for (const { contract, command } of commands) {
    console.log(JSON.stringify({ msg: "deployment.rollback.command", contract, command: command.join(" ") }));
  }

  if (opts.dryRun) {
    console.log("Dry run only. Re-run with --execute to restore the manifest and run deploy commands.");
    console.log(`Suggested smoke tests: node scripts/verify-deployment-manifest.mjs --network ${opts.network} --strict && node scripts/probe-horizon-rpc.mjs --network ${opts.network}`);
    return;
  }

  copyFileSync(opts.manifest, `${opts.manifest}.rollback-backup-${Date.now()}`);
  writeFileSync(opts.manifest, JSON.stringify(previous, null, 2) + "\n");
  console.log(`Restored ${opts.manifest} from ${opts.previous}`);

  for (const { command } of commands) {
    run(command);
  }

  if (opts.runSmoke) {
    run(["node", "scripts/verify-deployment-manifest.mjs", "--network", opts.network, "--strict"]);
    run(["node", "scripts/probe-horizon-rpc.mjs", "--network", opts.network]);
  } else {
    console.log(`Run smoke tests: node scripts/verify-deployment-manifest.mjs --network ${opts.network} --strict && node scripts/probe-horizon-rpc.mjs --network ${opts.network}`);
  }
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ msg: "deployment.rollback.failed", error: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
}
