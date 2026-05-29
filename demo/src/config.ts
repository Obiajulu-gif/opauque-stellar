/**
 * Demo Gate Configuration
 *
 * Each real dApp deployment should:
 *   1. Pick a unique EXTERNAL_NULLIFIER so that proofs generated for this app
 *      cannot be replayed in any other app.
 *   2. Optionally lock to a specific REQUIRED_SCHEMA_ID so that only holders
 *      of a particular attestation type can enter.
 *   3. Configure VITE_NULLIFIER_SERVICE_URL so nullifier consumption is enforced
 *      by shared backend, verifier-service, or chain adapter state.
 */

export const DEMO_CONFIG = {
  /** External nullifier — MUST match what the user enters in the Opaque proof generator. */
  EXTERNAL_NULLIFIER: "1",

  /**
   * Shared nullifier verifier endpoint.
   * Expected API:
   *   GET  /nullifiers/:hash -> 404 when unused, or { used: true } when used
   *   POST /nullifiers       -> 200/201 when consumed, 409 when already used
   */
  NULLIFIER_SERVICE_URL: import.meta.env.VITE_NULLIFIER_SERVICE_URL as string | undefined,

  /** Optional: restrict access to holders of a specific schema. */
  REQUIRED_SCHEMA_ID: null as string | null,

  /** Display name shown in the UI. */
  APP_NAME: "Opaque Demo Gate",
} as const;
