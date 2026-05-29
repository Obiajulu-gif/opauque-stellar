/**
 * Shared Nullifier Store — verifier-service backed nullifier consumption.
 *
 * This demo intentionally does not trust browser localStorage for replay
 * protection. A public gate must call a shared backend, signed verifier service,
 * or on-chain nullifier registry so a consumed nullifier is rejected across
 * browsers, devices, and users.
 */

import { DEMO_CONFIG } from "./config";

export interface NullifierConsumeResult {
  consumed: boolean;
  reason?: string;
}

async function postNullifier(nullifierHash: string): Promise<NullifierConsumeResult> {
  const response = await fetch(DEMO_CONFIG.NULLIFIER_API_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nullifierHash: nullifierHash.toLowerCase() }),
  });

  if (response.status === 409) {
    return { consumed: false, reason: "This proof has already been used." };
  }

  if (!response.ok) {
    return {
      consumed: false,
      reason: `Nullifier service rejected the request (${response.status}).`,
    };
  }

  const body = await response.json().catch(() => ({}));
  return {
    consumed: body.consumed !== false,
    reason: typeof body.reason === "string" ? body.reason : undefined,
  };
}

/**
 * Atomically consume a nullifier in shared storage.
 *
 * The backend must perform this as a single insert-if-absent operation, such as
 * a database unique constraint or on-chain nullifier set. LocalStorage fallback
 * is deliberately not provided because it does not protect public gates.
 */
export async function consumeNullifier(nullifierHash: string): Promise<NullifierConsumeResult> {
  return postNullifier(nullifierHash);
}
