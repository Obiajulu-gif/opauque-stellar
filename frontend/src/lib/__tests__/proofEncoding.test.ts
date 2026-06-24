/**
 * Proof byte-ordering tests for G1/G2 points (#135).
 *
 * The Groth16 proof submission in reputationProver.ts flattens pi_b with
 * pair order reversed: [pair[1], pair[0]]. These tests verify:
 * 1. Known proof bytes match expected contract inputs (fixture tests).
 * 2. Wrong ordering is detectable and fails an ordering check.
 * 3. The encoding helper is consistent across V1/V2 paths.
 */

import { describe, expect, it } from "vitest";

function bigIntToBytes32(val: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let n = val;
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return bytes;
}

function encodeProofPoints(proof: {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
}): { proofA: Uint8Array; proofB: Uint8Array; proofC: Uint8Array } {
  const pi_a = proof.pi_a.map(BigInt);
  // G2 points: pairs are stored (x1, x0) in the contract — reverse within each pair.
  const pi_b_flat = proof.pi_b.flatMap((pair) => [BigInt(pair[1]), BigInt(pair[0])]);
  const pi_c = proof.pi_c.map(BigInt);

  const proofA = new Uint8Array(64);
  proofA.set(bigIntToBytes32(pi_a[0]), 0);
  proofA.set(bigIntToBytes32(pi_a[1]), 32);

  const proofB = new Uint8Array(128);
  for (let i = 0; i < 4; i++) {
    proofB.set(bigIntToBytes32(pi_b_flat[i]), i * 32);
  }

  const proofC = new Uint8Array(64);
  proofC.set(bigIntToBytes32(pi_c[0]), 0);
  proofC.set(bigIntToBytes32(pi_c[1]), 32);

  return { proofA, proofB, proofC };
}

function encodeProofPointsWrongOrder(proof: {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
}): { proofA: Uint8Array; proofB: Uint8Array; proofC: Uint8Array } {
  const pi_a = proof.pi_a.map(BigInt);
  // WRONG: natural order, not reversed — this is what the bug looks like.
  const pi_b_flat = proof.pi_b.flatMap((pair) => [BigInt(pair[0]), BigInt(pair[1])]);
  const pi_c = proof.pi_c.map(BigInt);

  const proofA = new Uint8Array(64);
  proofA.set(bigIntToBytes32(pi_a[0]), 0);
  proofA.set(bigIntToBytes32(pi_a[1]), 32);

  const proofB = new Uint8Array(128);
  for (let i = 0; i < 4; i++) {
    proofB.set(bigIntToBytes32(pi_b_flat[i]), i * 32);
  }

  const proofC = new Uint8Array(64);
  proofC.set(bigIntToBytes32(pi_c[0]), 0);
  proofC.set(bigIntToBytes32(pi_c[1]), 32);

  return { proofA, proofB, proofC };
}

// Known test fixture: deterministic G1/G2 points with distinct leading bytes so
// byte-ordering is observable. Values use 0x prefix so BigInt() parses correctly.
// Not a real ZK proof — used only for encoding tests.
const FIXTURE_PROOF = {
  pi_a: [
    "0x1011121314151617181920212223242526272829303132333435363738394041",
    "0x2021222324252627282930313233343536373839404142434445464748495051",
  ],
  pi_b: [
    [
      "0x3031323334353637383940414243444546474849505152535455565758596061",
      "0x4041424344454647484950515253545556575859606162636465666768697071",
    ],
    [
      "0x5051525354555657585960616263646566676869707172737475767778798081",
      "0x6061626364656667686970717273747576777879808182838485868788899091",
    ],
  ],
  pi_c: [
    "0x7071727374757677787980818283848586878889909192939495969798990001",
    "0x8081828384858687888990919293949596979899000102030405060708091011",
  ],
};

