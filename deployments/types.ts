/**
 * Typed Stellar deployment manifest (v1).
 * Canonical source: deployments/v1/<network>.json
 */

export type DeploymentNetwork = "testnet" | "mainnet";

export type DeploymentStatus = "template" | "deployed" | "not_deployed";

export type ContractKey =
  | "stealthRegistry"
  | "stealthAnnouncer"
  | "groth16Verifier"
  | "reputationVerifier"
  | "schemaRegistry"
  | "attestationEngineV2";

export type ContractRecord = {
  id: string;
  wasmHash: string;
  package?: string;
};

export type DeploymentManifestV1 = {
  schemaVersion: "1.0.0";
  release: string;
  network: DeploymentNetwork;
  networkPassphrase: string;
  rpcUrl?: string;
  horizonUrl?: string;
  deploymentLedger: number | null;
  deployedAt: string | null;
  deployer: string | null;
  admin: string | null;
  multisig: string | null;
  deploymentStatus: DeploymentStatus;
  contracts: Record<ContractKey, ContractRecord>;
  artifacts: {
    frontend: {
      buildCommit: string | null;
      repository?: string;
    };
    circuits: {
      v2: {
        r1csHash: string | null;
        verificationKeyHash: string | null;
      };
    };
  };
  verification: {
    command: string;
    output: string | null;
  };
};

export const CONTRACT_KEYS: readonly ContractKey[] = [
  "stealthRegistry",
  "stealthAnnouncer",
  "groth16Verifier",
  "reputationVerifier",
  "schemaRegistry",
  "attestationEngineV2",
] as const;

export const CONTRACT_ENV_SUFFIX: Record<ContractKey, string> = {
  stealthRegistry: "STEALTH_REGISTRY_CONTRACT",
  stealthAnnouncer: "STEALTH_ANNOUNCER_CONTRACT",
  groth16Verifier: "GROTH16_VERIFIER_CONTRACT",
  reputationVerifier: "REPUTATION_VERIFIER_CONTRACT",
  schemaRegistry: "SCHEMA_REGISTRY_CONTRACT",
  attestationEngineV2: "ATTESTATION_ENGINE_CONTRACT",
};

export function contractEnvKey(network: DeploymentNetwork, key: ContractKey): string {
  return `VITE_${network.toUpperCase()}_${CONTRACT_ENV_SUFFIX[key]}`;
}

export function isValidStellarContractId(value: string): boolean {
  return /^C[A-Z2-7]{55}$/.test(value);
}

export function manifestContractIds(
  manifest: DeploymentManifestV1,
): Record<ContractKey, string> {
  return Object.fromEntries(
    CONTRACT_KEYS.map((key) => [key, manifest.contracts[key].id]),
  ) as Record<ContractKey, string>;
}
