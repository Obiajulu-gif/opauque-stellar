/**
 * Soroban contract invocation helpers for Schema Registry, Attestation Engine, Groth16.
 */

import { nativeToScVal } from "@stellar/stellar-sdk";
import { deployedAddresses } from "../contracts/deployedAddresses";
import { bytesToScVal, invokeContractMethod } from "./stellar";
import type { SignTxFn } from "./stellar";

export const SCHEMA_REGISTRY_CONTRACT_ID = deployedAddresses.schemaRegistry;
export const ATTESTATION_ENGINE_V2_CONTRACT_ID = deployedAddresses.attestationEngineV2;
export const GROTH16_VERIFIER_CONTRACT_ID = deployedAddresses.groth16Verifier;

export function bytesToHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeBytes32(value: Uint8Array, label: string): Uint8Array {
  if (value.length !== 32) {
    throw new Error(`${label} must be exactly 32 bytes; received ${value.length}.`);
  }
  return value;
}

export function mapSchemaManagementError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/Unauthorized|Error\(Contract, #4\)|#4\b/i.test(message)) {
    return "Only the schema authority can deprecate this schema.";
  }
  if (/not.?found|missing|schema/i.test(message)) {
    return "Schema was not found on-chain. Refresh and try again.";
  }
  return message || "Schema management transaction failed.";
}

