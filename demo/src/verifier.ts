/**
 * Client-side Groth16 proof verifier.
 *
 * Verification steps:
 *   1. Parse and validate the proof JSON structure.
 *   2. Confirm public signals match what this dApp expects:
 *        publicSignals[2] === EXTERNAL_NULLIFIER  (bound to this dApp)
 *        publicSignals[1] === REQUIRED_SCHEMA_ID  (if configured)
 *   3. Run snarkjs.groth16.verify with the bundled verification key.
 *   4. On success, atomically consume the nullifier through shared storage.
 */

// @ts-expect-error — snarkjs has no bundled types
import * as snarkjs from "snarkjs";
import { DEMO_CONFIG } from "./config";
import { consumeNullifier } from "./nullifierStore";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Proof format produced by ProofGeneratorModal in the Opaque frontend. */
export interface OpaqueProof {
  proof: {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
  };
  publicSignals: string[];
  nullifierHash: string;
  schemaId: string;
}

export type VerifyResult =
  | { ok: true; nullifierHash: string; schemaId: string; merkleRoot: string }
  | { ok: false; reason: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Reconstruct the full snarkjs proof object.
 * ProofGeneratorModal stores pi_a/pi_c with 2 elements and pi_b with 2 pairs.
 * snarkjs.groth16.verify expects the affine "1" / ["1","0"] suffix elements.
 */
function toSnarkjsProof(proof: OpaqueProof["proof"]) {
  return {
    pi_a: [...proof.pi_a, "1"],
    pi_b: [...proof.pi_b, ["1", "0"]],
    pi_c: [...proof.pi_c, "1"],
    protocol: "groth16",
    curve: "bn128",
  };
}

let cachedVKey: unknown = null;
async function loadVKey(): Promise<unknown> {
  if (cachedVKey) return cachedVKey;
  const res = await fetch("/circuits/v2/verification_key.json");
  if (!res.ok) {
    throw new Error(
      `Failed to load verification key (${res.status}). ` +
        "Copy circuits/v2/build/verification_key_v2.json → demo/public/circuits/v2/verification_key.json"
    );
  }
  cachedVKey = await res.json();
  return cachedVKey;
}

// ── Main verifier ─────────────────────────────────────────────────────────────

export async function verifyProof(raw: string): Promise<VerifyResult> {
  // ── 1. Parse JSON ──────────────────────────────────────────────────────────
  let parsed: OpaqueProof;
  try {
    parsed = JSON.parse(raw) as OpaqueProof;
  } catch {
    return { ok: false, reason: "Invalid JSON — paste the full proof object." };
  }

  // ── 2. Validate structure ──────────────────────────────────────────────────
  if (
    !parsed.proof?.pi_a ||
    !parsed.proof?.pi_b ||
    !parsed.proof?.pi_c ||
    !Array.isArray(parsed.publicSignals) ||
    parsed.publicSignals.length < 4
  ) {
    return {
      ok: false,
      reason:
        'Malformed proof. Expected { proof: { pi_a, pi_b, pi_c }, publicSignals: [root, id, nullifier, hash], … }.',
    };
  }

  // publicSignals layout:
  //   [0] merkle_root
  //   [1] attestation_id  (= schema_id field element)
  //   [2] external_nullifier
  //   [3] nullifier_hash
  const [merkleRoot, attestationId, externalNullifier, nullifierHash] =
    parsed.publicSignals;

  // ── 3. Check external nullifier binds proof to THIS app ───────────────────
  if (externalNullifier !== DEMO_CONFIG.EXTERNAL_NULLIFIER) {
    return {
      ok: false,
      reason:
        `Wrong external nullifier. This app requires "${DEMO_CONFIG.EXTERNAL_NULLIFIER}" ` +
        `but the proof was generated with "${externalNullifier}". ` +
        `Regenerate your proof using external nullifier ${DEMO_CONFIG.EXTERNAL_NULLIFIER}.`,
    };
  }

  // ── 4. Optional schema check ───────────────────────────────────────────────
  if (DEMO_CONFIG.REQUIRED_SCHEMA_ID !== null) {
    const normalise = (s: string) =>
      s.startsWith("0x") ? s.toLowerCase() : "0x" + BigInt(s).toString(16);

    if (normalise(attestationId) !== normalise(DEMO_CONFIG.REQUIRED_SCHEMA_ID)) {
      return {
        ok: false,
        reason:
          `Wrong schema. This app only accepts attestations under schema ${DEMO_CONFIG.REQUIRED_SCHEMA_ID}.`,
      };
    }
  }

  // ── 5. Cryptographic verification ─────────────────────────────────────────
  let vKey: unknown;
  try {
    vKey = await loadVKey();
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Could not load verification key.",
    };
  }

  let valid: boolean;
  try {
    valid = await snarkjs.groth16.verify(
      vKey,
      parsed.publicSignals,
      toSnarkjsProof(parsed.proof)
    ) as boolean;
  } catch (e) {
    return {
      ok: false,
      reason:
        "Proof verification threw an error: " +
        (e instanceof Error ? e.message : String(e)),
    };
  }

  if (!valid) {
    return {
      ok: false,
      reason: "Proof is cryptographically invalid. It may have been tampered with.",
    };
  }

  // ── 6. Shared nullifier consumption ───────────────────────────────────────
  const consumeResult = await consumeNullifier(nullifierHash);
  if (!consumeResult.consumed) {
    return {
      ok: false,
      reason:
        consumeResult.reason ??
        "This proof has already been used. Each proof can only grant access once — generate a new proof.",
    };
  }

  return {
    ok: true,
    nullifierHash,
    schemaId: parsed.schemaId ?? attestationId,
    merkleRoot,
  };
}
