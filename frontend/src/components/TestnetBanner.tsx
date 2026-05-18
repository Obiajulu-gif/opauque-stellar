type TestnetBannerProps = {
  isConnected: boolean;
};

function FlaskIcon() {
  return (
    <svg
      className="w-4 h-4 text-sol-purple shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10 2v7.31" />
      <path d="M14 9.3V1.99" />
      <path d="M8.5 2h7" />
      <path d="M14 9.3a6.5 6.5 0 1 1-4 0" />
      <path d="M5.52 16h12.96" />
    </svg>
  );
}

export function TestnetBanner({ isConnected }: TestnetBannerProps) {
  const copy = isConnected
    ? "Alpha Phase: Opaque is live on Testnet. Please ensure you are using testnet only."
    : "Connect your wallet to access your private stealth vault on Testnet.";

  return (
    <div
      className="banner-glass flex items-center gap-3 px-4 py-2.5 text-sm text-neutral-300 border-b border-sol-purple/10"
      role="status"
      aria-live="polite"
    >
      <span
        className="flex items-center justify-center w-7 h-7 rounded-full bg-sol-purple/10 border border-sol-purple/25 shrink-0"
        style={{ boxShadow: "0 0 12px rgba(153, 69, 255, 0.2)" }}
        aria-hidden
      >
        <FlaskIcon />
      </span>
      <span className="min-w-0 flex-1">{copy}</span>
    </div>
  );
}
