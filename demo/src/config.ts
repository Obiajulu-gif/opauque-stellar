/**
 * Demo Gate Configuration
 *
 * Each real dApp deployment should:
 *   1. Pick a unique EXTERNAL_NULLIFIER so that proofs generated for this app
 *      cannot be replayed in any other app (they bind the nullifier_hash to
 *      this specific value).
 *   2. Optionally lock to a specific REQUIRED_SCHEMA_ID so that only holders
 *      of a particular attestation type can enter.
 *   3. Provide a shared nullifier endpoint backed by server storage or an
 *      on-chain nullifier registry. Browser localStorage is not sufficient for
 *      public gates because users can clear it or switch devices.
 *
 * The value must be a decimal integer string or a 0x-prefixed hex string
 * (it is a BN254 field element inside the circuit).
 */

export const DEMO_CONFIG = {
  /** External nullifier — MUST match what the user enters in the Opaque proof generator. */
  EXTERNAL_NULLIFIER: "1",

  /**
   * Optional: restrict access to holders of a specific schema.
   * Set to null to accept proofs from any valid schema.
   *
   * Set to the schema ID hex string (0x-prefixed, 64 chars) to lock down
   * to one specific attestation type.
   *
   * Example:
   *   REQUIRED_SCHEMA_ID: "0xabc123...",
   */
  REQUIRED_SCHEMA_ID: null as string | null,

  /** Display name shown in the UI. */
  APP_NAME: "Opaque Demo Gate",

  /**
   * Shared backend or signed verifier endpoint that atomically consumes
   * nullifiers. It should return HTTP 409 for replayed nullifier hashes.
   */
  NULLIFIER_API_URL: import.meta.env.VITE_NULLIFIER_API_URL ?? "/api/nullifiers/consume",
} as const;
