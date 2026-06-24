/** Supported event schema version. Increment when the on-chain event ABI changes. */
export const SUPPORTED_EVENT_VERSION = 1;

// ── Announcement ──────────────────────────────────────────────────────────────

export interface AnnouncementEvent {
  kind: "Announcement";
  version: number;
  schemeId: bigint;
  stealthAddress: string;
  caller: string;
  ephemeralPubKey: string;
  metadata: string;
  ledger: number;
  txHash: string;
}

// ── AttestationCreated ────────────────────────────────────────────────────────

export interface AttestationCreatedEvent {
  kind: "AttestationCreated";
  version: number;
  uid: string;
  schemaId: string;
  issuer: string;
  stealthAddressHash: string;
  ledger: number;
  txHash: string;
}

// ── AttestationRevoked ────────────────────────────────────────────────────────

export interface AttestationRevokedEvent {
  kind: "AttestationRevoked";
  version: number;
  uid: string;
  revoker: string;
  ledger: number;
  txHash: string;
}

// ── Unknown / skipped events ──────────────────────────────────────────────────

export interface SkippedEvent {
  kind: "Skipped";
  reason: "UnknownVersion" | "UnknownTopic" | "MalformedPayload";
  rawTopic: string;
  version?: number;
  ledger: number;
  txHash: string;
}

export type DecodedEvent =
  | AnnouncementEvent
  | AttestationCreatedEvent
  | AttestationRevokedEvent
  | SkippedEvent;
