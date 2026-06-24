/**
 * Detect WebAssembly support in the current browser.
 *
 * Checks that both the WebAssembly global and the `instantiate` entrypoint
 * exist and are callable. WASM is required for Private Balance scanning.
 */
export function isWasmSupported(): boolean {
  try {
    return (
      typeof WebAssembly === "object" &&
      typeof WebAssembly.instantiate === "function" &&
      typeof WebAssembly.compile === "function"
    );
  } catch {
    return false;
  }
}
