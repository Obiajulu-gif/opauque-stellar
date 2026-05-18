/**
 * Stealth Attestation — Reputation types and trait definitions.
 *
 * Traits are discovered by the Rust WASM scanner from announcement metadata.
 * Each trait maps to an on-chain attestation_id. The UI displays them as
 * "Verified Traits" and lets the user generate ZK proofs for selective disclosure.
 */

import { z } from "zod";

// =============================================================================
// Trait catalogue — known attestation IDs and their display metadata
// =============================================================================

export interface TraitDefinition {
  id: string;
  attestationId: number;
  label: string;
  description: string;
  icon: string;
  category: "developer" | "trader" | "community" | "custom";
}

export const KNOWN_TRAITS: TraitDefinition[] = [
  {
    id: "high-volume",
    attestationId: 2,
    label: "High Volume Trader",
    description: "Total stealth volume exceeds 5 SOL",
    icon: "trending-up",
    category: "trader",
  },
  {
    id: "early-adopter",
    attestationId: 3,
    label: "Early Adopter",
    description: "Registered stealth meta-address before block 1,000,000",
    icon: "zap",
    category: "community",
  },
  {
    id: "privacy-advocate",
    attestationId: 4,
    label: "Privacy Advocate",
    description: "Completed 10+ stealth transactions",
    icon: "shield",
    category: "community",
  },
  {
    id: "defi-user",
    attestationId: 5,
    label: "DeFi Power User",
    description: "Interacted with 5+ DeFi protocols via stealth addresses",
    icon: "layers",
    category: "trader",
  },
];

export function getTraitById(id: string): TraitDefinition | undefined {
  return KNOWN_TRAITS.find((t) => t.id === id);
}

export function getTraitByAttestationId(attestationId: number): TraitDefinition | undefined {
  return KNOWN_TRAITS.find((t) => t.attestationId === attestationId);
}

// =============================================================================
// Discovered trait (from scanner)
// =============================================================================

export interface DiscoveredTrait {
  traitDef: TraitDefinition;
  attestationId: number;
  stealthAddress: string;
  txHash: string;
  blockNumber: number;
  discoveredAt: number;
  /** Compressed secp256k1 ephemeral pubkey bytes from the announcement. */
  ephemeralPubkey?: number[];
}

// =============================================================================
// Proof generation state
// =============================================================================

export type ProofStage =
  | "idle"
  | "preparing-witness"
  | "generating-proof"
  | "proof-ready"
  | "submitting"
  | "verified"
  | "error";

export interface ProofState {
  stage: ProofStage;
  progress: number;
  traitId: string | null;
  error: string | null;
  proof: ProofData | null;
}

export interface ProofData {
  proof: {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
  };
  publicSignals: string[];
  nullifier: string;
  attestationId: number;
}

// =============================================================================
// Attestation metadata Zod schema (validates data from WASM scanner)
// =============================================================================

export const StealthAttestationSchema = z.object({
  stealth_address: z.string(),
  attestation_id: z.number().int().positive(),
  tx_hash: z.string(),
  block_number: z.number().int().nonnegative(),
  ephemeral_pubkey: z.array(z.number().int().min(0).max(255)),
});

export const StealthAttestationArraySchema = z.array(StealthAttestationSchema);

export type StealthAttestationData = z.infer<typeof StealthAttestationSchema>;
