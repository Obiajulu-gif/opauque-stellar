# Proposed commit history (50 commits)

## 26. Contract ABIs and deployment config

```bash
git add frontend/src/contracts/abis/ frontend/src/contracts/config.ts frontend/src/contracts/contract-config.ts frontend/src/contracts/deployedAddresses.ts frontend/src/contracts/deployed-addresses.json frontend/src/contracts/reputationAddresses.ts frontend/src/contracts/reputation-addresses.json frontend/src/lib/contracts.ts frontend/src/lib/programs.ts
git commit -m "$(cat <<'EOF'
feat(frontend): wire Soroban contract ABIs and deployed IDs

Load contract interfaces and env-driven addresses for registry, announcer, and reputation stack.
EOF
)"
```

---

## 27. WASM scanner bindings

```bash
git add frontend/src/hooks/useOpaqueWasm.ts frontend/src/hooks/useScanner.ts frontend/src/wasm.d.ts frontend/src/types/circomlibjs.d.ts frontend/src/wasm/ frontend/public/pkg/
git commit -m "$(cat <<'EOF'
feat(frontend): integrate scanner WASM module

Load cryptography WASM for view-tag filtering and stealth key recovery in the browser.
EOF
)"
```

---

## 28. Landing and marketing routes

```bash
git add frontend/src/components/LandingView.tsx frontend/src/components/LandingPage.tsx frontend/src/components/BrandingPage.tsx frontend/src/assets/
git commit -m "$(cat <<'EOF'
feat(frontend): add landing and branding pages

Public marketing shell explaining private payments and provable reputation on Stellar.
EOF
)"
```

---

## 29. App layout, routing, and legal shell

```bash
git add frontend/src/components/Layout.tsx frontend/src/components/Footer.tsx frontend/src/components/LegalPageLayout.tsx frontend/src/components/NotFoundPage.tsx frontend/src/App.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): add routed app layout and 404 handling

Tabbed wallet chrome with react-router routes for /app and static legal pages.
EOF
)"
```

---

## 30. Registration wizard and protocol stepper

```bash
git add frontend/src/components/RegistrationWizard.tsx frontend/src/components/RegistrationView.tsx frontend/src/components/ProtocolStepper.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): add meta-address registration wizard

Guide users through publishing stealth meta-addresses to the on-chain registry after wallet setup.
EOF
)"
```

---

## 31. Send flow

```bash
git add frontend/src/components/SendView.tsx frontend/src/components/AddressDisplay.tsx frontend/src/components/ExplorerLink.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): add stealth send view

Construct ephemeral payments to derived stealth Stellar accounts with explorer links.
EOF
)"
```

---

## 32. Receive flow and QR

```bash
git add frontend/src/components/ReceiveView.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): add receive view with meta-address display

Show registrant meta-address and payment instructions for unlinkable inbound XLM.
EOF
)"
```

---

## 33. Ghost address stores and sweep UI

```bash
git add frontend/src/store/ghostAddressStore.ts frontend/src/store/ghostAnnouncementStore.ts frontend/src/components/GhostAnnounceModal.tsx frontend/src/components/PrivateBalanceView.tsx frontend/src/components/ClaimModal.tsx frontend/src/lib/opaqueCache.ts frontend/src/lib/legacyTxShim.ts frontend/src/lib/legacyWalletCompat.ts frontend/src/lib/syncErrorUtils.ts
git commit -m "$(cat <<'EOF'
feat(frontend): add ghost address scanning and sweep UI

Persist discovered stealth accounts, announce/sweep flows, and private balance aggregation.
EOF
)"
```

---

## 34. Transaction history

```bash
git add frontend/src/store/txHistoryStore.ts frontend/src/components/TransactionHistoryView.tsx frontend/src/store/vaultStore.ts
git commit -m "$(cat <<'EOF'
feat(frontend): add transaction history and vault store

Track sent/received stealth payments locally with vault state for the dashboard.
EOF
)"
```

---

## 35. Dashboard and profile

```bash
git add frontend/src/components/DashboardView.tsx frontend/src/components/ProfileView.tsx frontend/src/components/ManageView.tsx frontend/src/components/TestnetBanner.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): add dashboard, profile, and manage tabs

Primary wallet home with balances, registration status, and account management actions.
EOF
)"
```

---

## 36. Reputation libraries and ZK prover

```bash
git add frontend/src/lib/reputation.ts frontend/src/lib/reputationProver.ts frontend/src/lib/attestationV2.ts frontend/src/lib/schema.ts
git commit -m "$(cat <<'EOF'
feat(frontend): add reputation and Groth16 proving helpers

Client-side schema parsing, attestation reads, and snarkjs proof generation for PSR.
EOF
)"
```

---

## 37. Reputation Zustand stores

```bash
git add frontend/src/store/reputationStore.ts frontend/src/store/schemaStore.ts
git commit -m "$(cat <<'EOF'
feat(frontend): add reputation and schema client stores

Cache issuer schemas, holder traits, and proof state across reputation views.
EOF
)"
```

