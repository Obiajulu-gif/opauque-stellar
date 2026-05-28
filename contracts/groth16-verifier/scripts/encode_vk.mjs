#!/usr/bin/env node
/**
 * Encode a snarkjs Groth16 verification_key.json into the Rust byte-array
 * constants used by the Soroban BN254 verifier (contracts/groth16-verifier).
 *
 * This is the reproducible source of the V2 verification key constants: the
 * key is derived from the exact deployed zkey via
 *   snarkjs zkey export verificationkey stealth_reputation_final.zkey vk.json
 *
 * Encoding (matches the existing V1 constants and Stellar's BN254 host,
 * which follows the EIP-197 convention):
 *   - Field element  -> 32-byte big-endian.
 *   - G1 point [x, y] -> 64 bytes  (x || y).
 *   - G2 point        -> 128 bytes (x_c1 || x_c0 || y_c1 || y_c0), imaginary
 *                        coefficient first. Verified against the canonical G2
 *                        generator present in the V1 VK_GAMMA constant.
 *
 * Usage:
 *   node encode_vk.mjs <verification_key.json>
 */
import { readFileSync } from "node:fs";

function feBytes(decimal) {
  let hex = BigInt(decimal).toString(16).padStart(64, "0");
  if (hex.length !== 64) throw new Error(`field element out of range: ${decimal}`);
  return hex.match(/../g).map((b) => `0x${b}`);
}

function fmt(bytes, indent = "        ") {
  const lines = [];
  for (let i = 0; i < bytes.length; i += 16) {
    lines.push(indent + bytes.slice(i, i + 16).join(", ") + ",");
  }
  return lines.join("\n");
}

function g1(point) {
  return [...feBytes(point[0]), ...feBytes(point[1])];
}

function g2(point) {
  // snarkjs stores [[x_c0, x_c1], [y_c0, y_c1], [1, 0]]; encode c1 first.
  const [x, y] = point;
  return [...feBytes(x[1]), ...feBytes(x[0]), ...feBytes(y[1]), ...feBytes(y[0])];
}

const vk = JSON.parse(readFileSync(process.argv[2], "utf8"));

console.log(`// nPublic = ${vk.nPublic}, IC points = ${vk.IC.length}\n`);

console.log(`const VK_ALPHA_V2: [u8; 64] = [\n${fmt(g1(vk.vk_alpha_1))}\n];\n`);
console.log(`const VK_BETA_V2: [u8; 128] = [\n${fmt(g2(vk.vk_beta_2))}\n];\n`);
console.log(`const VK_GAMMA_V2: [u8; 128] = [\n${fmt(g2(vk.vk_gamma_2))}\n];\n`);
console.log(`const VK_DELTA_V2: [u8; 128] = [\n${fmt(g2(vk.vk_delta_2))}\n];\n`);

const icCount = vk.IC.length;
console.log(`const VK_IC_V2: [[u8; 64]; ${icCount}] = [`);
vk.IC.forEach((pt, i) => {
  console.log(`    // IC${i}`);
  console.log(`    [\n${fmt(g1(pt), "        ")}\n    ],`);
});
console.log(`];`);
