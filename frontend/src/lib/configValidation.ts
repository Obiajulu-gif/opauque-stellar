import { z } from "zod";

const stellarContractIdRegex = /^C[A-Z2-7]{55}$/;
const httpUrlRegex = /^https?:\/\/.+/;
const httpsUrlRegex = /^https:\/\/.+/;

const contractIdSchema = z
  .string()
  .regex(stellarContractIdRegex, "Must be a valid Stellar contract ID (C-strkey)");

const devRpcUrlSchema = z.string().regex(httpUrlRegex, "Must be a valid HTTP/HTTPS URL");
const prodRpcUrlSchema = z.string().regex(httpsUrlRegex, "Must be a valid HTTPS URL");

const contractIdsSchema = z.object({
  stealthRegistry: contractIdSchema,
  stealthAnnouncer: contractIdSchema,
  groth16Verifier: contractIdSchema,
  reputationVerifier: contractIdSchema,
  schemaRegistry: contractIdSchema,
  attestationEngineV2: contractIdSchema,
});

const featureFlagsSchema = z.object({
  enableMainnet: z.boolean().default(false),
  enableScanner: z.boolean().default(false),
  enableGovernance: z.boolean().default(false),
});

const artifactHashesSchema = z.record(z.string(), z.string().regex(/^[0-9a-f]{64}$/, "Must be a 64-char hex SHA-256 hash")).optional();

const devConfigSchema = z.object({
  network: z.enum(["testnet", "futurenet", "local"]),
  rpcUrl: devRpcUrlSchema,
  horizonUrl: devRpcUrlSchema,
  contracts: contractIdsSchema,
  featureFlags: featureFlagsSchema.optional(),
  artifactHashes: artifactHashesSchema,
});

const prodConfigSchema = z.object({
  network: z.literal("mainnet"),
  rpcUrl: prodRpcUrlSchema.refine(
    (url) => !url.includes("localhost") && !url.includes("127.0.0.1"),
    "Production RPC URL must not point to localhost",
  ),
  horizonUrl: prodRpcUrlSchema.refine(
    (url) => !url.includes("localhost") && !url.includes("127.0.0.1"),
    "Production Horizon URL must not point to localhost",
  ),
  contracts: contractIdsSchema,
  featureFlags: featureFlagsSchema.optional(),
  artifactHashes: artifactHashesSchema,
});

export const appConfigSchema = z.discriminatedUnion("network", [
  devConfigSchema,
  prodConfigSchema,
]);

export type AppConfig = z.infer<typeof appConfigSchema>;
export type ContractIds = z.infer<typeof contractIdsSchema>;
export type FeatureFlags = z.infer<typeof featureFlagsSchema>;

export type ConfigValidationResult =
  | { valid: true; config: AppConfig }
  | { valid: false; errors: string[] };

export function validateAppConfig(raw: unknown): ConfigValidationResult {
  const result = appConfigSchema.safeParse(raw);
  if (result.success) {
    return { valid: true, config: result.data };
  }
  const issues = result.error.issues ?? (result.error as unknown as { errors: typeof result.error.issues }).errors ?? [];
  const errors = issues.map(
    (e) => `${e.path.join(".")}: ${e.message}`,
  );
  return { valid: false, errors };
}

export function buildConfigFromEnv(env: Record<string, string | undefined>): unknown {
  const network = env["VITE_STELLAR_NETWORK"] ?? "testnet";
  return {
    network,
    rpcUrl: env["VITE_STELLAR_RPC_URL"] ?? "",
    horizonUrl: env["VITE_STELLAR_HORIZON_URL"] ?? "",
    contracts: {
      stealthRegistry: env["VITE_STEALTH_REGISTRY_CONTRACT"] ?? "",
      stealthAnnouncer: env["VITE_STEALTH_ANNOUNCER_CONTRACT"] ?? "",
      groth16Verifier: env["VITE_GROTH16_VERIFIER_CONTRACT"] ?? "",
      reputationVerifier: env["VITE_REPUTATION_VERIFIER_CONTRACT"] ?? "",
      schemaRegistry: env["VITE_SCHEMA_REGISTRY_CONTRACT"] ?? "",
      attestationEngineV2: env["VITE_ATTESTATION_ENGINE_CONTRACT"] ?? "",
    },
    featureFlags: {
      enableMainnet: env["VITE_ENABLE_MAINNET"] === "true",
      enableScanner: env["VITE_ENABLE_SCANNER"] === "true",
      enableGovernance: env["VITE_ENABLE_GOVERNANCE"] === "true",
    },
  };
}
