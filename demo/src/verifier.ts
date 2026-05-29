// @ts-expect-error snarkjs has no bundled types
import * as snarkjs from "snarkjs";
import { DEMO_CONFIG } from "./config";
import { isNullifierUsed, consumeNullifier } from "./nullifierStore";

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
    throw new Error(`Failed to load verification key (${res.status}).`);
  }
  cachedVKey = await res.json();
  return cachedVKey;
}

export async function verifyProof(raw: string): Promise<VerifyResult> {
  let parsed: OpaqueProof;
  try {
    parsed = JSON.parse(raw) as OpaqueProof;
  } catch {
    return { ok: false, reason: "Invalid JSON. Paste the full proof object." };
  }

  if (
    !parsed.proof?.pi_a ||
    !parsed.proof?.pi_b ||
    !parsed.proof?.pi_c ||
    !Array.isArray(parsed.publicSignals) ||
    parsed.publicSignals.length < 4
  ) {
    return { ok: false, reason: "Malformed proof object." };
  }

  const [merkleRoot, attestationId, externalNullifier, nullifierHash] = parsed.publicSignals;

  if (externalNullifier !== DEMO_CONFIG.EXTERNAL_NULLIFIER) {
    return {
      ok: false,
      reason: `Wrong external nullifier. Use ${DEMO_CONFIG.EXTERNAL_NULLIFIER}.`,
    };
  }

  if (DEMO_CONFIG.REQUIRED_SCHEMA_ID !== null) {
    const normalise = (s: string) =>
      s.startsWith("0x") ? s.toLowerCase() : "0x" + BigInt(s).toString(16);

    if (normalise(attestationId) !== normalise(DEMO_CONFIG.REQUIRED_SCHEMA_ID)) {
      return { ok: false, reason: `Wrong schema. Expected ${DEMO_CONFIG.REQUIRED_SCHEMA_ID}.` };
    }
  }

  try {
    if (await isNullifierUsed(nullifierHash)) {
      return {
        ok: false,
        reason: "This proof has already been used. Generate a new proof.",
      };
    }
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Could not check nullifier status.",
    };
  }

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
    valid = (await snarkjs.groth16.verify(
      vKey,
      parsed.publicSignals,
      toSnarkjsProof(parsed.proof)
    )) as boolean;
  } catch (e) {
    return {
      ok: false,
      reason: "Proof verification failed: " + (e instanceof Error ? e.message : String(e)),
    };
  }

  if (!valid) {
    return { ok: false, reason: "Proof is cryptographically invalid." };
  }

  const consumption = await consumeNullifier(nullifierHash);
  if (!consumption.consumed) {
    return { ok: false, reason: consumption.reason ?? "This proof has already been used." };
  }

  return {
    ok: true,
    nullifierHash,
    schemaId: parsed.schemaId ?? attestationId,
    merkleRoot,
  };
}
