# Deployment manifests

Canonical Soroban deployment records for Opaque Stellar. The frontend reads **only** these manifests (via `deployedAddresses.ts`); legacy `deployed-addresses.json` / Solana-style configs are removed.

## Layout

| File | Purpose |
|------|---------|
| `manifest.schema.json` | JSON Schema for v1 manifests |
| `types.ts` | Shared TypeScript types and helpers |
| `v1/testnet.json` | Testnet deployment record |
| `v1/mainnet.json` | Mainnet v1 deployment record |
| `v1/<network>.previous.json` | Last known-good deployment used by rollback automation |
| `v1/rpc-health.json` | Primary/fallback Horizon + Soroban RPC probe config |

## Manifest fields

Each network manifest records:

- **Network**: `network`, `networkPassphrase`, optional `rpcUrl` / `horizonUrl`
- **On-chain**: `contracts.*.id`, `deploymentLedger`, `deployedAt`
- **Artifacts**: `contracts.*.wasmHash` (SHA-256 hex of built WASM)
- **Governance**: `deployer`, `admin`, `multisig`
- **Reproducibility**: `verification.command` / `verification.output`, `artifacts.frontend.buildCommit`, `artifacts.circuits.v2.*` hashes

## Updating after deploy

1. Build contracts: `stellar contract build`
2. Deploy to the target network and note contract IDs + ledger sequence.
3. Refresh WASM hashes: `node scripts/update-manifest-wasm-hashes.mjs --network testnet`
4. Before editing the active manifest, copy the current known-good manifest to `deployments/v1/<network>.previous.json`.
5. Edit `deployments/v1/<network>.json` with contract IDs, ledger, deployer, admin, and set `deploymentStatus` to `deployed`.
6. Record verification output: `node scripts/verify-deployment-manifest.mjs --network testnet > /tmp/verify.txt` and paste into `verification.output`.
7. Set `artifacts.frontend.buildCommit` to the git SHA used for the release frontend build.
8. Verify: `node scripts/verify-deployment-manifest.mjs --network testnet --strict`
9. Probe external dependencies: `node scripts/probe-horizon-rpc.mjs --network testnet`

## Health probes

The scheduled workflow `.github/workflows/rpc-health.yml` runs `scripts/probe-horizon-rpc.mjs` against the endpoints in `v1/rpc-health.json`.

- The probe checks both primary and fallback Horizon/RPC URLs.
- Each endpoint emits structured JSON with latency, ledger, role, and status.
- If the error rate exceeds `thresholds.maxErrorRate`, the script exits non-zero and posts the structured failure summary to `OPS_ALERT_WEBHOOK_URL` when configured.
- Keep `v1/rpc-health.json` beside manifests so ops changes are reviewed with deployment changes.

## Rollback automation

Use rollback only when the active deployment is breaking users and restoring the previous manifest is safer than a forward fix:

```bash
node scripts/rollback-deployment.mjs --network testnet --dry-run
node scripts/rollback-deployment.mjs --network testnet --execute --smoke
```

See [`docs/runbooks/deployment-rollback.md`](../docs/runbooks/deployment-rollback.md) for the full decision tree, dry-run behavior, and smoke-test checklist.

## Frontend / CI

- Local dev may override manifest IDs with `VITE_<NETWORK>_*` env vars (non-production only).
- Production builds require manifest IDs or matching env overrides; CI runs `verify-deployment-manifest.mjs` to ensure env and manifest agree.
- See [RELEASE_NOTES.md](../RELEASE_NOTES.md) for release links.
