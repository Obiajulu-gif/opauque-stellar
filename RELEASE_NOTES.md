# Release notes

## v1 (in progress)

Mainnet v1 deployment evidence is recorded in versioned manifests under `deployments/v1/`.

| Network | Manifest | Status |
|---------|----------|--------|
| Testnet | [deployments/v1/testnet.json](deployments/v1/testnet.json) | Template — contract IDs filled after deploy |
| Mainnet | [deployments/v1/mainnet.json](deployments/v1/mainnet.json) | Not deployed |

### What each manifest records

- Soroban contract IDs and per-contract WASM SHA-256 hashes
- Stellar network passphrase, deployment ledger, and timestamps
- Deployer, admin, and multisig accounts (when applicable)
- `verification.command` and captured `verification.output` for reproducible checks
- Frontend build git commit (`artifacts.frontend.buildCommit`)
- Circom v2 circuit artifact hashes (`artifacts.circuits.v2`)

### Verifying a release

```bash
npm run verify:deployment
# After contracts are built:
node scripts/verify-deployment-manifest.mjs --network testnet --check-wasm --strict
```

CI runs `verify:deployment` on every push and verifies the frontend build against the testnet manifest layout.

### Updating after deploy

See [deployments/README.md](deployments/README.md).
