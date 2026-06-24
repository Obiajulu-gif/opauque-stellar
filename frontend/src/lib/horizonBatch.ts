import { readNativeBalance } from "./readNativeBalance";

const CONCURRENCY = 5;

/**
 * Fetch native XLM balances for multiple accounts in parallel.
 * Up to CONCURRENCY requests run at once; per-account errors are isolated
 * (missing/unfunded accounts are returned as 0n, other errors propagate per-entry).
 */
export async function batchReadNativeBalances(
  publicKeys: string[],
): Promise<Map<string, bigint>> {
  const results = new Map<string, bigint>();
  const keys = [...publicKeys];

  while (keys.length > 0) {
    const batch = keys.splice(0, CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((key) => readNativeBalance(key).then((bal) => ({ key, bal }))),
    );
    for (let i = 0; i < settled.length; i++) {
      const outcome = settled[i];
      if (outcome.status === "fulfilled") {
        results.set(outcome.value.key, outcome.value.bal);
      } else {
        results.set(batch[i], 0n);
      }
    }
  }

  return results;
}
