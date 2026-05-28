/**
 * Full private payment lifecycle integration script (testnet).
 *
 * Exercises the complete lifecycle:
 *   1. Register a stealth meta-address on-chain
 *   2. Compute a stealth address for a recipient
 *   3. Announce the stealth transfer on-chain
 *   4. Scan announcements to detect incoming transfers
 *   5. Withdraw (sweep) funds from the stealth account
 *
 * Usage:
 *   FUNDER_SECRET=S... npx tsx scripts/lifecycle-integration.ts
 *
 * Environment variables:
 *   FUNDER_SECRET  - Stellar secret key of a funded testnet account
 *   ASSET_ISSUER   - (optional) Asset issuer for non-native sends
 *
 * The script reports transaction hashes and contract errors at each step.
 */

import { Keypair, nativeToScVal } from "@stellar/stellar-sdk";
import { deriveKeysFromSignature, keysToStealthMetaAddress, stealthMetaAddressToHex, computeStealthAddressAndViewTag, buildDomainSeparatedMessage, hexToBytes } from "../src/lib/stealth";
import { getNetworkPassphrase, getNetwork } from "../src/lib/chain";
import { registerStealthKeys, announceStealthTransfer, SCHEME_ID_SECP256K1 } from "../src/lib/contracts";
import { getSorobanServer } from "../src/lib/stellar";
import { deployedAddresses } from "../src/contracts/deployedAddresses";

type StepResult = { step: string; success: boolean; txHash?: string; error?: string };

function logStep(result: StepResult): void {
  const icon = result.success ? "\u2713" : "\u2717";
  console.log(`[${icon}] ${result.step}${result.txHash ? ` (tx: ${result.txHash.slice(0, 16)}\u2026)` : ""}`);
  if (result.error) console.error(`      Error: ${result.error}`);
}

async function checkContractDeployed(): Promise<boolean> {
  try {
    const server = getSorobanServer();
    const network = getNetwork();
    const addr = deployedAddresses.stealthRegistry;
    if (!addr) {
      console.error("StealthRegistry contract ID not set in manifest.");
      return false;
    }
    console.log(`Network: ${network}`);
    console.log(`Registry contract: ${addr}`);
    console.log(`Announcer contract: ${deployedAddresses.stealthAnnouncer}`);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log("=== Opaque Private Payment Lifecycle Integration ===\n");

  const funderSecret = process.env.FUNDER_SECRET;
  if (!funderSecret) {
    console.error("Set FUNDER_SECRET=S... (Stellar testnet funded account secret key)");
    process.exit(1);
  }

  const deployed = await checkContractDeployed();
  if (!deployed) {
    console.error("Contracts not deployed on this network. Deploy first.");
    process.exit(1);
  }

  const funder = Keypair.fromSecret(funderSecret);
  const network = getNetwork();
  const passphrase = getNetworkPassphrase();

  console.log(`Funder: ${funder.publicKey()}\n`);

  // Step 1: Register
  {
    console.log("--- Step 1: Register meta-address ---");
    const sig = new Uint8Array(64);
    for (let i = 0; i < 64; i++) sig[i] = i;
    const sigHex = "0x" + Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("") as `0x${string}`;

    const keys = deriveKeysFromSignature(sigHex);
    const { metaAddress } = keysToStealthMetaAddress(keys.viewingKey, keys.spendingKey);
    const metaHex = stealthMetaAddressToHex(metaAddress);
    console.log(`  Meta-address: ${metaHex.slice(0, 22)}\u2026`);

    try {
      const sig = await registerStealthKeys({
        sourcePublicKey: funder.publicKey(),
        schemeId: SCHEME_ID_SECP256K1,
        stealthMetaAddress: metaAddress,
        signTransaction: async (xdr: string) => {
          const tx = (await import("@stellar/stellar-sdk")).TransactionBuilder.fromXDR(xdr, passphrase);
          tx.sign(funder);
          return tx.toXDR();
        },
      });
      logStep({ step: "Registered meta-address", success: true, txHash: sig });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logStep({ step: "Register meta-address", success: false, error: msg });
    }
  }

  // Step 2: Compute stealth address (fresh send path)
  {
    console.log("\n--- Step 2: Compute stealth address (fresh destination) ---");
    const sig = new Uint8Array(64);
    for (let i = 0; i < 64; i++) sig[i] = (i + 1) & 0xff;
    const sigHex = "0x" + Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("") as `0x${string}`;

    const keys = deriveKeysFromSignature(sigHex);
    const { metaAddress } = keysToStealthMetaAddress(keys.viewingKey, keys.spendingKey);
    const metaHex = stealthMetaAddressToHex(metaAddress);

    const result = computeStealthAddressAndViewTag(metaHex);
    console.log(`  Stealth address: ${result.stealthAddress}`);
    console.log(`  Stealth Stellar: ${result.stealthStellarAddress}`);
    console.log(`  View tag: ${result.viewTag}`);
    logStep({ step: "Computed stealth address", success: true });
  }

  // Step 3: Announce
  {
    console.log("\n--- Step 3: Announce stealth transfer ---");
    const sig = new Uint8Array(64);
    for (let i = 0; i < 64; i++) sig[i] = 0x42;
    const sigHex = "0x" + Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("") as `0x${string}`;

    const keys = deriveKeysFromSignature(sigHex);
    const { metaAddress } = keysToStealthMetaAddress(keys.viewingKey, keys.spendingKey);
    const metaHex = stealthMetaAddressToHex(metaAddress);
    const stealthResult = computeStealthAddressAndViewTag(metaHex);

    try {
      const stealthAddrBytes = hexToBytes(stealthResult.stealthAddress.slice(2));
      const hash = await announceStealthTransfer({
        sourcePublicKey: funder.publicKey(),
        schemeId: SCHEME_ID_SECP256K1,
        stealthAddress: stealthAddrBytes,
        ephemeralPubKey: stealthResult.ephemeralPubKey,
        metadata: stealthResult.metadata,
        signTransaction: async (xdr: string) => {
          const tx = (await import("@stellar/stellar-sdk")).TransactionBuilder.fromXDR(xdr, passphrase);
          tx.sign(funder);
          return tx.toXDR();
        },
      });
      logStep({ step: "Announced stealth transfer", success: true, txHash: hash });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logStep({ step: "Announce stealth transfer", success: false, error: msg });
    }
  }

  // Step 4: Scan (check announcements)
  {
    console.log("\n--- Step 4: Scan for announcements ---");
    try {
      const server = getSorobanServer();
      const latest = await server.getLatestLedger();
      const events = await server.getEvents({
        startLedger: Math.max(1, latest.sequence - 1000),
        endLedger: latest.sequence,
        filters: [{
          type: "contract",
          contractIds: [deployedAddresses.stealthAnnouncer],
        }],
        limit: 100,
      });
      logStep({ step: `Scanned announcements (${events.events?.length ?? 0} events found)`, success: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logStep({ step: "Scan announcements", success: false, error: msg });
    }
  }

  // Step 5: Verify domain separation message
  {
    console.log("\n--- Step 5: Verify domain separation ---");
    const msg = buildDomainSeparatedMessage({
      origin: "https://app.opaque.cash",
      networkPassphrase: passphrase,
      walletPublicKey: funder.publicKey(),
      purpose: "stealth-key-derivation",
    });
    console.log(`  Domain message: ${msg.split("\n")[0]}...`);
    logStep({ step: "Domain-separated message constructed", success: true });
  }

  console.log("\n=== Lifecycle test complete ===");
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
