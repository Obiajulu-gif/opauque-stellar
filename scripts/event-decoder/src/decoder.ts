/**
 * Opaque event decoder — maps raw Soroban contract events to typed records.
 *
 * Supports:
 *   - StealthAnnouncer: "Announcement" (v1)
 *   - AttestationEngineV2: "AttestationCreated" (v1), "AttestationRevoked" (v1)
 *
 * Unknown versions → SkippedEvent with reason "UnknownVersion".
 * Unknown topics   → SkippedEvent with reason "UnknownTopic".
 * Malformed data   → SkippedEvent with reason "MalformedPayload".
 */

import {
  SUPPORTED_EVENT_VERSION,
  type DecodedEvent,
  type AnnouncementEvent,
  type AttestationCreatedEvent,
  type AttestationRevokedEvent,
  type SkippedEvent,
} from "./types.js";

/** Minimal shape of a Stellar Horizon event entry as returned by the SDK. */
export interface RawSorobanEvent {
  /** Topics array — first element is the event name Symbol, second is the version u32. */
  topic: unknown[];
  /** Event body / data — tuple of fields. */
  value: unknown;
  ledger: number;
  txHash: string;
}

function bytesLike(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Uint8Array) return Buffer.from(v).toString("hex");
  if (
    v !== null &&
    typeof v === "object" &&
    "type" in v &&
    (v as { type: string }).type === "Buffer" &&
    "data" in v
  ) {
    return Buffer.from((v as { data: number[] }).data).toString("hex");
  }
  return String(v);
}

function extractTopic(raw: unknown): { name: string; version: number } | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const name =
    typeof raw[0] === "string"
      ? raw[0]
      : raw[0]?.value ?? String(raw[0]);
  const version =
    typeof raw[1] === "number"
      ? raw[1]
      : typeof raw[1]?.value === "number"
        ? raw[1].value
        : Number(raw[1]);
  if (typeof name !== "string" || isNaN(version)) return null;
  return { name, version };
}

function decodeAnnouncement(
  version: number,
  value: unknown,
  ledger: number,
  txHash: string,
): AnnouncementEvent | SkippedEvent {
  if (version !== SUPPORTED_EVENT_VERSION) {
    return { kind: "Skipped", reason: "UnknownVersion", rawTopic: "Announcement", version, ledger, txHash };
  }
  try {
    const [schemeId, stealthAddress, caller, ephemeralPubKey, metadata] =
      value as [unknown, unknown, unknown, unknown, unknown];
    return {
      kind: "Announcement",
      version,
      schemeId: BigInt(String(schemeId)),
      stealthAddress: bytesLike(stealthAddress),
      caller: String(caller),
      ephemeralPubKey: bytesLike(ephemeralPubKey),
      metadata: bytesLike(metadata),
      ledger,
      txHash,
    };
  } catch {
    return { kind: "Skipped", reason: "MalformedPayload", rawTopic: "Announcement", ledger, txHash };
  }
}

function decodeAttestationCreated(
  version: number,
  value: unknown,
  ledger: number,
  txHash: string,
): AttestationCreatedEvent | SkippedEvent {
  if (version !== SUPPORTED_EVENT_VERSION) {
    return { kind: "Skipped", reason: "UnknownVersion", rawTopic: "AttestationCreated", version, ledger, txHash };
  }
  try {
    const [uid, schemaId, issuer, stealthAddressHash] =
      value as [unknown, unknown, unknown, unknown];
    return {
      kind: "AttestationCreated",
      version,
      uid: bytesLike(uid),
      schemaId: bytesLike(schemaId),
      issuer: String(issuer),
      stealthAddressHash: bytesLike(stealthAddressHash),
      ledger,
      txHash,
    };
  } catch {
    return { kind: "Skipped", reason: "MalformedPayload", rawTopic: "AttestationCreated", ledger, txHash };
  }
}

function decodeAttestationRevoked(
  version: number,
  value: unknown,
  ledger: number,
  txHash: string,
): AttestationRevokedEvent | SkippedEvent {
  if (version !== SUPPORTED_EVENT_VERSION) {
    return { kind: "Skipped", reason: "UnknownVersion", rawTopic: "AttestationRevoked", version, ledger, txHash };
  }
  try {
    const [uid, revoker] = value as [unknown, unknown];
    return {
      kind: "AttestationRevoked",
      version,
      uid: bytesLike(uid),
      revoker: String(revoker),
      ledger,
      txHash,
    };
  } catch {
    return { kind: "Skipped", reason: "MalformedPayload", rawTopic: "AttestationRevoked", ledger, txHash };
  }
}

/**
 * Decode a single raw Soroban event into a typed record.
 *
 * @param raw - A single event object from the Horizon `/events` endpoint.
 * @returns A typed DecodedEvent; unknown or malformed events become SkippedEvent.
 */
export function decodeEvent(raw: RawSorobanEvent): DecodedEvent {
  const topic = extractTopic(raw.topic);
  if (!topic) {
    return { kind: "Skipped", reason: "MalformedPayload", rawTopic: "", ledger: raw.ledger, txHash: raw.txHash };
  }

  const { name, version } = topic;

  switch (name) {
    case "Announcement":
      return decodeAnnouncement(version, raw.value, raw.ledger, raw.txHash);
    case "AttestationCreated":
      return decodeAttestationCreated(version, raw.value, raw.ledger, raw.txHash);
    case "AttestationRevoked":
      return decodeAttestationRevoked(version, raw.value, raw.ledger, raw.txHash);
    default:
      return { kind: "Skipped", reason: "UnknownTopic", rawTopic: name, version, ledger: raw.ledger, txHash: raw.txHash };
  }
}

/**
 * Decode an array of raw events, returning all typed results including skipped entries.
 */
export function decodeEvents(raws: RawSorobanEvent[]): DecodedEvent[] {
  return raws.map(decodeEvent);
}

/**
 * Decode and filter: return only successfully decoded events (drops all SkippedEvents).
 */
export function decodeEventsStrict(
  raws: RawSorobanEvent[],
): Exclude<DecodedEvent, SkippedEvent>[] {
  return decodeEvents(raws).filter(
    (e): e is Exclude<DecodedEvent, SkippedEvent> => e.kind !== "Skipped",
  );
}
