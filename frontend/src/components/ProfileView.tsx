import type { Tab } from "./Layout";

type ProfileViewProps = {
  onNavigate: (t: Tab) => void;
  onDisconnect: () => void;
};

export function ProfileView({ onNavigate: _onNavigate, onDisconnect }: ProfileViewProps) {
  return (
    <div className="w-full max-w-lg mx-auto">
      <h2 className="text-lg font-semibold text-white mb-1">Profile</h2>
      <p className="text-sm text-neutral-500 mb-6">
        Identity and session.
      </p>
      <div className="space-y-3">
        <button
          type="button"
          onClick={onDisconnect}
          className="w-full py-2.5 px-4 rounded-lg text-sm font-medium border border-error/40 text-error hover:bg-error/10 transition-colors"
        >
          Disconnect Wallet
        </button>
      </div>
    </div>
  );
}
