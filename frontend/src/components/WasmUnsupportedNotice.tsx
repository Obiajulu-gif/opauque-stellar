/**
 * Shown when the browser does not support WebAssembly.
 * Private Balance scanning requires WASM; all other wallet features remain usable.
 */
export function WasmUnsupportedNotice() {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-6 text-center">
      <p className="mb-1 text-base font-semibold text-amber-300">
        Private Balance unavailable
      </p>
      <p className="mb-4 text-sm text-mist/70">
        Your browser does not support WebAssembly, which is required for
        private balance scanning. Sending, receiving, and other wallet
        features still work normally.
      </p>
      <a
        href="https://webassembly.org/roadmap/"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block rounded-lg bg-amber-500/20 px-4 py-2 text-xs font-medium text-amber-200 hover:bg-amber-500/30 transition-colors"
      >
        View supported browsers →
      </a>
    </div>
  );
}
