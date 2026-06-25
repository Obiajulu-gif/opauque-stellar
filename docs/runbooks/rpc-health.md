# Stellar RPC and Horizon health probe runbook

The ops health probe checks the configured Horizon and Soroban RPC endpoints that wallets depend on before users start signing transactions.

## What it covers

Configuration lives beside the deployment manifests in `deployments/v1/rpc-health.json` and includes:

- testnet Horizon primary and fallback URLs,
- testnet Soroban RPC primary and fallback URLs,
- mainnet Horizon primary and fallback URLs,
- mainnet Soroban RPC primary and fallback URLs,
- timeout, warning latency, and max error-rate thresholds,
- optional alert webhook configuration through `OPS_ALERT_WEBHOOK_URL`.

## Manual probe

Run all configured networks:

```bash
npm run ops:health
```

Run one network only:

```bash
node scripts/probe-horizon-rpc.mjs --network testnet
node scripts/probe-horizon-rpc.mjs --network mainnet
```

Each endpoint emits one structured JSON log with:

- `network`,
- `kind` (`horizon` or `rpc`),
- `role` (`primary` or `fallback`),
- `url`,
- `ok`,
- `latencyMs`,
- latest ledger sequence when available,
- error message when unavailable.

The script also emits a `stellar_endpoint_probe_summary` record with total checks, failures, and error rate.

## Alerts

Set `OPS_ALERT_WEBHOOK_URL` in the environment or GitHub Actions secret to send a JSON alert payload when the measured error rate exceeds `thresholds.maxErrorRate`.

```bash
OPS_ALERT_WEBHOOK_URL=https://alerts.example/hooks/stellar npm run ops:health
```

The alert body includes the summary plus all failed endpoint records so operators can tell whether the primary, fallback, Horizon, or RPC path failed.

## GitHub Action

`.github/workflows/rpc-health.yml` runs the probe every 15 minutes and supports manual dispatch with an optional network input.

Use manual dispatch when:

- wallets report signing or submission failures,
- a provider announces maintenance,
- a deployment switches endpoint configuration,
- post-rollback smoke testing requires evidence.

## Response guidance

1. If one primary fails but fallback passes, keep monitoring and consider switching the deployment config if the failure persists.
2. If primary and fallback fail for the same kind/network, pause releases that rely on that network and notify users.
3. If Horizon passes but RPC fails, read-only wallet views may still work but Soroban contract writes can fail.
4. If RPC passes but Horizon fails, account and history reads can degrade even if contract invocations still submit.
