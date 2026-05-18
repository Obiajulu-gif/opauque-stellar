/**
 * Inline explorer link: truncated address (or tx signature) with a "Launch" icon on hover.
 * Clicking the icon opens Stellar Expert for that address or transaction in a new tab.
 */

import { useState } from "react";
import { getExplorerAddressUrl, getExplorerTxUrl } from "../lib/explorer";

function truncate(value: string, start = 6, end = 4): string {
  if (value.length <= start + end + 2) return value;
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

const LaunchIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

type ExplorerLinkProps = {
  cluster?: string | null;
  value: string;
  type?: "address" | "tx";
  className?: string;
  startChars?: number;
  endChars?: number;
  copyOnAddressClick?: boolean;
};

export function ExplorerLink({
  cluster: _cluster,
  value,
  type = "address",
  className = "",
  startChars = 10,
  endChars = 8,
  copyOnAddressClick = false,
}: ExplorerLinkProps) {
  const [hover, setHover] = useState(false);
  const [copied, setCopied] = useState(false);
  const url =
    type === "tx"
      ? getExplorerTxUrl(value)
      : getExplorerAddressUrl(value);

  const display = truncate(value, startChars, endChars);

  if (url == null) {
    return (
      <span className={`font-mono text-neutral-400 ${className}`} title={value}>
        {display}
      </span>
    );
  }

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // ignore clipboard failures
    }
  };

  if (copyOnAddressClick) {
    return (
      <span
        className={`inline-flex items-center gap-1 font-mono text-neutral-400 transition-colors ${className}`}
        title={value}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <button
          type="button"
          onClick={handleCopyAddress}
          className="tabular-nums text-left hover:text-white transition-colors"
          title={copied ? "Copied!" : "Click to copy"}
        >
          {copied ? "Copied!" : display}
        </button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex text-neutral-500 transition-colors ${hover ? "text-neutral-300" : ""}`}
          aria-label="Open in explorer"
          title="Open in explorer"
        >
          <LaunchIcon />
        </a>
      </span>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 font-mono text-neutral-400 hover:text-neutral-300 transition-colors ${className}`}
      title={value}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className="tabular-nums">{display}</span>
      {hover && (
        <span className="inline-flex text-neutral-500 hover:text-neutral-300" aria-hidden>
          <LaunchIcon />
        </span>
      )}
    </a>
  );
}
