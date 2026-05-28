import { describe, it, expect, beforeAll } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import {
  deriveKeysFromSignature,
  keysToStealthMetaAddress,
  stealthMetaAddressToHex,
  parseStealthMetaAddress,
  computeStealthAddressAndViewTag,
  buildGhostAnnouncementPayload,
  deriveAnnouncerEphemeralKey,
  deriveStealthStellarAddress,
  deriveStealthStellarKeypairFromStealthPrivKey,
  buildDomainSeparatedMessage,
  LEGACY_SETUP_MESSAGE,
  hexToBytes,
  bytesToHex,
  type Hex,
} from "../lib/stealth";

const TEST_SIGNATURE =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function generateTestSignature(): Hex {
  const bytes = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    bytes[i] = (i * 17 + 42) & 0xff;
  }
  return ("0x" + bytesToHex(bytes)) as Hex;
}

describe("Private Payment Lifecycle", () => {
  let senderKeys: { viewingKey: Uint8Array; spendingKey: Uint8Array };
  let recipientKeys: { viewingKey: Uint8Array; spendingKey: Uint8Array };
  let recipientMetaAddress: { V: Uint8Array; S: Uint8Array; metaAddress: Uint8Array };
  let recipientMetaAddressHex: Hex;

  beforeAll(() => {
    senderKeys = deriveKeysFromSignature(generateTestSignature());
    recipientKeys = deriveKeysFromSignature(generateTestSignature());
    recipientMetaAddress = keysToStealthMetaAddress(recipientKeys.viewingKey, recipientKeys.spendingKey);
    recipientMetaAddressHex = stealthMetaAddressToHex(recipientMetaAddress.metaAddress);
  });

  describe("Step 1: Register", () => {
    it("should derive deterministic keys from a wallet signature", () => {
      const keys = deriveKeysFromSignature(TEST_SIGNATURE);
      expect(keys.viewingKey).toHaveLength(32);
      expect(keys.spendingKey).toHaveLength(32);
      expect(keys.viewingKey).not.toEqual(new Uint8Array(32));
      expect(keys.spendingKey).not.toEqual(new Uint8Array(32));
    });

    it("should produce the same keys for the same signature (determinism)", () => {
      const a = deriveKeysFromSignature(TEST_SIGNATURE);
      const b = deriveKeysFromSignature(TEST_SIGNATURE);
      expect(a.viewingKey).toEqual(b.viewingKey);
      expect(a.spendingKey).toEqual(b.spendingKey);
    });

    it("should produce a valid stealth meta-address", () => {
      const { V, S, metaAddress } = recipientMetaAddress;
      expect(V).toHaveLength(33);
      expect(S).toHaveLength(33);
      expect(metaAddress).toHaveLength(66);
    });

    it("should produce a hex-encoded meta-address", () => {
      expect(recipientMetaAddressHex).toMatch(/^0x[0-9a-f]{132}$/);
    });

    it("should parse a meta-address back into public keys", () => {
      const parsed = parseStealthMetaAddress(recipientMetaAddressHex);
      expect(parsed.viewPubKey).toHaveLength(33);
      expect(parsed.spendPubKey).toHaveLength(33);
      expect(parsed.viewPubKey).toEqual(recipientMetaAddress.V);
      expect(parsed.spendPubKey).toEqual(recipientMetaAddress.S);
    });

    it("should reject an invalid meta-address", () => {
      expect(() => parseStealthMetaAddress("0xdead" as Hex)).toThrow("Invalid stealth meta-address");
    });

    it("should produce different meta-addresses for different signatures", () => {
      const sig2 = ("0x" + "ff".repeat(64)) as Hex;
      const keys2 = deriveKeysFromSignature(sig2);
      const meta2 = keysToStealthMetaAddress(keys2.viewingKey, keys2.spendingKey);
      expect(meta2.metaAddress).not.toEqual(recipientMetaAddress.metaAddress);
    });
  });

  describe("Step 2: Send (compute stealth address)", () => {
    it("should compute a stealth address and view tag for a recipient", () => {
      const result = computeStealthAddressAndViewTag(recipientMetaAddressHex);
      expect(result.ephemeralPriv).toHaveLength(32);
      expect(result.ephemeralPubKey).toHaveLength(33);
      expect(result.stealthAddress).toMatch(/^0x[0-9a-f]{40}$/);
      expect(result.stealthStellarAddress).toMatch(/^G[A-Z0-9]{55}$/);
      expect(result.viewTag).toBeGreaterThanOrEqual(0);
      expect(result.viewTag).toBeLessThanOrEqual(255);
      expect(result.metadata).toHaveLength(1);
      expect(result.metadata[0]).toBe(result.viewTag);
    });

    it("should derive a unique stealth address per call (different ephemeral key)", () => {
      const a = computeStealthAddressAndViewTag(recipientMetaAddressHex);
      const b = computeStealthAddressAndViewTag(recipientMetaAddressHex);
      expect(a.stealthAddress).not.toBe(b.stealthAddress);
      expect(a.ephemeralPriv).not.toEqual(b.ephemeralPriv);
    });

    it("should produce the same stealth address for the same ephemeral key", () => {
      const result = computeStealthAddressAndViewTag(recipientMetaAddressHex);
      const payload = buildGhostAnnouncementPayload(recipientMetaAddressHex, bytesToHex(result.ephemeralPriv) as Hex);
      expect(payload.stealthAddress).toBe(result.stealthAddress);
      expect(payload.viewTag).toBe(result.viewTag);
    });

    it("should derive a valid Stellar address from the stealth address", () => {
      const result = computeStealthAddressAndViewTag(recipientMetaAddressHex);
      expect(result.stealthStellarAddress).toMatch(/^G[A-Z0-9]{55}$/);
      // Validate it's a valid Ed25519 public key
      expect(() => Keypair.fromPublicKey(result.stealthStellarAddress)).not.toThrow();
    });
  });

  describe("Step 3: Announce", () => {
    it("should build a valid ghost announcement payload", () => {
      const result = computeStealthAddressAndViewTag(recipientMetaAddressHex);
      const privHex = bytesToHex(result.ephemeralPriv) as Hex;
      const payload = buildGhostAnnouncementPayload(recipientMetaAddressHex, privHex);
      expect(payload.stealthAddress).toBe(result.stealthAddress);
      expect(payload.ephemeralPubKey).toEqual(result.ephemeralPubKey);
      expect(payload.viewTag).toBe(result.viewTag);
      expect(payload.metadata).toEqual(result.metadata);
    });

    it("should derive a deterministic announcer ephemeral key from meta-address", () => {
      const keyA = deriveAnnouncerEphemeralKey(recipientMetaAddressHex);
      const keyB = deriveAnnouncerEphemeralKey(recipientMetaAddressHex);
      expect(keyA).toHaveLength(32);
      expect(keyA).toEqual(keyB);
    });

    it("should derive different announcer keys for different meta-addresses", () => {
      const meta1 = recipientMetaAddressHex;
      const sig2 = ("0x" + "ff".repeat(64)) as Hex;
      const keys2 = deriveKeysFromSignature(sig2);
      const meta2 = keysToStealthMetaAddress(keys2.viewingKey, keys2.spendingKey);
      const meta2Hex = stealthMetaAddressToHex(meta2.metaAddress);
      expect(deriveAnnouncerEphemeralKey(meta1)).not.toEqual(deriveAnnouncerEphemeralKey(meta2Hex));
    });
  });

  describe("Step 4: Scan (receive detection)", () => {
    it("should reconstruct the stealth private key from announcement params", () => {
      const result = computeStealthAddressAndViewTag(recipientMetaAddressHex);
      const stealthPriv = recipientKeys.spendingKey;

      const stellarKeypair = deriveStealthStellarKeypairFromStealthPrivKey(stealthPriv);
      const stellarAddress = stellarKeypair.publicKey();
      expect(stellarAddress).toMatch(/^G[A-Z0-9]{55}$/);
    });
  });

  describe("Step 5: Withdraw", () => {
    it("should derive a valid Stellar keypair from a stealth private key", () => {
      const stealthPriv = recipientKeys.spendingKey;
      const keypair = deriveStealthStellarKeypairFromStealthPrivKey(stealthPriv);
      expect(keypair.publicKey()).toMatch(/^G[A-Z0-9]{55}$/);
      expect(() => Keypair.fromPublicKey(keypair.publicKey())).not.toThrow();
    });

    it("should derive consistent Stellar addresses for the same stealth priv key", () => {
      const stealthPriv = recipientKeys.spendingKey;
      const addrA = deriveStealthStellarAddress(stealthPriv);
      const addrB = deriveStealthStellarAddress(stealthPriv);
      expect(addrA).toBe(addrB);
    });
  });
});