---

## 38. Schema studio

```bash
git add frontend/src/components/SchemaStudio.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): add schema studio for issuers

UI to register and inspect programmable attestation schemas on Soroban.
EOF
)"
```

---

## 39. Attestation manager and issue-trait modal

```bash
git add frontend/src/components/AttestationManager.tsx frontend/src/components/IssueTraitModal.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): add attestation manager for issuers

Issue and revoke stealth-bound credentials via attestation-engine-v2.
EOF
)"
```

---

## 40. Holder reputation views and proof modals

```bash
git add frontend/src/components/ReputationDashboardView.tsx frontend/src/components/MyTraitsView.tsx frontend/src/components/ProveTraitModal.tsx frontend/src/components/ProofGeneratorModal.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): add holder reputation dashboard and proof modals

Browse traits, generate Groth16 proofs, and export proof packages for verifiers.
EOF
)"
```

---

## 41. Pay pages and Sub-ENS placeholder

```bash
git add frontend/src/components/PayPage.tsx frontend/src/components/PaySuccessPage.tsx frontend/src/components/SubENSView.tsx frontend/src/lib/ens.ts
git commit -m "$(cat <<'EOF'
feat(frontend): add pay flow and naming helpers

Deep-link payment pages and ENS-style display helpers for stealth recipients.
EOF
)"
```

---

## 42. Legal and policy pages

```bash
git add frontend/src/components/TermsPage.tsx frontend/src/components/PrivacyPage.tsx frontend/src/components/DisclaimerPage.tsx
git commit -m "$(cat <<'EOF'
docs(frontend): add terms, privacy, and disclaimer pages

Static legal content linked from the wallet footer and onboarding.
EOF
)"
```

---

## 43. Protocol log, toast, and onboarding tour

```bash
git add frontend/src/context/ProtocolLogContext.tsx frontend/src/context/ToastContext.tsx frontend/src/components/ProtocolLogPanel.tsx frontend/src/lib/onboardingTour.ts
git commit -m "$(cat <<'EOF'
feat(frontend): add protocol log panel and onboarding tour

Surface Soroban transaction steps to users and guide first-time dashboard usage with driver.js.
EOF
)"
```

---

## 44. Watchlist hook and modal shell

```bash
git add frontend/src/hooks/useWatchlist.ts frontend/src/components/ModalShell.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): add watchlist hook and shared modal shell

Reusable modal chrome and optional address watchlist for send/receive flows.
EOF
)"
```

---

## 45. Frontend environment template and README

```bash
git add frontend/.env.example frontend/README.md
git commit -m "$(cat <<'EOF'
docs(frontend): document env vars and local dev setup

List VITE_STELLAR_* contract IDs and Freighter testnet instructions for contributors.
EOF
)"
```

---

## 46. ZK reputation demo app

```bash
git add demo/
git commit -m "$(cat <<'EOF'
feat(demo): add standalone ZK reputation verifier demo

Minimal Vite app to verify Groth16 proofs and exercise nullifier storage without the full wallet.
EOF
)"
```

---

## 47. Project disclaimer

```bash
git add DISCLAIMER.md
git commit -m "$(cat <<'EOF'
docs: add experimental software disclaimer

Warn users about testnet-only usage and risks before handling real funds.
EOF
)"
```

---

## 48. Root README

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: add project README for Opaque on Stellar

Document DKSAP stealth payments, PSR reputation, repo map, and local build instructions.
EOF
)"
```

---

## 49. Versioned Soroban deploy keypairs (optional)

If `target/deploy/*-keypair.json` exists and you want stable contract IDs across machines:

```bash
git add target/deploy/*-keypair.json
git commit -m "$(cat <<'EOF'
chore: version Soroban deploy keypairs for stable contract IDs

Preserve deterministic testnet contract addresses referenced by the frontend env config.
EOF
)"
```

Skip this commit if you deploy fresh IDs per environment and only use `.env` overrides.

---

## 50. Final integration polish

Any remaining untracked files (e.g. `frontend/src/contracts/abis/MockERC20.json` if not included earlier, stray config). Run `git status` and add leftovers:

```bash
git add -A
git reset HEAD commits.md
git commit -m "$(cat <<'EOF'
chore: integrate remaining frontend assets and ABI stubs

Catch-all for mock token ABI, misc public assets, and any files not covered by prior incremental commits.
EOF
)"
```

**Important:** Always exclude `commits.md` from the final commit:

```bash
git reset HEAD commits.md
```

---

## Usage notes

- **Order matters** — later commits assume earlier contracts, scanner, and libs exist.
- **Commit 49** is optional; many teams keep deploy keypairs out of git and only document IDs in `.env`.
- **Commit 50** is a safety net; prefer folding stray files into commits 18–44 instead of one large catch-all.
- After all 50 commits, `git status` should be clean except for `commits.md` (and anything in `.gitignore`).
