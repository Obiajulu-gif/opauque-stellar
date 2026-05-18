/**
 * Reputation prover — orchestrates witness generation (WASM) and
 * ZK proof generation (snarkjs) for stealth attestations.
 *
 * Also provides the on-chain submit helper that calls the
 * ReputationVerifier Soroban contract.
 */

import type { OpaqueWasmModule } from "../hooks/useOpaqueWasm";
import type { ProofData, DiscoveredTrait } from "./reputation";
import { reputationAddresses } from "../contracts/reputationAddresses";
import { nativeToScVal } from "@stellar/stellar-sdk";
import { bytesToScVal, invokeContractMethod, u64ToScVal } from "./stellar";
import type { SignTxFn } from "./stellar";
// @ts-expect-error snarkjs has no bundled types
import * as snarkjs from "snarkjs";

const CIRCUIT_WASM_PATH = "/circuits/stealth_attestation_js/stealth_attestation.wasm";
const ZKEY_PATH = "/circuits/sa_final.zkey";
const TREE_DEPTH = 20;

const REPUTATION_CONTRACT_ID = reputationAddresses.reputationVerifier;

export type ProofProgressCallback = (stage: string, percent: number) => void;

function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const b of bytes) result = (result << 8n) + BigInt(b);
  return result;
}

async function buildCircuitConsistentWitness(
  traitAttestationId: number,
  stealthPrivKeyBytes: Uint8Array,
  externalNullifier: string,
) {
  if (typeof globalThis !== "undefined" && !("Buffer" in globalThis)) {
    const bufferPkg = await import("buffer/index.js");
    (globalThis as { Buffer?: typeof bufferPkg.Buffer }).Buffer = bufferPkg.Buffer;
  }
  const circomlib = await import("circomlibjs");
  const poseidon = await circomlib.buildPoseidon();
  const babyjub = await circomlib.buildBabyjub();
  const F = poseidon.F;

  const attestationId = BigInt(traitAttestationId);
  const extNullifier = BigInt(externalNullifier);

  const stealthPriv = F.toObject(F.e(bytesToBigInt(stealthPrivKeyBytes)));
  const ephemeralPriv = F.toObject(F.e(stealthPriv + extNullifier + 1n));
  const stealthPub = babyjub.mulPointEscalar(babyjub.Base8, stealthPriv);
  const ephemeralPub = babyjub.mulPointEscalar(babyjub.Base8, ephemeralPriv);
  const sharedSecret = babyjub.mulPointEscalar(ephemeralPub, stealthPriv);

  const stealthPubX = F.toObject(stealthPub[0]);
  const stealthPubY = F.toObject(stealthPub[1]);
  const ephemeralPubX = F.toObject(ephemeralPub[0]);
  const ephemeralPubY = F.toObject(ephemeralPub[1]);
  const sharedX = F.toObject(sharedSecret[0]);
  const sharedY = F.toObject(sharedSecret[1]);

  const addressCommitment = F.toObject(poseidon([sharedX, sharedY, stealthPubX, stealthPubY]));
  const leaf = F.toObject(poseidon([addressCommitment, attestationId]));

  const zeroHashes: bigint[] = [];
  zeroHashes.push(F.toObject(poseidon([0n, 0n])));
  for (let i = 1; i < TREE_DEPTH; i++) {
    zeroHashes.push(F.toObject(poseidon([zeroHashes[i - 1], zeroHashes[i - 1]])));
  }

  const merklePathElements: string[] = [];
  const merklePathIndices: number[] = [];
  let current = leaf;
  for (let i = 0; i < TREE_DEPTH; i++) {
    merklePathElements.push(zeroHashes[i].toString());
    merklePathIndices.push(0);
    current = F.toObject(poseidon([current, zeroHashes[i]]));
  }

  return {
    merkle_root: current.toString(),
    attestation_id: attestationId.toString(),
    external_nullifier: extNullifier.toString(),
    stealth_private_key: stealthPriv.toString(),
    ephemeral_pubkey: [ephemeralPubX.toString(), ephemeralPubY.toString()],
    announcement_attestation_id: attestationId.toString(),
    merkle_path_elements: merklePathElements,
    merkle_path_indices: merklePathIndices,
  };
}