export function mapAttestationRevocationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/AlreadyRevoked|already revoked|Error\(Contract, #5\)|#5\b/i.test(message)) {
    return "This attestation has already been revoked.";
  }
  if (/AttestationNotFound|not.?found|Error\(Contract, #4\)|#4\b/i.test(message)) {
    return "Attestation was not found on-chain. Refresh and try again.";
  }
  if (/NotRevocable|not revocable|Error\(Contract, #6\)|#6\b/i.test(message)) {
    return "This schema does not allow attestation revocation.";
  }
  if (/Unauthorized|Error\(Contract, #7\)|#7\b/i.test(message)) {
    return "Only the issuer, schema authority, or authorized delegate can revoke this attestation.";
  }
  return message || "Attestation revocation transaction failed.";
}

export async function invokeRegisterSchema(opts: {
  authority: string;
  schemaId: Uint8Array;
  name: string;
  fieldDefinitions: string;
  revocable: boolean;
  resolver: string | null;
  schemaExpiryLedger: number;
  signTransaction: SignTxFn;
}): Promise<string> {
  const args = [
    nativeToScVal(opts.authority, { type: "address" }),
    nativeToScVal(Buffer.from(opts.schemaId), { type: "bytes" }),
    nativeToScVal(opts.name, { type: "string" }),
    nativeToScVal(opts.fieldDefinitions, { type: "string" }),
    nativeToScVal(opts.revocable, { type: "bool" }),
    opts.resolver
      ? nativeToScVal(opts.resolver, { type: "address" })
      : nativeToScVal(null, { type: "address" }),
    nativeToScVal(opts.schemaExpiryLedger, { type: "u32" }),
  ];
  return invokeContractMethod({
    sourcePublicKey: opts.authority,
    contractId: SCHEMA_REGISTRY_CONTRACT_ID,
    method: "register_schema",
    args,
    signTransaction: opts.signTransaction,
  });
}

export async function invokeDeprecateSchema(opts: {
  authority: string;
  schemaId: Uint8Array;
  signTransaction: SignTxFn;
}): Promise<string> {
  try {
    return await invokeContractMethod({
      sourcePublicKey: opts.authority,
      contractId: SCHEMA_REGISTRY_CONTRACT_ID,
      method: "deprecate_schema",
      args: [
        nativeToScVal(opts.authority, { type: "address" }),
        nativeToScVal(Buffer.from(normalizeBytes32(opts.schemaId, "schemaId")), { type: "bytes" }),
      ],
      signTransaction: opts.signTransaction,
    });
  } catch (error) {
    throw new Error(mapSchemaManagementError(error));
  }
}

export async function invokeAttest(opts: {
  issuer: string;
  schemaId: Uint8Array;
  stealthAddressHash: Uint8Array;
  data: Uint8Array;
  expirationLedger: number;
  refUid: Uint8Array;
  signTransaction: SignTxFn;
}): Promise<string> {
  return invokeContractMethod({
    sourcePublicKey: opts.issuer,
    contractId: ATTESTATION_ENGINE_V2_CONTRACT_ID,
    method: "attest",
    args: [
      nativeToScVal(opts.issuer, { type: "address" }),
      nativeToScVal(Buffer.from(opts.schemaId), { type: "bytes" }),
      nativeToScVal(SCHEMA_REGISTRY_CONTRACT_ID, { type: "address" }),
      nativeToScVal(Buffer.from(opts.stealthAddressHash), { type: "bytes" }),
      bytesToScVal(opts.data),
      nativeToScVal(opts.expirationLedger, { type: "u32" }),
      nativeToScVal(Buffer.from(opts.refUid), { type: "bytes" }),
    ],
    signTransaction: opts.signTransaction,
  });
}

export async function invokeRevokeAttestation(opts: {
  revoker: string;
  uid: Uint8Array;
  signTransaction: SignTxFn;
}): Promise<string> {
  try {
    return await invokeContractMethod({
      sourcePublicKey: opts.revoker,
      contractId: ATTESTATION_ENGINE_V2_CONTRACT_ID,
      method: "revoke_attestation",
      args: [
        nativeToScVal(opts.revoker, { type: "address" }),
        nativeToScVal(Buffer.from(normalizeBytes32(opts.uid, "uid")), { type: "bytes" }),
        nativeToScVal(SCHEMA_REGISTRY_CONTRACT_ID, { type: "address" }),
      ],
      signTransaction: opts.signTransaction,
    });
  } catch (error) {
    throw new Error(mapAttestationRevocationError(error));
  }
}

export async function invokeVerifyProofV2(opts: {
  caller: string;
  proofA: Uint8Array;
  proofB: Uint8Array;
  proofC: Uint8Array;
  merkleRoot: Uint8Array;
  attestationId: Uint8Array;
  externalNullifier: Uint8Array;
  nullifierHash: Uint8Array;
  signTransaction: SignTxFn;
}): Promise<string> {
  return invokeContractMethod({
    sourcePublicKey: opts.caller,
    contractId: GROTH16_VERIFIER_CONTRACT_ID,
    method: "verify_proof_v2",
    args: [
      nativeToScVal(Buffer.from(opts.proofA), { type: "bytes" }),
      nativeToScVal(Buffer.from(opts.proofB), { type: "bytes" }),
      nativeToScVal(Buffer.from(opts.proofC), { type: "bytes" }),
      nativeToScVal(
        {
          merkle_root: Buffer.from(opts.merkleRoot),
          attestation_id: Buffer.from(opts.attestationId),
          external_nullifier: Buffer.from(opts.externalNullifier),
          nullifier_hash: Buffer.from(opts.nullifierHash),
        },
        { type: "map" },
      ),
    ],
    signTransaction: opts.signTransaction,
  });
}

/** @deprecated */
export function buildRegisterSchemaInstruction(): never {
  throw new Error("Use invokeRegisterSchema() on Stellar");
}

/** @deprecated */
export function buildAttestInstruction(): never {
  throw new Error("Use invokeAttest() on Stellar");
}

/** @deprecated */
export function buildVerifyProofV2Instruction(): never {
  throw new Error("Use invokeVerifyProofV2() on Stellar");
}

/** @deprecated use announceStealthTransfer from contracts */
export { buildAnnounceInstruction } from "./contracts";

/** @deprecated */
export function buildDeprecateSchemaInstruction(): never {
  throw new Error("Use invokeDeprecateSchema() on Stellar");
}

/** @deprecated */
export function buildAddDelegateInstruction(): never {
  throw new Error("Delegate management on Stellar is not yet implemented in the UI");
}

/** @deprecated */
export function buildRemoveDelegateInstruction(): never {
  throw new Error("Delegate management on Stellar is not yet implemented in the UI");
}

/** @deprecated */
export function buildRevokeInstruction(): never {
  throw new Error("Use invokeRevokeAttestation() on Stellar");
}

export { hexToBytes } from "./stealth";

export const SCHEMA_REGISTRY_PROGRAM_ID = SCHEMA_REGISTRY_CONTRACT_ID;
export const ATTESTATION_ENGINE_V2_PROGRAM_ID = ATTESTATION_ENGINE_V2_CONTRACT_ID;

export function hexPubkeyToBase58(hexOrAddr: string): string {
  return hexOrAddr.startsWith("G") ? hexOrAddr : hexOrAddr;
}

export async function fetchAllSchemas(): Promise<ParsedSchemaPDA[]> {
  return [];
}

export async function fetchAllAttestations(): Promise<unknown[]> {
  return [];
}

export async function fetchAttestationPDA(): Promise<string> {
  return "";
}

export interface ParsedSchemaPDA {
  schemaId: Uint8Array;
  authority: string;
  revocable: boolean;
  name: string;
  fieldDefinitions: string;
  deprecated: boolean;
}
