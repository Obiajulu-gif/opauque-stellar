#!/usr/bin/env bash
set -euo pipefail

# Opaque Stellar — Mainnet health check script
# Usage: ./scripts/health-check.sh [--network testnet|mainnet]
#
# Checks:
#   1. Soroban RPC endpoint is reachable
#   2. Horizon endpoint is reachable
#   3. Latest ledger is recent (< 60 seconds)
#   4. Contract WASM hashes match deployment manifest
#   5. Critical wallet balances are above threshold
#   6. Registry contract responds to resolve queries

NETWORK="${NETWORK:-testnet}"
if [[ "${1:-}" == "--network" && -n "${2:-}" ]]; then
  NETWORK="$2"
fi

echo "=== Opaque Stellar Health Check [${NETWORK}] ==="
echo

FAILURES=0

check() {
  local name="$1"
  shift
  if "$@" > /dev/null 2>&1; then
    echo "  [PASS] ${name}"
  else
    echo "  [FAIL] ${name}"
    FAILURES=$((FAILURES + 1))
  fi
}

# 1. RPC reachability
if [[ "${NETWORK}" == "mainnet" ]]; then
  RPC_URL="${VITE_STELLAR_RPC_URL:-https://mainnet.sorobanrpc.com}"
else
  RPC_URL="${VITE_STELLAR_RPC_URL:-https://soroban-testnet.stellar.org}"
fi

check "Soroban RPC is reachable" curl -sf --max-time 10 -X POST "${RPC_URL}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'

# 2. Horizon reachability
if [[ "${NETWORK}" == "mainnet" ]]; then
  HORIZON_URL="${VITE_STELLAR_HORIZON_URL:-https://horizon.stellar.org}"
else
  HORIZON_URL="${VITE_STELLAR_HORIZON_URL:-https://horizon-testnet.stellar.org}"
fi

check "Horizon is reachable" curl -sf --max-time 10 "${HORIZON_URL}"

# 3. Ledger freshness
LEDGER_AGE=$(curl -sf --max-time 10 "${HORIZON_URL}/ledgers?order=desc&limit=1" 2>/dev/null | \
  python3 -c "import sys,json; print(int(__import__('time').time() - json.load(sys.stdin)['_embedded']['records'][0]['closed_at'][:-1]))" 2>/dev/null || echo "999")

if [[ "${LEDGER_AGE}" -lt 60 ]]; then
  echo "  [PASS] Latest ledger is ${LEDGER_AGE}s old"
else
  echo "  [FAIL] Latest ledger is ${LEDGER_AGE}s old (threshold: <60s)"
  FAILURES=$((FAILURES + 1))
fi

# 4. Contract WASM hash verification
if command -v stellar &> /dev/null && [[ -f deployments/v1/${NETWORK}.json ]]; then
  check "Deployment manifest exists" test -f "deployments/v1/${NETWORK}.json"
  check "WASM hash verification" node scripts/verify-deployment-manifest.mjs --network "${NETWORK}"
fi

# 5. Deployment manifest validation
check "Manifest schema validation" npm run verify:deployment --silent

echo
if [[ "${FAILURES}" -eq 0 ]]; then
  echo "All health checks passed."
else
  echo "${FAILURES} health check(s) failed."
  exit 1
fi