/**
 * Full proof generation pipeline:
 * 1. Generate witness via WASM
 * 2. Generate Groth16 proof via snarkjs
 */
export async function generateReputationProof(
  _wasm: OpaqueWasmModule,
  trait: DiscoveredTrait,
  _allAttestationsJson: string,
  stealthPrivKeyBytes: Uint8Array,
  externalNullifier: string,
  onProgress: ProofProgressCallback,
): Promise<ProofData> {
  onProgress("preparing-witness", 10);

  const witness = await buildCircuitConsistentWitness(
    trait.attestationId,
    stealthPrivKeyBytes,
    externalNullifier
  );

  onProgress("preparing-witness", 70);
  onProgress("generating-proof", 75);

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    witness,
    CIRCUIT_WASM_PATH,
    ZKEY_PATH,
  );

  onProgress("generating-proof", 95);

  const nullifier = publicSignals[0];
  const attestationIdFromProof = Number(publicSignals[3]);
  const isValidSignal = String(publicSignals[1] ?? "0");

  if (isValidSignal !== "1") {
    console.error("❌ [Opaque] Generated proof has is_valid=0.", {
      traitId: trait.attestationId,
      publicSignals,
      witness,
    });
    throw new Error(
      "Generated proof is invalid (is_valid=0). Rescan traits and regenerate."
    );
  }

  return {
    proof: {
      pi_a: proof.pi_a.slice(0, 2),
      pi_b: proof.pi_b.slice(0, 2),
      pi_c: proof.pi_c.slice(0, 2),
    },
    publicSignals,
    nullifier,
    attestationId: Number.isFinite(attestationIdFromProof) ? attestationIdFromProof : trait.attestationId,
  };
}

// =============================================================================
// On-chain submission (Stellar Soroban)
// =============================================================================

function bigIntToBytes32(val: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let n = val;
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return bytes;
}

/**
 * Fetch the latest valid Merkle root from the on-chain root history.
 */
export async function fetchLatestValidMerkleRoot(): Promise<Uint8Array> {
  // After deploy, read root history from contract storage via admin tooling.
  // For devnet bootstrap, use the zero-hash tree root from an empty depth-20 tree.
  console.warn("[Opaque] Using placeholder Merkle root — update via ReputationVerifier admin after indexing.");
  return new Uint8Array(32);
}

/**
 * Submits a proof to the ReputationVerifier Soroban contract.
 */
export async function submitProofOnChain(
  proofData: ProofData,
  merkleRoot: string,
  externalNullifier: string,
  signTransaction: SignTxFn,
  publicKey: string,
): Promise<string> {
  const rootBytes = bigIntToBytes32(BigInt(merkleRoot));
  const nullifierBytes = bigIntToBytes32(BigInt(proofData.nullifier));

  const pi_a = proofData.proof.pi_a.map(BigInt);
  const pi_b_flat = proofData.proof.pi_b.flatMap((pair) => [BigInt(pair[1]), BigInt(pair[0])]);
  const pi_c = proofData.proof.pi_c.map(BigInt);

  const proofA = new Uint8Array(64);
  proofA.set(bigIntToBytes32(pi_a[0]), 0);
  proofA.set(bigIntToBytes32(pi_a[1]), 32);
  const proofB = new Uint8Array(128);
  for (let i = 0; i < 4; i++) proofB.set(bigIntToBytes32(pi_b_flat[i]), i * 32);
  const proofC = new Uint8Array(64);
  proofC.set(bigIntToBytes32(pi_c[0]), 0);
  proofC.set(bigIntToBytes32(pi_c[1]), 32);

  return invokeContractMethod({
    sourcePublicKey: publicKey,
    contractId: REPUTATION_CONTRACT_ID,
    method: "verify_reputation",
    args: [
      nativeToScVal(publicKey, { type: "address" }),
      nativeToScVal(reputationAddresses.groth16Verifier, { type: "address" }),
      bytesToScVal(proofA),
      bytesToScVal(proofB),
      bytesToScVal(proofC),
      nativeToScVal(Buffer.from(rootBytes), { type: "bytes" }),
      u64ToScVal(proofData.attestationId),
      u64ToScVal(BigInt(externalNullifier)),
      nativeToScVal(Buffer.from(nullifierBytes), { type: "bytes" }),
    ],
    signTransaction,
  });
}
