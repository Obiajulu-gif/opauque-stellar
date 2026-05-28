/**
 * Stellar Soroban contract configuration per network.
 */

import { DEPLOYMENT_MANIFESTS } from "@deployments/index";
import type { StellarNetwork } from "../lib/chain";
import {
  deployedAddresses,
  PLACEHOLDER_CONTRACT_ID,
  contractEnvKeysForNetwork,
} from "./deployedAddresses";
import { isValidStellarContractId } from "./deploymentManifest";
import { CONTRACT_KEYS, manifestContractIds } from "@deployments/types";

export type ClusterProgramConfig = {
  registryContract: string;
  announcerContract: string;
  groth16Contract: string;
  reputationContract: string;
  schemaRegistryContract: string;
  attestationEngineContract: string;
  /** @deprecated legacy alias */
  registryProgram: string;
  /** @deprecated legacy alias */
  announcerProgram: string;
  /** @deprecated legacy alias */
  groth16Program: string;
  /** @deprecated legacy alias */
  reputationProgram: string;
};

function withAliases(
  c: Omit<ClusterProgramConfig, "registryProgram" | "announcerProgram" | "groth16Program" | "reputationProgram">,
): ClusterProgramConfig {
  return {
    ...c,
    registryProgram: c.registryContract,
    announcerProgram: c.announcerContract,
    groth16Program: c.groth16Contract,
    reputationProgram: c.reputationContract,
  };
}

const baseContracts = {
  registryContract: deployedAddresses.stealthRegistry,
  announcerContract: deployedAddresses.stealthAnnouncer,
  groth16Contract: deployedAddresses.groth16Verifier,
  reputationContract: deployedAddresses.reputationVerifier,
  schemaRegistryContract: deployedAddresses.schemaRegistry,
  attestationEngineContract: deployedAddresses.attestationEngineV2,
};

function getEnvValue(key: string): string {
  return (import.meta.env[key] as string | undefined)?.trim() ?? "";
}

function allContractsValid(ids: Record<string, string>): boolean {
  return CONTRACT_KEYS.every((key) => {
    const value = ids[key];
    return (
      value.length > 0 &&
      value !== PLACEHOLDER_CONTRACT_ID &&
      isValidStellarContractId(value)
    );
  });
}

function hasExplicitMainnetContracts(): boolean {
  const fromEnv = Object.fromEntries(
    contractEnvKeysForNetwork("mainnet").map((envKey, i) => [
      CONTRACT_KEYS[i],
      getEnvValue(envKey),
    ]),
  ) as Record<(typeof CONTRACT_KEYS)[number], string>;

  if (allContractsValid(fromEnv)) return true;

  const fromManifest = manifestContractIds(DEPLOYMENT_MANIFESTS.mainnet);
  return (
    DEPLOYMENT_MANIFESTS.mainnet.deploymentStatus === "deployed" &&
    allContractsValid(fromManifest)
  );
}

function isProductionMainnetProviderUrl(rawUrl: string, publicHosts: Set<string>): boolean {
  if (!rawUrl) return false;

  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:") return false;
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") {
      return false;
    }
    if (host.includes("testnet") || host.includes("futurenet") || host.includes("local")) {
      return false;
    }
    return !publicHosts.has(`${url.protocol}//${host}`);
  } catch {
    return false;
  }
}

function hasProductionMainnetProviders(): boolean {
  return (
    isProductionMainnetProviderUrl(
      getEnvValue("VITE_STELLAR_RPC_URL"),
      new Set(["https://mainnet.sorobanrpc.com"]),
    ) &&
    isProductionMainnetProviderUrl(
      getEnvValue("VITE_STELLAR_HORIZON_URL"),
      new Set(["https://horizon.stellar.org"]),
    )
  );
}

export function isMainnetConfigValid(): boolean {
  return hasExplicitMainnetContracts() && hasProductionMainnetProviders();
}

const STATIC_CONFIG: Partial<Record<StellarNetwork, ClusterProgramConfig>> = {
  testnet: withAliases(baseContracts),
  futurenet: withAliases(baseContracts),
  local: withAliases(baseContracts),
};

export const CLUSTER_CONFIG: Partial<Record<StellarNetwork, ClusterProgramConfig>> = {
  ...STATIC_CONFIG,
  ...(isMainnetConfigValid() ? { mainnet: withAliases(baseContracts) } : {}),
};

export function getConfigForCluster(
  network: StellarNetwork | null | undefined,
): ClusterProgramConfig | null {
  if (network == null) return null;
  return CLUSTER_CONFIG[network] ?? null;
}

export const SUPPORTED_NETWORKS: readonly StellarNetwork[] = [
  "testnet",
  "futurenet",
  "local",
  "mainnet",
];

export function isClusterSupported(network: StellarNetwork | null | undefined): boolean {
  if (network == null || !SUPPORTED_NETWORKS.includes(network)) return false;
  if (network === "mainnet") return isMainnetConfigValid();
  return true;
}

export function getNetworkSupportMessage(network: StellarNetwork | null | undefined): string {
  if (network === "mainnet") {
    return "Mainnet requires production HTTPS VITE_STELLAR_RPC_URL and VITE_STELLAR_HORIZON_URL values plus mainnet contract IDs in deployments/v1/mainnet.json or VITE_MAINNET_* env vars.";
  }
  return `Set VITE_STELLAR_NETWORK to one of: ${SUPPORTED_NETWORKS.join(", ")}.`;
}

/** @deprecated */
export const SUPPORTED_CLUSTERS = SUPPORTED_NETWORKS;
export const isNetworkSupported = isClusterSupported;
