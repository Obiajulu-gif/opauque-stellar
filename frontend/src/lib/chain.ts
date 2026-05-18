/**
 * Stellar network config.
 *
 * RPC resolution (first match wins):
 * - VITE_STELLAR_RPC_URL — Soroban/Horizon JSON-RPC (recommended)
 * - testnet / futurenet / mainnet — public defaults
 */

export type StellarNetwork = "testnet" | "futurenet" | "mainnet" | "local";

export const NETWORK_PASSPHRASES: Record<StellarNetwork, string> = {
  testnet: "Test SDF Network ; September 2015",
  futurenet: "Test SDF Future Network ; October 2022",
  mainnet: "Public Global Stellar Network ; September 2015",
  local: "Standalone Network ; February 2017",
};

export const RPC_ENDPOINTS: Record<StellarNetwork, string> = {
  testnet: "https://soroban-testnet.stellar.org",
  futurenet: "https://rpc-futurenet.stellar.org",
  mainnet: "https://mainnet.sorobanrpc.com",
  local: "http://localhost:8000/soroban/rpc",
};

export const HORIZON_ENDPOINTS: Record<StellarNetwork, string> = {
  testnet: "https://horizon-testnet.stellar.org",
  futurenet: "https://horizon-futurenet.stellar.org",
  mainnet: "https://horizon.stellar.org",
  local: "http://localhost:8000",
};

let rpcWarnLogged = false;

export function getNetwork(): StellarNetwork {
  const raw = import.meta.env.VITE_STELLAR_NETWORK as string | undefined;
  if (raw === "testnet" || raw === "futurenet" || raw === "mainnet" || raw === "local") {
    return raw;
  }
  return "testnet";
}

export function getRpcUrl(): string {
  const override = (import.meta.env.VITE_STELLAR_RPC_URL as string | undefined)?.trim();
  if (override) return override;
  const network = getNetwork();
  const url = RPC_ENDPOINTS[network];
  if (!rpcWarnLogged) {
    rpcWarnLogged = true;
    console.warn(
      "[Opaque] Using public Stellar RPC for",
      network,
      "— set VITE_STELLAR_RPC_URL for production.",
    );
  }
  return url;
}

export function getHorizonUrl(): string {
  const override = (import.meta.env.VITE_STELLAR_HORIZON_URL as string | undefined)?.trim();
  if (override) return override;
  return HORIZON_ENDPOINTS[getNetwork()];
}

export function getNetworkPassphrase(): string {
  return NETWORK_PASSPHRASES[getNetwork()];
}

/** @deprecated alias */
export const getCluster = getNetwork;
