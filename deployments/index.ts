/**
 * Canonical deployment manifest registry.
 */

import testnetManifest from "./v1/testnet.json";
import mainnetManifest from "./v1/mainnet.json";
import type { DeploymentManifestV1, DeploymentNetwork } from "./types";

export const DEPLOYMENT_MANIFESTS: Record<
  DeploymentNetwork,
  DeploymentManifestV1
> = {
  testnet: testnetManifest as DeploymentManifestV1,
  mainnet: mainnetManifest as DeploymentManifestV1,
};

export function getDeploymentManifest(
  network: DeploymentNetwork,
): DeploymentManifestV1 {
  return DEPLOYMENT_MANIFESTS[network];
}

export * from "./types";
