/**
 * Strongly-typed contract method signatures for all Opaque Soroban contracts.
 *
 * These types centralise argument shapes and return types so that manual
 * `nativeToScVal` maps can be caught by the TypeScript compiler when contract
 * signatures change. See issue #133.
 *
 * Workflow: when a contract ABI changes, update the types here and the
 * TypeScript build will surface every callsite that needs updating.
 */

import type { xdr } from "@stellar/stellar-sdk";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** A 32-byte fixed array used for schema IDs, roots, nullifiers, etc. */
export type Bytes32 = Uint8Array & { readonly __brand: "Bytes32" };

export function toBytes32(b: Uint8Array): Bytes32 {
  if (b.length !== 32) throw new RangeError(`Expected 32 bytes, got ${b.length}`);
  return b as Bytes32;
}

// ---------------------------------------------------------------------------
// Schema Registry contract
// ---------------------------------------------------------------------------

export interface RegisterSchemaArgs {
  authority: string;
  authorityBytes: Uint8Array;
  schemaId: Bytes32;
  name: string;
  fieldDefinitions: string;
  revocable: boolean;
  version: number;
  resolver: string | null;
  schemaExpiryLedger: number;
}

export interface AddDelegateArgs {
  authority: string;
  schemaId: Bytes32;
  delegate: string;
}

export interface RevokeDelegateArgs {
  authority: string;
  schemaId: Bytes32;
  delegate: string;
}

// ---------------------------------------------------------------------------
// Attestation Engine V2 contract
// ---------------------------------------------------------------------------

export interface AttestArgs {
  issuer: string;
  schemaId: Bytes32;
  stealthAddressHash: Bytes32;
  data: Uint8Array;
  expirationLedger: number;
  refUid: Bytes32;
  revocable: boolean;
}

export interface RevokeAttestationArgs {
  issuer: string;
  uid: Bytes32;
}

// ---------------------------------------------------------------------------
// Reputation Verifier contract
// ---------------------------------------------------------------------------

export interface VerifyReputationArgs {
  publicKey: string;
  groth16Verifier: string;
  /** Groth16 proofA — G1 point, 64 bytes. */
  proofA: Uint8Array;
  /** Groth16 proofB — G2 point, 128 bytes. */
  proofB: Uint8Array;
  /** Groth16 proofC — G1 point, 64 bytes. */
  proofC: Uint8Array;
  merkleRoot: Bytes32;
  attestationId: bigint;
  externalNullifier: bigint;
  nullifier: Bytes32;
}

// ---------------------------------------------------------------------------
// Groth16 Verifier contract
// ---------------------------------------------------------------------------

export interface Groth16VerifyArgs {
  proofA: Uint8Array;
  proofB: Uint8Array;
  proofC: Uint8Array;
  publicSignals: bigint[];
}

// ---------------------------------------------------------------------------
// Type-safe ScVal builder interface
// ---------------------------------------------------------------------------

/** A contract arg builder that maps a typed args object to an xdr.ScVal array. */
export type ScValBuilder<T> = (args: T) => xdr.ScVal[];
