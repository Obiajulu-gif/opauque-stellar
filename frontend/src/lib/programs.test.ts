import { describe, expect, it } from "vitest";
import {
  ATTESTATION_ENGINE_V2_CONTRACT_ID,
  SCHEMA_REGISTRY_CONTRACT_ID,
  buildDeprecateSchemaInstruction,
  buildRevokeInstruction,
  mapAttestationRevocationError,
  mapSchemaManagementError,
} from "./programs";

const WALLET = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const BYTES_32 = new Uint8Array(32).fill(7);

describe("program invocation builders", () => {
  it("builds schema deprecation contract invocation metadata", () => {
    const instruction = buildDeprecateSchemaInstruction({
      authority: WALLET,
      schemaId: BYTES_32,
    });

    expect(instruction.contractId).toBe(SCHEMA_REGISTRY_CONTRACT_ID);
    expect(instruction.method).toBe("deprecate_schema");
    expect(instruction.args).toHaveLength(2);
  });

  it("builds attestation revocation contract invocation metadata", () => {
    const instruction = buildRevokeInstruction({
      revoker: WALLET,
      uid: BYTES_32,
    });

    expect(instruction.contractId).toBe(ATTESTATION_ENGINE_V2_CONTRACT_ID);
    expect(instruction.method).toBe("revoke_attestation");
    expect(instruction.args).toHaveLength(3);
  });

  it("rejects malformed byte identifiers before Freighter signing", () => {
    expect(() =>
      buildRevokeInstruction({
        revoker: WALLET,
        uid: new Uint8Array(31),
      }),
    ).toThrow(/uid must be exactly 32 bytes/);

    expect(() =>
      buildDeprecateSchemaInstruction({
        authority: WALLET,
        schemaId: new Uint8Array(33),
      }),
    ).toThrow(/schemaId must be exactly 32 bytes/);
  });

  it("maps contract errors to user readable management messages", () => {
    expect(mapAttestationRevocationError(new Error("Error(Contract, #5)"))).toContain("already been revoked");
    expect(mapAttestationRevocationError(new Error("Error(Contract, #7)"))).toContain("Only the issuer");
    expect(mapSchemaManagementError(new Error("Error(Contract, #4)"))).toContain("Only the schema authority");
    expect(mapSchemaManagementError(new Error("already deprecated"))).toContain("already been deprecated");
  });
});