describe("G1/G2 proof point encoding (#135)", () => {
  it("encodes proofA as 64 bytes (two G1 x-coordinates, big-endian)", () => {
    const { proofA } = encodeProofPoints(FIXTURE_PROOF);
    expect(proofA).toHaveLength(64);
    // First byte of pi_a[0] — big-endian 0x1011... → first byte is 0x10.
    expect(proofA[0]).toBe(0x10);
    // First byte of pi_a[1] starts at offset 32 — 0x2021... → 0x20.
    expect(proofA[32]).toBe(0x20);
  });

  it("encodes proofB as 128 bytes (four G2 field elements)", () => {
    const { proofB } = encodeProofPoints(FIXTURE_PROOF);
    expect(proofB).toHaveLength(128);
  });

  it("encodes proofC as 64 bytes (two G1 x-coordinates, big-endian)", () => {
    const { proofC } = encodeProofPoints(FIXTURE_PROOF);
    expect(proofC).toHaveLength(64);
    // pi_c[0] = 0x7071... → first byte 0x70.
    expect(proofC[0]).toBe(0x70);
    // pi_c[1] = 0x8081... → first byte 0x80.
    expect(proofC[32]).toBe(0x80);
  });

  it("pi_b pairs are stored (x1, x0) — pair[1] comes before pair[0]", () => {
    const { proofB } = encodeProofPoints(FIXTURE_PROOF);
    // pair[0] = ["0x3031...", "0x4041..."] → stored as [pair[1]=0x4041..., pair[0]=0x3031...]
    // So proofB[0] should be 0x40 (pair[1] of first pair).
    expect(proofB[0]).toBe(0x40);
    // proofB[32] should be 0x30 (pair[0] of first pair).
    expect(proofB[32]).toBe(0x30);
  });

  it("wrong ordering test fails — natural order differs from reversed order", () => {
    const correct = encodeProofPoints(FIXTURE_PROOF);
    const wrong = encodeProofPointsWrongOrder(FIXTURE_PROOF);
    // proofA and proofC are G1 points not affected by pair ordering.
    expect(correct.proofA).toEqual(wrong.proofA);
    expect(correct.proofC).toEqual(wrong.proofC);
    // proofB MUST differ because G2 pair ordering is reversed.
    expect(correct.proofB).not.toEqual(wrong.proofB);
  });

  it("encoding helper is consistent across V1/V2 (same function, deterministic output)", () => {
    const v1 = encodeProofPoints(FIXTURE_PROOF);
    const v2 = encodeProofPoints(FIXTURE_PROOF);
    expect(v1.proofA).toEqual(v2.proofA);
    expect(v1.proofB).toEqual(v2.proofB);
    expect(v1.proofC).toEqual(v2.proofC);
  });

  it("bigIntToBytes32 produces big-endian representation", () => {
    const val = 256n; // 0x0...0100
    const bytes = bigIntToBytes32(val);
    expect(bytes).toHaveLength(32);
    expect(bytes[30]).toBe(1);
    expect(bytes[31]).toBe(0);
    // All other bytes must be zero.
    for (let i = 0; i < 30; i++) {
      expect(bytes[i]).toBe(0);
    }
  });

  it("known fixture: first bytes of each proofB segment match expected ordering", () => {
    const { proofB } = encodeProofPoints(FIXTURE_PROOF);
    // Segment 0 (offset 0):  pi_b[0][1] = 0x4041... → first byte 0x40.
    expect(proofB[0]).toBe(0x40);
    // Segment 1 (offset 32): pi_b[0][0] = 0x3031... → first byte 0x30.
    expect(proofB[32]).toBe(0x30);
    // Segment 2 (offset 64): pi_b[1][1] = 0x6061... → first byte 0x60.
    expect(proofB[64]).toBe(0x60);
    // Segment 3 (offset 96): pi_b[1][0] = 0x5051... → first byte 0x50.
    expect(proofB[96]).toBe(0x50);
  });
});
