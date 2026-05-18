/**
 * Stellar Explorer URLs by network.
 */

import { getNetwork, type StellarNetwork } from "./chain";

function getExplorerBase(network: StellarNetwork): string {
  switch (network) {
    case "mainnet":
      return "https://stellar.expert/explorer/public";
    case "futurenet":
      return "https://stellar.expert/explorer/futurenet";
    case "local":
      return "https://stellar.expert/explorer/testnet";
    default:
      return "https://stellar.expert/explorer/testnet";
  }
}

export function getExplorerTxUrl(txHash: string): string {
  return `${getExplorerBase(getNetwork())}/tx/${txHash}`;
}

export function getExplorerAccountUrl(address: string): string {
  return `${getExplorerBase(getNetwork())}/account/${address}`;
}

/** @deprecated alias */
export const getExplorerAddressUrl = getExplorerAccountUrl;

export function getExplorerContractUrl(contractId: string): string {
  return `${getExplorerBase(getNetwork())}/contract/${contractId}`;
}
