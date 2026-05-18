/**
 * Schema Registry — V2 Stealth Reputation Protocol (Stellar Soroban).
 */

import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";
import { deployedAddresses } from "../contracts/deployedAddresses";

export const SCHEMA_REGISTRY_CONTRACT_ID = deployedAddresses.schemaRegistry;
export const ATTESTATION_ENGINE_V2_CONTRACT_ID = deployedAddresses.attestationEngineV2;
/** @deprecated Old-era name; use SCHEMA_REGISTRY_CONTRACT_ID */
export const SCHEMA_REGISTRY_PROGRAM_ID = SCHEMA_REGISTRY_CONTRACT_ID;

export type FieldType = "bool" | "u8" | "u16" | "u32" | "u64" | "string" | "pubkey";

export interface FieldDef {
  id: string;
  name: string;
  type: FieldType;
}

export interface SchemaV2 {
  address: string;
  schemaId: string;
  authority: string;
  resolver: string;
  revocable: boolean;
  name: string;
  fieldDefinitions: string;
  version: number;
  delegates: string[];
  createdAt: number;
  schemaExpiryLedger: number;
  /** @deprecated alias */
  schemaExpirySlot: number;
  deprecated: boolean;
}

export function parseFieldDefs(fieldDefs: string): FieldDef[] {
  if (!fieldDefs.trim()) return [];
  return fieldDefs.split(",").map((part, i) => {
    const trimmed = part.trim();
    const spaceIdx = trimmed.indexOf(" ");
    const type = (spaceIdx === -1 ? "string" : trimmed.slice(0, spaceIdx)) as FieldType;
    const name = spaceIdx === -1 ? trimmed : trimmed.slice(spaceIdx + 1);
    return { id: String(i), name: name.trim(), type: type.trim() as FieldType };
  });
}

export function fieldDefsToString(fields: FieldDef[]): string {
  return fields
    .filter((f) => f.name.trim())
    .map((f) => `${f.type} ${f.name.trim()}`)
    .join(", ");
}

function addressToBytes(address: string): Uint8Array {
  return Uint8Array.from(StrKey.decodeEd25519PublicKey(address));
}

export async function computeSchemaId(
  authority: string,
  name: string,
  version: number = 1,
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const authorityBytes = addressToBytes(authority);
  const nameBytes = encoder.encode(name);
  const versionByte = new Uint8Array([version]);
  const combined = new Uint8Array(
    authorityBytes.length + nameBytes.length + versionByte.length,
  );
  combined.set(authorityBytes, 0);
  combined.set(nameBytes, authorityBytes.length);
  combined.set(versionByte, authorityBytes.length + nameBytes.length);
  const hashBuffer = await crypto.subtle.digest("SHA-256", combined);
  return new Uint8Array(hashBuffer);
}

/** Estimated XLM reserve hint for schema registration UI */
export const SCHEMA_RENT_LAMPORTS = 10_000_000n;

export const SchemaV2Schema = z.object({
  address: z.string(),
  schemaId: z.string(),
  authority: z.string(),
  resolver: z.string(),
  revocable: z.boolean(),
  name: z.string().max(64),
  fieldDefinitions: z.string().max(256),
  version: z.number(),
  delegates: z.array(z.string()),
  createdAt: z.number(),
  schemaExpirySlot: z.number(),
  deprecated: z.boolean(),
});

export const SchemaV2ArraySchema = z.array(SchemaV2Schema);

export async function prepareRegisterSchema(
  authority: string,
  name: string,
): Promise<{ schemaId: Uint8Array; schemaKey: string }> {
  const schemaId = await computeSchemaId(authority, name, 1);
  const schemaKey = `${authority}:${Array.from(schemaId).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  return { schemaId, schemaKey };
}

export function packSchemaIdToField(schemaId: Uint8Array): string {
  return "0x" + Array.from(schemaId).map((b) => b.toString(16).padStart(2, "0")).join("");
}
