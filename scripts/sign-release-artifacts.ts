#!/usr/bin/env tsx
/**
 * Sign release artifacts with the release signing key.
 *
 * Usage:
 *   npx tsx scripts/sign-release-artifacts.ts                    # sign all release artifacts
 *   npx tsx scripts/sign-release-artifacts.ts --artifact <path>  # sign a single file
 *
 * The signing key must be set in the SIGNING_KEY environment variable
 * or provided via --key-file <path>.
 *
 * Generated signatures are written to <artifact>.sig (hex-encoded SHA256-with-RSA).
 */

import { createSign, readFileSync, writeFileSync } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SIGNATURE_SUFFIX = ".sig";

const RELEASE_ARTIFACTS = [
  "frontend/public/pkg/cryptography_bg.wasm",
  "frontend/public/pkg/cryptography.js",
  "frontend/public/circuits/stealth_attestation_js/stealth_attestation.wasm",
  "frontend/public/circuits/sa_final.zkey",
  "frontend/public/circuits/v2/stealth_reputation.wasm",
  "frontend/public/circuits/v2/stealth_reputation_final.zkey",
];

function loadPrivateKey(keyPath?: string): string {
  if (keyPath) {
    return readFileSync(resolve(keyPath), "utf8");
  }
  if (process.env.SIGNING_KEY) {
    return process.env.SIGNING_KEY;
  }
  throw new Error(
    "No signing key found. Set SIGNING_KEY env var or pass --key-file <path>",
  );
}

function signArtifact(artifactPath: string, privateKey: string): void {
  if (!existsSync(artifactPath)) {
    console.warn(`  SKIP: ${artifactPath} not found`);
    return;
  }

  const data = readFileSync(artifactPath);
  const signer = createSign("SHA256");
  signer.update(data);
  signer.end();

  const signature = signer.sign(privateKey, "hex");
  const sigPath = artifactPath + SIGNATURE_SUFFIX;
  writeFileSync(sigPath, signature + "\n", "utf8");
  console.log(`  SIGNED: ${basename(artifactPath)} -> ${basename(sigPath)}`);
}

function main(): void {
  const args = process.argv.slice(2);
  const keyFileIndex = args.indexOf("--key-file");
  const keyPath = keyFileIndex >= 0 ? args[keyFileIndex + 1] : undefined;
  const singleArtifactIndex = args.indexOf("--artifact");
  const singleArtifact = singleArtifactIndex >= 0 ? args[singleArtifactIndex + 1] : undefined;

  let privateKey: string;
  try {
    privateKey = loadPrivateKey(keyPath);
  } catch (err: any) {
    console.error(err.message);
    process.exit(1);
  }

  const artifacts = singleArtifact
    ? [resolve(ROOT, singleArtifact)]
    : RELEASE_ARTIFACTS.map((a) => resolve(ROOT, a));

  console.log("Signing release artifacts...\n");
  for (const artifact of artifacts) {
    signArtifact(artifact, privateKey);
  }
  console.log("\nDone.");
}

main();
