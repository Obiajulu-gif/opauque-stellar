# Contributing to Opaque (Stellar)

Thanks for contributing. Opaque handles **private payments** and **on-chain ZK
reputation** — correctness and reproducibility are non-negotiable. This guide
describes the exact bar every change must clear. CI enforces all of it; running
the same checks locally before you push will keep your PR green.

> **Golden rule:** no change may break `main`. Every commit on `main` must build,
> pass all tests, lint clean, and keep the deployment manifests verifiable.

---

## 1. Project layout

| Path | What it is | Toolchain |
|:-----|:-----------|:----------|
| `contracts/` | Soroban smart contracts (Cargo workspace, 7 crates) | Rust + Stellar CLI |
| `scanner/` | DKSAP scanner compiled to WASM | Rust + wasm-pack |
| `circuits/` | Circom Groth16 circuits + regression fixtures | Node + circom + snarkjs |
| `frontend/` | React/TypeScript wallet UI | Node + Vite |
| `scripts/` | TypeScript tooling (deploy, verify, artifacts) — run via `tsx` |
| `deployments/` | Canonical contract manifests (source of truth) | JSON |

---

## 2. Prerequisites

- [Rust](https://rustup.rs/) (stable) with both WASM targets:
  ```bash
  rustup target add wasm32-unknown-unknown wasm32v1-none
  rustup component add rustfmt clippy
  ```
- [Stellar CLI](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup)
- [Node.js](https://nodejs.org/) 20+
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/)
- `cargo-audit` and `cargo-deny` for supply-chain checks:
  ```bash
  cargo install cargo-audit cargo-deny --locked
  ```

---

## 3. Branching & commits

- Branch from `main`: `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`,
  `chore/<short-name>`, or `ci/<short-name>`.
- Use [Conventional Commits](https://www.conventionalcommits.org/):
  `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`.
- Keep PRs focused and small. One logical change per PR.
- **Never** commit secrets, raw seeds (`S...`), `.env` files, or large build
  artifacts (zkeys, WASM blobs, `target/`). These are gitignored — keep it that way.

---

## 4. The required checks (must pass before pushing)

These mirror `.github/workflows/ci.yml` exactly. Run them locally:

### 4a. Contracts (Rust workspace)

```bash
cargo fmt --all -- --check          # formatting
cargo clippy --workspace --all-targets -- -D warnings   # zero warnings
cargo test --workspace --locked     # all unit + property tests
stellar contract build              # release WASM builds
```

- **Warnings are errors.** Clippy runs with `-D warnings`; do not introduce new ones.
- If you must silence a lint, do it narrowly (`#[allow(...)]` on the item) with a
  comment explaining why — never broaden it to the crate unless the macro expansion
  genuinely forces it (e.g. `#[contractimpl]` argument counts).
- **Do not delete or weaken a test to make CI pass.** If a test encodes an
  expectation that no longer matches intended behavior, either fix the code or
  mark the test `#[ignore = "<reason + tracking note>"]` and call it out in the PR
  description. Ignored tests are visible in CI output and must be justified.

### 4b. Scanner (WASM)

```bash
npm run build:scanner
npx tsx scripts/verify-artifact-manifest.ts --scanner --strict
```

The scanner WASM hash is pinned in `artifacts/manifest.json`. If you change scanner
code, rebuild and update the manifest in the **same** PR.

### 4c. Circuits

```bash
npm run test:circuits     # deterministic regression fixtures
```

Circuit logic changes require regenerating fixtures and updating the artifact
manifest + VK binding. Large artifacts are fetched from releases, never committed.

### 4d. Frontend

```bash
cd frontend
npm ci
npm run lint              # ESLint, zero errors
npx tsc -b --noEmit       # typecheck
npm run build             # production build
npx vitest run            # unit tests
```

### 4e. Supply chain & manifests

```bash
npm run verify:deployment           # manifest schema + no legacy Solana/devnet refs
cargo audit
cargo deny check
```

---

## 5. Changing contracts

- The Soroban event ABI (topics + versions) is consumed by the scanner. **Do not
  change event shapes** without updating the scanner and bumping the event version.
- Storage key derivation is consensus-critical — changing it is a breaking change
  and requires a redeploy + manifest update.
- After any contract change that affects bytecode, rebuild and update the WASM
  hashes in the relevant `deployments/v1/<network>.json` manifest.

---

## 6. Deploying (maintainers)

Deployment is a single command driven entirely by the root `.env`:

```bash
cp .env.example .env                # set STELLAR_NETWORK + STELLAR_DEPLOYER
npm run deploy:testnet              # build + deploy + update manifest
npm run deploy:testnet -- --dry-run # preview (no broadcast)
```

- **Mainnet requires audit signoff.** `npm run deploy:mainnet` runs the
  `verify-security-audit` gate; do not bypass it with `--force` for real deploys.
- Always commit the updated manifest, then verify:
  ```bash
  npx tsx scripts/verify-deployment-manifest.ts --network <net> --strict --check-wasm
  ```

---

## 7. Pull request checklist

Before requesting review, confirm:

- [ ] All Section 4 checks pass locally.
- [ ] No secrets, `.env`, or build artifacts added.
- [ ] Tests added/updated for new behavior (no deleted/weakened tests without justification).
- [ ] Manifests/artifact hashes updated if contracts/scanner/circuits changed.
- [ ] Conventional-commit messages; PR description explains the "why".
- [ ] Docs/README updated if behavior or commands changed.

CI must be fully green (the `CI success gate` job) before merge. Squash-merge to
keep `main` history linear.

---

## 8. Security

Do **not** open public issues for vulnerabilities. Follow the disclosure process in
[`SECURITY.md`](SECURITY.md). See [`DISCLAIMER.md`](DISCLAIMER.md) for the experimental
status and privacy limitations of this software.
