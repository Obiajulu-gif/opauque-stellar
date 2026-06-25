import { describe, expect, it } from "vitest";
import {
  ATTESTATION_ENGINE_V2_CONTRACT_ID,
  SCHEMA_REGISTRY_CONTRACT_ID,
  buildDeprecateSchemaInstruction,
  buildRevokeInstruction,
  mapAttestationRevocationError,
  mapSchemaManagementError,
} from "./programs";

const AUTHORITY = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const BYTES_32 = new Uint8Array(32).fill(7);

describe("Soroban management instruction builders", () => {
  it("builds schema deprecation calls for the schema registry contract", () => {
    const instruction = buildDeprecateSchemaInstruction({
      authority: AUTHORITY,
      schemaId: BYTES_32,
    });

    expect(instruction.contractId).toBe(SCHEMA_REGISTRY_CONTRACT_ID);
    expect(instruction.method).toBe("deprecate_schema");
    expect(instruction.args).toHaveLength(2);
  });

  it("builds attestation revoke calls for the attestation engine contract", () => {
    const instruction = buildRevokeInstruction({
      revoker: AUTHORITY,
      uid: BYTES_32,
    });

    expect(instruction.contractId).toBe(ATTESTATION_ENGINE_V2_CONTRACT_ID);
    expect(instruction.method).toBe("revoke_attestation");
    expect(instruction.args).toHaveLength(3);
  });

  it("rejects malformed schema and attestation ids before wallet signing", () => {
    expect(() =>
      buildDeprecateSchemaInstruction({ authority: AUTHORITY, schemaId: new Uint8Array(31) }),
    ).toThrow(/schemaId must be exactly 32 bytes/);

    expect(() =>
      buildRevokeInstruction({ revoker: AUTHORITY, uid: new Uint8Array(33) }),
    ).toThrow(/uid must be exactly 32 bytes/);
  });

  it("maps double-revoke and already-deprecated errors to user-readable messages", () => {
    expect(mapAttestationRevocationError(new Error("Error(Contract, #5)"))).toBe(
      "This attestation has already been revoked.",
    );

    expect(mapSchemaManagementError(new Error("already deprecated"))).toBe(
      "This schema has already been deprecated.",
    );
  });
});
