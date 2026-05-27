# ZK Public Signal Layout (single source of truth)

This document is the **canonical reference** for the ordering of Groth16 public
signals across the circuits, the on-chain verifiers, and the frontend prover.
Any change to a circuit's public signals **must** be reflected here and in all
three consumers below.

## How snarkjs orders public signals

For a circom `component main`, snarkjs emits `publicSignals` as:

```
[ <circuit outputs, in declaration order>, <public inputs, in declaration order> ]
```

Getting this order wrong means valid proofs are rejected (or, worse, a proof is
verified against the wrong public inputs), so the order below is authoritative.

## V1 — `circuits/stealth_attestation.circom`

Outputs (declaration order): `nullifier`, `is_valid`
Public inputs (`component main {public [...]}`): `merkle_root`, `attestation_id`, `external_nullifier`

Therefore the **5** public signals are, in order:

| index | signal              | source        |
|-------|---------------------|---------------|
| 0     | `nullifier`         | output        |
| 1     | `is_valid`          | output        |
| 2     | `merkle_root`       | public input  |
| 3     | `attestation_id`    | public input  |
| 4     | `external_nullifier`| public input  |

`is_valid` is bound to `1` on-chain: the reputation verifier only accepts proofs
asserting a valid attestation, so a proof with `is_valid = 0` fails verification.

Consumers (must match exactly):
- Circuit: `circuits/stealth_attestation.circom` (`component main`).
- Contract: `contracts/reputation-verifier/src/lib.rs` → `verify_reputation` builds
  `pub_signals` in this order before calling `groth16-verifier::verify_proof`.
- Frontend: `frontend/src/lib/reputationProver.ts` reads `publicSignals[0]` =
  `nullifier`, `publicSignals[1]` = `is_valid`, `publicSignals[3]` = `attestation_id`.

## V2 — `circuits/v2/stealth_reputation.circom`

No circuit outputs. Public inputs (`component main {public [...]}`):
`merkle_root`, `attestation_id`, `external_nullifier`, `nullifier_hash`.

Therefore the **4** public signals are, in order:

| index | signal              |
|-------|---------------------|
| 0     | `merkle_root`       |
| 1     | `attestation_id`    |
| 2     | `external_nullifier`|
| 3     | `nullifier_hash`    |

Consumers (must match exactly):
- Circuit: `circuits/v2/stealth_reputation.circom` (`component main`).
- Contract: `contracts/groth16-verifier/src/lib.rs` → `verify_proof_v2` consumes
  `VerifyPublicInputsV2 { merkle_root, attestation_id, external_nullifier, nullifier_hash }`
  in this exact order.

## G1/G2 byte encoding (for VK constants and proof points)

Field elements are 32-byte big-endian. `G1 = x || y` (64 bytes). `G2 =
x_c1 || x_c0 || y_c1 || y_c0` (128 bytes, imaginary coefficient first, EIP-197).
This matches the frontend proof serialization in `reputationProver.ts` and the
verification-key constants in `contracts/groth16-verifier/src/lib.rs` (generated
by `contracts/groth16-verifier/scripts/encode_vk.mjs`).
