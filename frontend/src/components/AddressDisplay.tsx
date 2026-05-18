import { useState, useCallback } from "react";

function truncateAddress(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

const CopyIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

type AddressDisplayProps = {
  address: string;
  /** Optional class name for the outer wrapper (e.g. for layout) */
  className?: string;
};

export function AddressDisplay({ address, className = "" }: AddressDisplayProps) {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.clipboard.writeText(address).then(
        () => {
          setIsCopied(true);
          window.setTimeout(() => setIsCopied(false), 2000);
        },
        () => {},
      );
    },
    [address],
  );

  const display = truncateAddress(address);
  const tooltipText = isCopied ? "Copied!" : "Copy Address";

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-lg border border-border bg-neutral-900 px-2.5 py-1.5 font-mono text-sm text-neutral-400 transition-colors hover:border-neutral-700 hover:bg-neutral-800 ${className}`}
      role="group"
    >
      <span className="tabular-nums">{display}</span>
      <button
        type="button"
        onClick={handleCopy}
        className="flex items-center justify-center rounded p-0.5 text-neutral-500 transition-colors hover:bg-neutral-700 hover:text-neutral-300 focus:outline-none focus:ring-2 focus:ring-white/20 focus:ring-offset-1 focus:ring-offset-black"
        aria-label="Copy wallet address"
        title={tooltipText}
      >
        {isCopied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </div>
  );
}
