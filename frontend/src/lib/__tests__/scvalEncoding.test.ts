import { describe, expect, it } from "vitest";
import {
  bytesN32ToScVal,
  bytesNToScVal,
  assertByteLength,
  encodeOpaqueBytes32Fields,
} from "../scvalEncoding";

const ZERO_32 = new Uint8Array(32).fill(0);
const ONE_32 = new Uint8Array(32).fill(1);

describe("bytesN32ToScVal — BytesN<32> encoding (#134)", () => {
  it("encodes 32-byte input without throwing", () => {
    expect(() => bytesN32ToScVal(ZERO_32)).not.toThrow();
  });

  it("rejects 31-byte input before signing", () => {
    expect(() => bytesN32ToScVal(new Uint8Array(31))).toThrow(RangeError);
  });

  it("rejects 33-byte input before signing", () => {
    expect(() => bytesN32ToScVal(new Uint8Array(33))).toThrow(RangeError);
  });

  it("rejects empty input before signing", () => {
    expect(() => bytesN32ToScVal(new Uint8Array(0))).toThrow(RangeError);
  });

  it("produces scvBytes ScVal type", () => {
    const val = bytesN32ToScVal(ONE_32);
    expect(val.switch().name).toBe("scvBytes");
  });

  it("encodes content correctly", () => {
    const input = new Uint8Array(32);
    input[0] = 0xde;
    input[31] = 0xad;
    const val = bytesN32ToScVal(input);
    const buf = val.bytes();
    expect(buf[0]).toBe(0xde);
    expect(buf[31]).toBe(0xad);
  });
});

describe("bytesNToScVal — variable-length fixed encoding", () => {
  it("encodes 64-byte proof element without throwing", () => {
    expect(() => bytesNToScVal(new Uint8Array(64), 64)).not.toThrow();
  });

  it("rejects wrong length when expectedLen provided", () => {
    expect(() => bytesNToScVal(new Uint8Array(63), 64)).toThrow(RangeError);
  });

  it("rejects empty bytes", () => {
    expect(() => bytesNToScVal(new Uint8Array(0))).toThrow(RangeError);
  });
});

describe("assertByteLength", () => {
  it("passes for correct length", () => {
    expect(() => assertByteLength(ZERO_32, 32, "schemaId")).not.toThrow();
  });

  it("throws with fieldName in message for wrong length", () => {
    expect(() => assertByteLength(new Uint8Array(31), 32, "merkleRoot")).toThrow(
      /merkleRoot/,
    );
  });
});

describe("encodeOpaqueBytes32Fields — batch validate + encode", () => {
  const validFields = {
    schemaId: ZERO_32,
    merkleRoot: ONE_32,
    nullifier: new Uint8Array(32).fill(2),
  };

  it("encodes all three required fields", () => {
    const result = encodeOpaqueBytes32Fields(validFields);
    expect(result.schemaIdScVal.switch().name).toBe("scvBytes");
    expect(result.merkleRootScVal.switch().name).toBe("scvBytes");
    expect(result.nullifierScVal.switch().name).toBe("scvBytes");
    expect(result.uidScVal).toBeUndefined();
  });

  it("encodes optional uid when provided", () => {
    const result = encodeOpaqueBytes32Fields({
      ...validFields,
      uid: new Uint8Array(32).fill(3),
    });
    expect(result.uidScVal).toBeDefined();
    expect(result.uidScVal!.switch().name).toBe("scvBytes");
  });

  it("rejects atomically when any field has wrong length", () => {
    expect(() =>
      encodeOpaqueBytes32Fields({
        ...validFields,
        nullifier: new Uint8Array(31),
      }),
    ).toThrow(/nullifier/);
  });

  it("rejects wrong-length uid before signing", () => {
    expect(() =>
      encodeOpaqueBytes32Fields({
        ...validFields,
        uid: new Uint8Array(16),
      }),
    ).toThrow(/uid/);
  });
});
