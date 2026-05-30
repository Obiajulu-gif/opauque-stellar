// @ts-nocheck
/**
 * Validates deployment manifests and optionally checks env / WASM hashes.
 *
 * Usage:
 *   node scripts/verify-deployment-manifest.mjs
 *   node scripts/verify-deployment-manifest.mjs --network testnet --strict
 *   node scripts/verify-deployment-manifest.mjs --network mainnet --check-wasm
 */

import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const ENV_SUFFIX = {
  stealthRegistry: "STEALTH_REGISTRY_CONTRACT",
  stealthAnnouncer: "STEALTH_ANNOUNCER_CONTRACT",
  groth16Verifier: "GROTH16_VERIFIER_CONTRACT",
  reputationVerifier: "REPUTATION_VERIFIER_CONTRACT",
  schemaRegistry: "SCHEMA_REGISTRY_CONTRACT",
  attestationEngineV2: "ATTESTATION_ENGINE_CONTRACT",
};

const PASSPHRASES = {
  testnet: "Test SDF Network ; September 2015",
  mainnet: "Public Global Stellar Network ; September 2015",
};

const STELLAR_CONTRACT_ID = /^C[A-Z2-7]{55}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const SOLANA_LIKE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const WASM_PATHS = {
  "stealth-registry": "target/wasm32v1-none/release/stealth_registry.wasm",
  "stealth-announcer": "target/wasm32v1-none/release/stealth_announcer.wasm",
  "groth16-verifier": "target/wasm32v1-none/release/groth16_verifier.wasm",
  "reputation-verifier": "target/wasm32v1-none/release/reputation_verifier.wasm",
  "schema-registry": "target/wasm32v1-none/release/schema_registry.wasm",
  "attestation-engine-v2": "target/wasm32v1-none/release/attestation_engine_v2.wasm",
};

function parseArgs(argv) {
  const opts = {
    network: null,
    strict: false,
    checkWasm: false,
    checkEnv: true,
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--network" && argv[i + 1]) {
      opts.network = argv[++i];
    } else if (argv[i] === "--strict") {
      opts.strict = true;
    } else if (argv[i] === "--check-wasm") {
      opts.checkWasm = true;
    } else if (argv[i] === "--no-env") {
      opts.checkEnv = false;
    }
  }
  return opts;
}

