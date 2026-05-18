import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-ink-950 bg-grid-fade bg-size-grid px-4">
      <p className="text-sol-purple text-sm font-mono mb-2">404</p>
      <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-white text-center mb-6">
        You've wandered into the void.
      </h1>
      <p className="text-mist text-sm text-center max-w-sm mb-8">
        This address does not exist.
      </p>
      <Link
        to="/app"
        className="px-4 py-2 rounded-lg text-sm font-medium border border-ink-600 text-mist hover:text-white hover:border-sol-purple/30 transition-colors"
      >
        Return to Vault
      </Link>
    </div>
  );
}
