#!/usr/bin/env node
/**
 * Lightweight ops probe for Stellar Horizon and Soroban RPC endpoints.
 *
 * Emits one JSON log per endpoint and exits non-zero when any configured
 * primary/fallback endpoint fails or exceeds the configured error threshold.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DEFAULT_CONFIG = join(ROOT, "deployments", "v1", "rpc-health.json");

function parseArgs(argv) {
  const opts = {
    config: DEFAULT_CONFIG,
    network: null,
    alertWebhook: process.env.OPS_ALERT_WEBHOOK_URL,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config" && argv[i + 1]) opts.config = resolve(argv[++i]);
    else if (arg === "--network" && argv[i + 1]) opts.network = argv[++i];
    else if (arg === "--alert-webhook" && argv[i + 1]) opts.alertWebhook = argv[++i];
  }
  return opts;
}

function endpointEntries(network, kind, section) {
  return [section.primary, ...(section.fallbacks ?? [])]
    .filter(Boolean)
    .map((url, index) => ({
      network,
      kind,
      role: index === 0 ? "primary" : "fallback",
      url,
    }));
}

function withTimeout(promise, timeoutMs, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(`${label} timed out after ${timeoutMs}ms`), timeoutMs);
  return promise(controller.signal).finally(() => clearTimeout(timer));
}

async function probeHorizon(entry, timeoutMs) {
  const started = Date.now();
  const url = `${entry.url.replace(/\/$/, "")}/ledgers?order=desc&limit=1`;
  try {
    const response = await withTimeout(
      (signal) => fetch(url, { signal, headers: { accept: "application/json" } }),
      timeoutMs,
      `Horizon ${entry.url}`,
    );
    const latencyMs = Date.now() - started;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    const ledger = body?._embedded?.records?.[0]?.sequence ?? null;
    return { ...entry, ok: true, latencyMs, ledger };
  } catch (error) {
    return { ...entry, ok: false, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
  }
}

async function probeRpc(entry, timeoutMs) {
  const started = Date.now();
  try {
    const response = await withTimeout(
      (signal) => fetch(entry.url, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLatestLedger", params: {} }),
      }),
      timeoutMs,
      `Soroban RPC ${entry.url}`,
    );
    const latencyMs = Date.now() - started;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error(body.error.message ?? JSON.stringify(body.error));
    return { ...entry, ok: true, latencyMs, ledger: body.result?.sequence ?? null };
  } catch (error) {
    return { ...entry, ok: false, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
  }
}

async function postAlert(webhookUrl, payload) {
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", msg: "rpc_health.alert_failed", error: error instanceof Error ? error.message : String(error) }));
  }
}

async function main() {
  const opts = parseArgs(process.argv);
  const config = JSON.parse(readFileSync(opts.config, "utf8"));
  const timeoutMs = config.thresholds?.timeoutMs ?? 10000;
  const warnLatencyMs = config.thresholds?.warnLatencyMs ?? 2500;
  const maxErrorRate = config.thresholds?.maxErrorRate ?? 0;

  const networkNames = opts.network ? [opts.network] : Object.keys(config.networks ?? {});
  const entries = [];
  for (const network of networkNames) {
    const cfg = config.networks?.[network];
    if (!cfg) throw new Error(`Missing rpc-health config for network ${network}`);
    entries.push(...endpointEntries(network, "horizon", cfg.horizon));
    entries.push(...endpointEntries(network, "rpc", cfg.rpc));
  }

  const results = [];
  for (const entry of entries) {
    const result = entry.kind === "horizon"
      ? await probeHorizon(entry, timeoutMs)
      : await probeRpc(entry, timeoutMs);
    const level = result.ok && result.latencyMs <= warnLatencyMs ? "info" : result.ok ? "warn" : "error";
    const log = { level, msg: "stellar_endpoint_probe", checkedAt: new Date().toISOString(), ...result };
    console.log(JSON.stringify(log));
    results.push(result);
  }

  const failures = results.filter((r) => !r.ok);
  const errorRate = results.length === 0 ? 1 : failures.length / results.length;
  const summary = {
    msg: "stellar_endpoint_probe_summary",
    checkedAt: new Date().toISOString(),
    total: results.length,
    failures: failures.length,
    errorRate,
    maxErrorRate,
  };
  console.log(JSON.stringify({ level: failures.length ? "error" : "info", ...summary }));

  if (errorRate > maxErrorRate) {
    await postAlert(opts.alertWebhook, { ...summary, failures });
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ level: "error", msg: "stellar_endpoint_probe_crashed", error: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