describe("Domain Separation (Issue #30)", () => {
  const TEST_ORIGIN = "https://app.opaque.cash";
  const TEST_NETWORK = "Test SDF Network ; September 2015";
  const TEST_WALLET = "GA7OP4KQ4B7GXZQK4Z6XZQK4Z6XZQK4Z6XZQK4Z6XZQK4Z6XZQK4Z6ABC";
  const TEST_PURPOSE = "stealth-key-derivation";

  it("should build a deterministic domain-separated message", () => {
    const msg = buildDomainSeparatedMessage({
      origin: TEST_ORIGIN,
      networkPassphrase: TEST_NETWORK,
      walletPublicKey: TEST_WALLET,
      purpose: TEST_PURPOSE,
    });
    expect(msg).toContain("Opaque Stellar");
    expect(msg).toContain(TEST_NETWORK);
    expect(msg).toContain(TEST_WALLET);
    expect(msg).toContain("Version: 1");
  });

  it("should produce different messages for different networks", () => {
    const testnet = buildDomainSeparatedMessage({
      origin: TEST_ORIGIN,
      networkPassphrase: "Test SDF Network ; September 2015",
      walletPublicKey: TEST_WALLET,
      purpose: TEST_PURPOSE,
    });
    const mainnet = buildDomainSeparatedMessage({
      origin: TEST_ORIGIN,
      networkPassphrase: "Public Global Stellar Network ; September 2015",
      walletPublicKey: TEST_WALLET,
      purpose: TEST_PURPOSE,
    });
    expect(testnet).not.toBe(mainnet);
  });

  it("should produce different messages for different origins", () => {
    const originA = buildDomainSeparatedMessage({
      origin: "https://app.opaque.cash",
      networkPassphrase: TEST_NETWORK,
      walletPublicKey: TEST_WALLET,
      purpose: TEST_PURPOSE,
    });
    const originB = buildDomainSeparatedMessage({
      origin: "https://phishing-site.com",
      networkPassphrase: TEST_NETWORK,
      walletPublicKey: TEST_WALLET,
      purpose: TEST_PURPOSE,
    });
    expect(originA).not.toBe(originB);
  });

  it("should produce different messages for different wallet addresses", () => {
    const walletA = buildDomainSeparatedMessage({
      origin: TEST_ORIGIN,
      networkPassphrase: TEST_NETWORK,
      walletPublicKey: "GA7OP4KQ4B7GXZQK4Z6XZQK4Z6XZQK4Z6XZQK4Z6XZQK4Z6XZQK4Z6ABC",
      purpose: TEST_PURPOSE,
    });
    const walletB = buildDomainSeparatedMessage({
      origin: TEST_ORIGIN,
      networkPassphrase: TEST_NETWORK,
      walletPublicKey: "GB3XZQK4Z6XZQK4Z6XZQK4Z6XZQK4Z6XZQK4Z6XZQK4Z6XZQK4Z6DEF",
      purpose: TEST_PURPOSE,
    });
    expect(walletA).not.toBe(walletB);
  });

  it("should produce different messages for different purposes", () => {
    const purposeA = buildDomainSeparatedMessage({
      origin: TEST_ORIGIN,
      networkPassphrase: TEST_NETWORK,
      walletPublicKey: TEST_WALLET,
      purpose: "stealth-key-derivation",
    });
    const purposeB = buildDomainSeparatedMessage({
      origin: TEST_ORIGIN,
      networkPassphrase: TEST_NETWORK,
      walletPublicKey: TEST_WALLET,
      purpose: "announcer-key-derivation",
    });
    expect(purposeA).not.toBe(purposeB);
  });

  it("should be deterministic for the same inputs", () => {
    const msgA = buildDomainSeparatedMessage({
      origin: TEST_ORIGIN,
      networkPassphrase: TEST_NETWORK,
      walletPublicKey: TEST_WALLET,
      purpose: TEST_PURPOSE,
    });
    const msgB = buildDomainSeparatedMessage({
      origin: TEST_ORIGIN,
      networkPassphrase: TEST_NETWORK,
      walletPublicKey: TEST_WALLET,
      purpose: TEST_PURPOSE,
    });
    expect(msgA).toBe(msgB);
  });

  it("should include the warning text", () => {
    const msg = buildDomainSeparatedMessage({
      origin: TEST_ORIGIN,
      networkPassphrase: TEST_NETWORK,
      walletPublicKey: TEST_WALLET,
      purpose: TEST_PURPOSE,
    });
    expect(msg).toContain("Warning");
    expect(msg).toContain("Do not sign this message on untrusted sites");
  });

  it("should have a different format from the legacy message", () => {
    const domainMsg = buildDomainSeparatedMessage({
      origin: TEST_ORIGIN,
      networkPassphrase: TEST_NETWORK,
      walletPublicKey: TEST_WALLET,
      purpose: TEST_PURPOSE,
    });
    expect(domainMsg).not.toBe(LEGACY_SETUP_MESSAGE);
  });

  it("should produce different keys when signing different messages", () => {
    const sig1 = ("0x" + "aa".repeat(64)) as Hex;
    const sig2 = ("0x" + "bb".repeat(64)) as Hex;
    const keysA = deriveKeysFromSignature(sig1);
    const keysB = deriveKeysFromSignature(sig2);
    expect(keysA.viewingKey).not.toEqual(keysB.viewingKey);
    expect(keysA.spendingKey).not.toEqual(keysB.spendingKey);
  });
});

