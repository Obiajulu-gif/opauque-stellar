#!/usr/bin/env tsx
/**
 * Verify cryptographic signatures on release artifacts.
 *
 * Signatures are produced with a dedicated release signing key.
 * The public verification key is checked into the repository at
 *   artifacts/public-verify-key.pem
 *
 * Usage:
 *   npx tsx scripts/verify-artifact-signatures.ts                    # verify all signed artifacts
 *   npx tsx scripts/verify-artifact-signatures.ts --artifact <path>  # verify a single artifact
 *   npx tsx scripts/verify-artifact-signatures.ts --ci               # JSON output
 */

import { createVerify, readFileSync } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PUBLIC_KEY_PATH = resolve(ROOT, "artifacts", "public-verify-key.pem");
const SIGNATURE_SUFFIX = ".sig";

function parseArgs(argv: string[]): { ci: boolean; artifact?: string } {
  const opts: { ci: boolean; artifact?: string } = { ci: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--ci") opts.ci = true;
    if (argv[i] === "--artifact" && argv[i + 1]) opts.artifact = resolve(argv[++i]);
  }
  return opts;
}

function findSignedArtifacts(): string[] {
  const entries: string[] = [];

  // Walk known artifact directories
  const dirs = [
    "artifacts",
    "frontend/public/pkg",
    "frontend/public/circuits",
    "circuits/build",
    "circuits/v2/build",
  ];
  for (const d of dirs) {
    const dirPath = resolve(ROOT, d);
    if (!existsSync(dirPath)) continue;
    const files = readdirSync(dirPath);
    const sigFiles = new Set(files.filter((f) => f.endsWith(SIGNATURE_SUFFIX)));
    for (const sigFile of sigFiles) {
      const artifactName = sigFile.slice(0, -SIGNATURE_SUFFIX.length);
      const artifactPath = resolve(dirPath, artifactName);
      if (existsSync(artifactPath)) {
        entries.push(artifactPath);
      }
    }
  }
  return entries;
}

function verifySignature(artifactPath: string, pubKey: string): { ok: boolean; error?: string } {
  const sigPath = artifactPath + SIGNATURE_SUFFIX;
  if (!existsSync(sigPath)) {
    return { ok: false, error: `Missing signature file: ${sigPath}` };
  }

  try {
    const artifactData = readFileSync(artifactPath);
    const signatureData = readFileSync(sigPath, "utf8").trim();

    const verifier = createVerify("SHA256");
    verifier.update(artifactData);
    verifier.end();

    const signature = Buffer.from(signatureData, "hex");
    const publicKey = readFileSync(pubKey, "utf8");

    const verified = verifier.verify(publicKey, signature);
    return verified
      ? { ok: true }
      : { ok: false, error: `Signature verification failed for ${basename(artifactPath)}` };
  } catch (err: any) {
    return { ok: false, error: `Verification error for ${basename(artifactPath)}: ${err.message}` };
  }
}

function main(): void {
  const opts = parseArgs(process.argv);

  if (!existsSync(PUBLIC_KEY_PATH)) {
    console.error("Public verification key not found. Expected at:", PUBLIC_KEY_PATH);
    if (!opts.ci) console.log("SKIP: no public key deployed yet");
    process.exit(opts.ci ? 1 : 0);
  }

  const pubKey = readFileSync(PUBLIC_KEY_PATH, "utf8");
  const artifacts = opts.artifact ? [opts.artifact] : findSignedArtifacts();

  if (artifacts.length === 0) {
    if (!opts.ci) console.log("No signed artifacts found to verify.");
    process.exit(0);
  }

  const results: { artifact: string; ok: boolean; error?: string }[] = [];
  for (const artifact of artifacts) {
    const result = verifySignature(artifact, PUBLIC_KEY_PATH);
    results.push({ artifact: basename(artifact), ...result });
  }

  if (opts.ci) {
    console.log(JSON.stringify({ results, success: results.every((r) => r.ok) }, null, 2));
  } else {
    console.log("\nArtifact Signature Verification\n");
    for (const r of results) {
      console.log(`  ${r.ok ? "PASS" : "FAIL"}: ${r.artifact}${r.error ? ` — ${r.error}` : ""}`);
    }
    console.log();
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) process.exit(1);
}

main();
