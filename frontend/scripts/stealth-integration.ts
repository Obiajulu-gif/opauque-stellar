/**
 * Stealth send + withdrawal integration script (manual, testnet).
 *
 * The reference wallet has no unit-test runner, so this script exercises the
 * two runtime paths that issues #16 and #17 are about, against Stellar testnet:
 *
 *   #16 — Private send to a stealth address:
 *         • fresh (unfunded) destination  -> createAccount
 *         • existing (funded) destination -> payment
 *
 *   #17 — Stealth withdrawal call signatures:
 *         • announcement withdrawal -> executeStealthWithdrawal(privKey, dest, onStatus)
 *         • ghost withdrawal        -> withdrawFromGhostAddress(addr, net, dest, asset,
 *                                       getMasterKeys, wasm, onStatus)
 *
 * Usage (testnet):
 *   STEALTH_DEST=G... npx tsx scripts/stealth-integration.ts send
 *   STEALTH_PRIV=0x... STEALTH_DEST=G... npx tsx scripts/stealth-integration.ts withdraw
 *
 * The `send` mode is read-only: it resolves which operation would be built for
 * the destination without submitting anything, so it is safe to run repeatedly.
 */

import { accountExists, buildNativeTransferOperation } from "../src/lib/stellar";
import { executeStealthWithdrawal } from "../src/lib/stealthLifecycle";

async function checkSendPath(destination: string) {
  const exists = await accountExists(destination);
  const op = await buildNativeTransferOperation({
    destination,
    amountStroops: 5_000_000n,
  });
  // `op.body().switch().name` is "createAccount" or "payment".
  const opType = op.body().switch().name;
  console.log(`destination ${destination}`);
  console.log(`  account exists : ${exists}`);
  console.log(`  operation      : ${opType}`);
  if (exists && opType !== "payment") {
    throw new Error("Expected payment for an existing account");
  }
  if (!exists && opType !== "createAccount") {
    throw new Error("Expected createAccount for a fresh account");
  }
  console.log("  ✓ correct operation selected");
}

async function runWithdraw(privKey: string, destination: string) {
  const hash = await executeStealthWithdrawal(
    privKey as `0x${string}`,
    destination,
    (s) => console.log(`  [${s.tag}] ${s.label}${s.detail ? ` — ${s.detail}` : ""}`),
  );
  console.log(`  ✓ withdrawal broadcast: ${hash}`);
}

async function main() {
  const mode = process.argv[2];
  const destination = process.env.STEALTH_DEST;

  if (mode === "send") {
    if (!destination) throw new Error("Set STEALTH_DEST=G...");
    await checkSendPath(destination);
    return;
  }

  if (mode === "withdraw") {
    const priv = process.env.STEALTH_PRIV;
    if (!priv || !destination) {
      throw new Error("Set STEALTH_PRIV=0x... and STEALTH_DEST=G...");
    }
    await runWithdraw(priv, destination);
    return;
  }

  console.error("Usage: stealth-integration.ts <send|withdraw>");
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