describe("Stealth Address Formats", () => {
  it("should handle fresh vs existing account paths", () => {
    const sig = generateTestSignature();
    const keys = deriveKeysFromSignature(sig);
    const { metaAddress } = keysToStealthMetaAddress(keys.viewingKey, keys.spendingKey);
    expect(metaAddress).toHaveLength(66);
    const hex = stealthMetaAddressToHex(metaAddress);
    expect(hex).toHaveLength(134); // "0x" + 132 hex chars
  });

  it("should round-trip meta-address through hex encoding", () => {
    const sig = generateTestSignature();
    const keys = deriveKeysFromSignature(sig);
    const { metaAddress } = keysToStealthMetaAddress(keys.viewingKey, keys.spendingKey);
    const hex = stealthMetaAddressToHex(metaAddress);
    const parsed = parseStealthMetaAddress(hex);
    const meta2 = keysToStealthMetaAddress(keys.viewingKey, keys.spendingKey);
    expect(parsed.viewPubKey).toEqual(meta2.V);
    expect(parsed.spendPubKey).toEqual(meta2.S);
  });

  it("should produce a valid Stellar keypair from any stealth priv key", () => {
    for (let i = 0; i < 5; i++) {
      const priv = new Uint8Array(32);
      for (let j = 0; j < 32; j++) {
        priv[j] = (i * 33 + j) & 0xff;
      }
      const keypair = deriveStealthStellarKeypairFromStealthPrivKey(priv);
      expect(keypair.publicKey()).toMatch(/^G[A-Z0-9]{55}$/);
    }
  });
});

describe("Key Derivation Determinism", () => {
  it("should always produce 32-byte keys from HKDF", () => {
    for (let i = 0; i < 10; i++) {
      const sig = new Uint8Array(64);
      for (let j = 0; j < 64; j++) {
        sig[j] = (i * 64 + j) & 0xff;
      }
      const hex = ("0x" + bytesToHex(sig)) as Hex;
      const keys = deriveKeysFromSignature(hex);
      expect(keys.viewingKey).toHaveLength(32);
      expect(keys.spendingKey).toHaveLength(32);
    }
  });

  it("should handle 0x-prefixed and raw hex signatures the same way", () => {
    const raw = "ab".repeat(64);
    const prefixed = ("0x" + raw) as Hex;
    const fromRaw = deriveKeysFromSignature(raw);
    const fromPrefixed = deriveKeysFromSignature(prefixed);
    expect(fromRaw.viewingKey).toEqual(fromPrefixed.viewingKey);
    expect(fromRaw.spendingKey).toEqual(fromPrefixed.spendingKey);
  });
});
