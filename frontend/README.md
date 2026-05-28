# Frontend — Opaque Wallet UI

Reference wallet for the Opaque protocol on **Stellar**. Built with React, TypeScript, Vite, and Tailwind CSS. Connects via **Freighter**, invokes **Soroban** contracts, and runs stealth cryptography plus ZK proof generation entirely in the browser.

## Features

| View | Description |
|:-----|:------------|
| **Landing / Setup** | Freighter connection and stealth key derivation (HKDF from wallet signature) |
| **Registration** | Register stealth meta-address on the Soroban registry |
| **Dashboard** | Balance overview and navigation |
| **Send** | Derive one-time stealth address, pay XLM, announce on-chain |
| **Receive** | Share meta-address (QR / copy) or ghost addresses |
| **Private Balance** | WASM scanner for announcements; sweep to main account |
| **Reputation** | Traits, attestations, Groth16 proofs, on-chain verification |
| **Schema Studio** | Register attestation schemas |

## Tech stack

- **React 19** + **TypeScript** + **Vite 7**
- **Tailwind CSS 4**
- **@stellar/stellar-sdk** + **@stellar/freighter-api**
- **@noble/curves** / **@noble/hashes** — DKSAP (secp256k1)
- **snarkjs** + **circomlibjs** — Groth16 / Poseidon
- **WASM scanner** — Rust `scanner/` crate via `wasm-pack`

## Getting started

### Prerequisites

- Node.js 18+
- [Freighter](https://www.freighter.app/) on Stellar testnet

### Install & run

```bash
npm install
cp .env.example .env
# Set VITE_STELLAR_NETWORK; contract IDs: ../deployments/v1/testnet.json
npm run dev
```

App: `http://localhost:5173`

### Environment

See `.env.example` and [`../deployments/README.md`](../deployments/README.md).

- `VITE_STELLAR_NETWORK` — `testnet` | `mainnet` | `futurenet` | `local`
- Canonical Soroban IDs — [`../deployments/v1/testnet.json`](../deployments/v1/testnet.json) / [`mainnet.json`](../deployments/v1/mainnet.json)
- `VITE_<NETWORK>_*_CONTRACT` — optional local overrides (non-production only)

### Production build

```bash
npm run build
npm run preview
```

## Project structure

```
src/
├── components/       # UI views and modals
├── context/          # Keys, wallet (Stellar), toasts
├── contracts/        # Contract IDs and config
├── hooks/            # useWallet, useScanner, useOpaqueWasm
├── lib/              # stealth, stellar, programs, registry, explorer
├── store/            # Zustand stores
└── public/pkg/       # WASM scanner build output
```

## Key flows

### Stealth send

1. Recipient meta-address or registered Stellar account (G…).
2. DKSAP derives stealth secp256k1 point → Stellar Ed25519 account.
3. XLM payment via Horizon + `stealth-announcer` contract call.

### Private balance

1. Soroban / RPC events for announcements.
2. WASM scanner filters by view tag and derives matching stealth keys.
3. Sweep via native XLM payment to the user’s main account.

### ZK reputation

1. Witness from discovered attestation + Merkle path.
2. snarkjs Groth16 proof in-browser.
3. Submit to `groth16-verifier` / `reputation-verifier` on Soroban.
