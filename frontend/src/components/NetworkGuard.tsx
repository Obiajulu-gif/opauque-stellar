import type { ReactNode } from "react";
import { getConfiguredNetwork, getNetworkEnvValue } from "../lib/chain";
import {
  getNetworkSupportMessage,
  isClusterSupported,
} from "../contracts/contract-config";

type NetworkGuardProps = {
  children: ReactNode;
};

export function NetworkGuard({ children }: NetworkGuardProps) {
  const network = getConfiguredNetwork();
  const showUnsupported = !isClusterSupported(network);

  if (!showUnsupported) {
    return <>{children}</>;
  }

  return (
    <>
      {children}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby="network-guard-title"
      >
        <div className="max-w-md w-full">
          <div className="card text-center">
            <h2 id="network-guard-title" className="text-lg font-semibold text-white mb-2">
              Unsupported cluster
            </h2>
            <p className="text-sm text-neutral-400">
              Configured network{" "}
              <span className="font-mono text-white">{getNetworkEnvValue()}</span> is not available.
            </p>
            <p className="mt-2 text-sm text-neutral-400">
              {getNetworkSupportMessage(network)}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
