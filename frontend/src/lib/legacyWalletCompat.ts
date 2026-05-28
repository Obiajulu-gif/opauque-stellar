/**
 * Wallet hook compatibility for legacy UI components pending full Soroban port.
 */

import { useWallet as useStellarWallet } from "../hooks/useWallet";

export function useWallet() {
  const w = useStellarWallet();
  const pk = w.publicKey;
  return {
    ...w,
    publicKey: pk
      ? {
          toBytes: () => new Uint8Array(32),
          toBuffer: () => Buffer.alloc(32),
        }
      : null,
    sendTransaction: async (tx: { toXDR?: () => string }) => {
      if (tx?.toXDR && w.signTransaction) {
        const xdr = tx.toXDR();
        const signed = await w.signTransaction(xdr);
        return { serialize: () => Buffer.from(signed) };
      }
      throw new Error("Use Stellar signTransaction(xdr) flow");
    },
  };
}

export function useConnection() {
  return { connection: null };
}
