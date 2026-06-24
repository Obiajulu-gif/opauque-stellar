/**
 * Example Opaque event indexer.
 *
 * Fetches raw Soroban contract events from the Stellar Horizon API and decodes
 * them using the opaque-event-decoder package.
 *
 * Usage:
 *   npx ts-node scripts/event-decoder/example-indexer.ts
 *
 * Set HORIZON_URL and CONTRACT_ID env vars or adjust the constants below.
 */

import {
  decodeEvents,
  type AnnouncementEvent,
  type AttestationCreatedEvent,
  type AttestationRevokedEvent,
} from "./src/index.js";

const HORIZON_URL =
  process.env["HORIZON_URL"] ?? "https://horizon-testnet.stellar.org";
const CONTRACT_ID = process.env["CONTRACT_ID"] ?? "";

interface HorizonEventRecord {
  type: string;
  ledger: number;
  id: string;
  transaction_hash: string;
  topic: unknown[];
  value: { xdr: string };
}

async function fetchEvents(
  contractId: string,
  startLedger: number,
): Promise<HorizonEventRecord[]> {
  const url = new URL(`${HORIZON_URL}/events`);
  url.searchParams.set("contract_id", contractId);
  url.searchParams.set("start_ledger", String(startLedger));
  url.searchParams.set("limit", "100");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Horizon /events failed: ${res.status}`);
  const json = (await res.json()) as { _embedded?: { records?: HorizonEventRecord[] } };
  return json._embedded?.records ?? [];
}

async function main() {
  if (!CONTRACT_ID) {
    console.error("Set CONTRACT_ID env var to a Stellar contract address.");
    process.exit(1);
  }

  console.log(`Indexing events for contract: ${CONTRACT_ID}`);

  const rawRecords = await fetchEvents(CONTRACT_ID, 1);

  // Map Horizon records to the shape the decoder expects
  const rawEvents = rawRecords.map((r) => ({
    topic: r.topic,
    value: r.value,
    ledger: r.ledger,
    txHash: r.transaction_hash,
  }));

  const decoded = decodeEvents(rawEvents);

  let announcements = 0;
  let created = 0;
  let revoked = 0;
  let skipped = 0;

  for (const event of decoded) {
    switch (event.kind) {
      case "Announcement": {
        const e = event as AnnouncementEvent;
        console.log(`[${e.ledger}] Announcement  caller=${e.caller}  scheme=${e.schemeId}`);
        announcements++;
        break;
      }
      case "AttestationCreated": {
        const e = event as AttestationCreatedEvent;
        console.log(`[${e.ledger}] AttestationCreated  uid=${e.uid}  issuer=${e.issuer}`);
        created++;
        break;
      }
      case "AttestationRevoked": {
        const e = event as AttestationRevokedEvent;
        console.log(`[${e.ledger}] AttestationRevoked  uid=${e.uid}  revoker=${e.revoker}`);
        revoked++;
        break;
      }
      default:
        skipped++;
        break;
    }
  }

  console.log(
    `\nSummary: ${announcements} announcements, ${created} attestations created, ` +
    `${revoked} revoked, ${skipped} skipped.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
