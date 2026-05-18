import { getHorizonServer } from "./stellar";

/** Returns native XLM balance in stroops for a Stellar account. */
export async function readNativeBalance(publicKey: string): Promise<bigint> {
  const account = await getHorizonServer().loadAccount(publicKey);
  const native = account.balances.find((b) => b.asset_type === "native");
  return BigInt(
    Math.round(parseFloat((native as { balance: string })?.balance ?? "0") * 1e7),
  );
}
