/**
 * Canonical ScVal encoding helpers for Soroban contract invocations.
 *
 * Soroban contracts that declare parameters as `BytesN<32>` require a
 * fixed-length bytes ScVal, not the generic `bytes` type produced by
 * `nativeToScVal(buffer, { type: "bytes" })`. Passing the wrong type
 * succeeds at serialisation time but fails at contract invocation.
 *
 * All `bytesN32ToScVal` callers should migrate to this helper; the
 * `bytesToScVal` helper in stellar.ts remains for variable-length bytes
 * (e.g. proof arrays, attestation data).
 */

import { xdr } from "@stellar/stellar-sdk";

/** Encode a 32-byte buffer as a `BytesN<32>` ScVal. Throws if length != 32. */
export function bytesN32ToScVal(bytes: Uint8Array): xdr.ScVal {
  if (bytes.length !== 32) {
    throw new RangeError(
      `bytesN32ToScVal: expected exactly 32 bytes, got ${bytes.length}`,
    );
  }
  return xdr.ScVal.scvBytes(Buffer.from(bytes));
}

/** Encode an N-byte buffer as a `BytesN<N>` ScVal. Throws if length is 0. */
export function bytesNToScVal(bytes: Uint8Array, expectedLen?: number): xdr.ScVal {
  if (bytes.length === 0) {
    throw new RangeError("bytesNToScVal: bytes must not be empty");
  }
  if (expectedLen !== undefined && bytes.length !== expectedLen) {
    throw new RangeError(
      `bytesNToScVal: expected ${expectedLen} bytes, got ${bytes.length}`,
    );
  }
  return xdr.ScVal.scvBytes(Buffer.from(bytes));
}

/** Assert a buffer has exactly `len` bytes; throw before signing. */
export function assertByteLength(bytes: Uint8Array, len: number, fieldName: string): void {
  if (bytes.length !== len) {
    throw new RangeError(
      `${fieldName}: expected ${len} bytes, got ${bytes.length} — invalid length rejected before signing`,
    );
  }
}

/**
 * Encode all BytesN<32> contract parameters used by the Opaque protocol:
 * schema_id, merkle_root, nullifier, uid, and proof elements.
 *
 * All fields are validated before any ScVal is constructed so the entire
 * batch is rejected atomically if any field has the wrong length.
 */
export function encodeOpaqueBytes32Fields(fields: {
  schemaId: Uint8Array;
  merkleRoot: Uint8Array;
  nullifier: Uint8Array;
  uid?: Uint8Array;
}): {
  schemaIdScVal: xdr.ScVal;
  merkleRootScVal: xdr.ScVal;
  nullifierScVal: xdr.ScVal;
  uidScVal?: xdr.ScVal;
} {
  assertByteLength(fields.schemaId, 32, "schemaId");
  assertByteLength(fields.merkleRoot, 32, "merkleRoot");
  assertByteLength(fields.nullifier, 32, "nullifier");
  if (fields.uid !== undefined) {
    assertByteLength(fields.uid, 32, "uid");
  }

  return {
    schemaIdScVal: bytesN32ToScVal(fields.schemaId),
    merkleRootScVal: bytesN32ToScVal(fields.merkleRoot),
    nullifierScVal: bytesN32ToScVal(fields.nullifier),
    uidScVal: fields.uid ? bytesN32ToScVal(fields.uid) : undefined,
  };
}
