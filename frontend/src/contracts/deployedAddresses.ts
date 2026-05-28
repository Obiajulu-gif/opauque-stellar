/**
 * Soroban contract IDs — resolved from the canonical deployment manifest
 * (deployments/v1/<network>.json) with optional VITE_<NETWORK>_* overrides in dev.
 */

import { getNetwork } from "../lib/chain";
import {
  CONTRACT_KEYS,
  CONTRACT_ENV_SUFFIX,
  type ContractKey,
  resolveAllContractIds,
  assertProductionAddresses,
  getActiveManifest,
  isManifestNetwork,
} from "./deploymentManifest";

export type { ContractKey };

/** @deprecated Use manifest-backed IDs; kept for mainnet gating checks. */
export const PLACEHOLDER_CONTRACT_ID =
  "CDIYLW3OMCUHP37AMDZFMIB3GCY66MFICSCU3WYMB66L6XQM5CKQQO3S";

const network = getNetwork();
const resolved = resolveAllContractIds(network);

assertProductionAddresses(network, resolved);

export const deployedAddresses = {
  network,
  stealthRegistry: resolved.stealthRegistry,
  stealthAnnouncer: resolved.stealthAnnouncer,
  groth16Verifier: resolved.groth16Verifier,
  reputationVerifier: resolved.reputationVerifier,
  schemaRegistry: resolved.schemaRegistry,
  attestationEngineV2: resolved.attestationEngineV2,
} as const;

export type DeployedAddresses = typeof deployedAddresses;

/** Env keys used by contract-config mainnet validation (network-prefixed). */
export function contractEnvKeysForNetwork(
  network: "mainnet" | "testnet",
): string[] {
  return CONTRACT_KEYS.map(
    (key) => `VITE_${network.toUpperCase()}_${CONTRACT_ENV_SUFFIX[key]}`,
  );
}

export function getManifestPassphrase(): string | null {
  const manifest = getActiveManifest();
  return manifest?.networkPassphrase ?? null;
}

export function isDeployedOnActiveNetwork(): boolean {
  const manifest = getActiveManifest();
  if (!manifest || !isManifestNetwork(network)) return false;
  return manifest.deploymentStatus === "deployed";
}

export { CONTRACT_ENV_SUFFIX, CONTRACT_KEYS };
