import { describe, expect, it } from "vitest";
import { validateAppConfig, buildConfigFromEnv } from "../configValidation";

const VALID_CONTRACT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const VALID_CONTRACTS = {
  stealthRegistry: VALID_CONTRACT,
  stealthAnnouncer: VALID_CONTRACT,
  groth16Verifier: VALID_CONTRACT,
  reputationVerifier: VALID_CONTRACT,
  schemaRegistry: VALID_CONTRACT,
  attestationEngineV2: VALID_CONTRACT,
};

describe("validateAppConfig — dev networks", () => {
  it("accepts a valid testnet config", () => {
    const result = validateAppConfig({
      network: "testnet",
      rpcUrl: "https://soroban-testnet.stellar.org",
      horizonUrl: "https://horizon-testnet.stellar.org",
      contracts: VALID_CONTRACTS,
    });
    expect(result.valid).toBe(true);
  });

  it("accepts http RPC on local network", () => {
    const result = validateAppConfig({
      network: "local",
      rpcUrl: "http://localhost:8000/soroban/rpc",
      horizonUrl: "http://localhost:8000",
      contracts: VALID_CONTRACTS,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects an invalid contract ID", () => {
    const result = validateAppConfig({
      network: "testnet",
      rpcUrl: "https://soroban-testnet.stellar.org",
      horizonUrl: "https://horizon-testnet.stellar.org",
      contracts: { ...VALID_CONTRACTS, groth16Verifier: "not-a-contract-id" },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes("groth16Verifier"))).toBe(true);
    }
  });

  it("rejects missing rpcUrl", () => {
    const result = validateAppConfig({
      network: "testnet",
      horizonUrl: "https://horizon-testnet.stellar.org",
      contracts: VALID_CONTRACTS,
    });
    expect(result.valid).toBe(false);
  });

  it("rejects unknown network", () => {
    const result = validateAppConfig({
      network: "devnet",
      rpcUrl: "https://example.com",
      horizonUrl: "https://example.com",
      contracts: VALID_CONTRACTS,
    });
    expect(result.valid).toBe(false);
  });
});

describe("validateAppConfig — mainnet (production strictness)", () => {
  it("accepts a valid mainnet config with HTTPS URLs", () => {
    const result = validateAppConfig({
      network: "mainnet",
      rpcUrl: "https://mainnet.sorobanrpc.com",
      horizonUrl: "https://horizon.stellar.org",
      contracts: VALID_CONTRACTS,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects http RPC on mainnet", () => {
    const result = validateAppConfig({
      network: "mainnet",
      rpcUrl: "http://mainnet.sorobanrpc.com",
      horizonUrl: "https://horizon.stellar.org",
      contracts: VALID_CONTRACTS,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes("rpcUrl"))).toBe(true);
    }
  });

  it("rejects localhost RPC on mainnet", () => {
    const result = validateAppConfig({
      network: "mainnet",
      rpcUrl: "https://localhost:8000",
      horizonUrl: "https://horizon.stellar.org",
      contracts: VALID_CONTRACTS,
    });
    expect(result.valid).toBe(false);
  });

  it("surfaces all missing contract ID errors at once", () => {
    const result = validateAppConfig({
      network: "mainnet",
      rpcUrl: "https://mainnet.sorobanrpc.com",
      horizonUrl: "https://horizon.stellar.org",
      contracts: {
        ...VALID_CONTRACTS,
        groth16Verifier: "bad",
        reputationVerifier: "bad",
      },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("buildConfigFromEnv", () => {
  it("builds a valid testnet config from env", () => {
    const raw = buildConfigFromEnv({
      VITE_STELLAR_NETWORK: "testnet",
      VITE_STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
      VITE_STELLAR_HORIZON_URL: "https://horizon-testnet.stellar.org",
      VITE_STEALTH_REGISTRY_CONTRACT: VALID_CONTRACT,
      VITE_STEALTH_ANNOUNCER_CONTRACT: VALID_CONTRACT,
      VITE_GROTH16_VERIFIER_CONTRACT: VALID_CONTRACT,
      VITE_REPUTATION_VERIFIER_CONTRACT: VALID_CONTRACT,
      VITE_SCHEMA_REGISTRY_CONTRACT: VALID_CONTRACT,
      VITE_ATTESTATION_ENGINE_CONTRACT: VALID_CONTRACT,
    });
    const result = validateAppConfig(raw);
    expect(result.valid).toBe(true);
  });

  it("defaults network to testnet when VITE_STELLAR_NETWORK is unset", () => {
    const raw = buildConfigFromEnv({}) as Record<string, unknown>;
    expect(raw["network"]).toBe("testnet");
  });

  it("produces invalid config when env vars are empty — renders a clear fatal config error", () => {
    const raw = buildConfigFromEnv({
      VITE_STELLAR_NETWORK: "mainnet",
    });
    const result = validateAppConfig(raw);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});