function loadManifest(network) {
  const path = join(DEPLOYMENTS, `${network}.json`);
  if (!existsSync(path)) {
    throw new Error(`Missing manifest: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256File(path) {
  const data = readFileSync(path);
  return createHash("sha256").update(data).digest("hex");
}

function validateManifest(manifest, { strict, checkWasm }) {
  const errors = [];
  const network = manifest.network;

  if (manifest.schemaVersion !== "1.0.0") {
    errors.push(`schemaVersion must be 1.0.0 (got ${manifest.schemaVersion})`);
  }
  if (!manifest.release?.startsWith("v")) {
    errors.push("release must be a version tag like v1");
  }
  if (manifest.networkPassphrase !== PASSPHRASES[network]) {
    errors.push(
      `networkPassphrase mismatch for ${network} (expected Stellar canonical passphrase)`,
    );
  }
  if (manifest.network !== network) {
    errors.push("network field must match filename");
  }

  for (const key of CONTRACT_KEYS) {
    const record = manifest.contracts?.[key];
    if (!record) {
      errors.push(`missing contracts.${key}`);
      continue;
    }
    const { id, wasmHash } = record;
    if (id && !STELLAR_CONTRACT_ID.test(id)) {
      if (SOLANA_LIKE.test(id) && !id.startsWith("C")) {
        errors.push(`contracts.${key}.id looks like a Solana address: ${id}`);
      } else {
        errors.push(`contracts.${key}.id is not a valid Stellar contract ID: ${id}`);
      }
    }
    if (wasmHash && !SHA256_HEX.test(wasmHash)) {
      errors.push(`contracts.${key}.wasmHash must be 64-char lowercase hex`);
    }
    if (strict && manifest.deploymentStatus === "deployed") {
      if (!id) errors.push(`contracts.${key}.id required when deploymentStatus=deployed`);
      if (!wasmHash) errors.push(`contracts.${key}.wasmHash required when deploymentStatus=deployed`);
    }
  }

  if (strict && manifest.deploymentStatus === "deployed") {
    if (manifest.deploymentLedger == null) {
      errors.push("deploymentLedger required when deploymentStatus=deployed");
    }
    if (!manifest.deployedAt) {
      errors.push("deployedAt required when deploymentStatus=deployed");
    }
  }

  if (checkWasm) {
    for (const key of CONTRACT_KEYS) {
      const pkg = manifest.contracts[key].package;
      const wasmRel = WASM_PATHS[pkg];
      if (!wasmRel) continue;
      const wasmPath = join(ROOT, wasmRel);
      if (!existsSync(wasmPath)) {
        if (strict) {
          errors.push(`WASM not found for ${key}: ${wasmRel} (run stellar contract build)`);
        }
        continue;
      }
      const actual = sha256File(wasmPath);
      const expected = manifest.contracts[key].wasmHash;
      if (expected && expected !== actual) {
        errors.push(
          `contracts.${key}.wasmHash mismatch: manifest=${expected} built=${actual}`,
        );
      }
    }
  }

  return errors;
}

function checkLegacyAddresses() {
  const errors = [];
  const legacy = [
    join(ROOT, "frontend", "src", "contracts", "deployed-addresses.json"),
    join(ROOT, "frontend", "src", "contracts", "reputation-addresses.json"),
  ];
  for (const path of legacy) {
    if (existsSync(path)) {
      errors.push(`Legacy address file must be removed: ${path}`);
    }
  }

  const contractsDir = join(ROOT, "frontend", "src", "contracts");
  if (existsSync(contractsDir)) {
    for (const file of readdirSync(contractsDir)) {
      if (!file.endsWith(".json")) continue;
      const content = readFileSync(join(contractsDir, file), "utf8");
      if (/\"devnet\"|\"cluster\"\s*:\s*\"devnet\"/i.test(content)) {
        errors.push(`${file} still references devnet`);
      }
      if (/E9LBRG5eP2kvuNfveouqQ9tA5P6nrpyLyWFjH9MFYVno/.test(content)) {
        errors.push(`${file} still contains legacy Solana-style addresses`);
      }
    }
  }

  return errors;
}

function checkEnvMatchesManifest(manifest) {
  const errors = [];
  const network = manifest.network.toUpperCase();

  for (const key of CONTRACT_KEYS) {
    const envKey = `VITE_${network}_${ENV_SUFFIX[key]}`;
    const envVal = process.env[envKey]?.trim();
    const manifestId = manifest.contracts[key].id?.trim() ?? "";
    if (!envVal) continue;
    if (manifestId && envVal !== manifestId) {
      errors.push(
        `${envKey}=${envVal} does not match manifest contracts.${key}.id=${manifestId}`,
      );
    }
    if (envVal && !STELLAR_CONTRACT_ID.test(envVal)) {
      errors.push(`${envKey} is not a valid Stellar contract ID`);
    }
  }

  const passphraseEnv = process.env.VITE_STELLAR_NETWORK_PASSPHRASE?.trim();
  if (passphraseEnv && passphraseEnv !== manifest.networkPassphrase) {
    errors.push("VITE_STELLAR_NETWORK_PASSPHRASE does not match manifest.networkPassphrase");
  }

  return errors;
}

function main() {
  const opts = parseArgs(process.argv);
  const networks = opts.network ? [opts.network] : ["testnet", "mainnet"];
  const allErrors = [];

  allErrors.push(...checkLegacyAddresses());

  for (const network of networks) {
    if (network !== "testnet" && network !== "mainnet") {
      allErrors.push(`Unknown network: ${network}`);
      continue;
    }
    const manifest = loadManifest(network);
    allErrors.push(...validateManifest(manifest, opts));
    if (opts.checkEnv) {
      allErrors.push(...checkEnvMatchesManifest(manifest));
    }
  }

  if (allErrors.length > 0) {
    console.error("Deployment manifest verification failed:\n");
    for (const err of allErrors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  console.log(
    `OK: verified ${networks.join(", ")} manifest(s)${opts.strict ? " (strict)" : ""}`,
  );
}

main();
