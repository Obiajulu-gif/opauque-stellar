import { DEMO_CONFIG } from "./config";

export interface NullifierConsumptionResult {
  consumed: boolean;
  reason?: string;
}

function getServiceUrl(): string {
  const url = DEMO_CONFIG.NULLIFIER_SERVICE_URL;
  if (!url) {
    throw new Error("Set VITE_NULLIFIER_SERVICE_URL to enable shared nullifier checks.");
  }
  return url.replace(/\/$/, "");
}

export async function isNullifierUsed(nullifierHash: string): Promise<boolean> {
  const url = `${getServiceUrl()}/nullifiers/${encodeURIComponent(nullifierHash.toLowerCase())}`;
  const res = await fetch(url, { method: "GET" });

  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`Nullifier lookup failed: ${res.status}`);

  const body = (await res.json()) as { used?: boolean; consumed?: boolean };
  return Boolean(body.used ?? body.consumed);
}

export async function consumeNullifier(
  nullifierHash: string,
): Promise<NullifierConsumptionResult> {
  const res = await fetch(`${getServiceUrl()}/nullifiers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nullifierHash: nullifierHash.toLowerCase(),
      externalNullifier: DEMO_CONFIG.EXTERNAL_NULLIFIER,
      app: DEMO_CONFIG.APP_NAME,
    }),
  });

  if (res.status === 409) {
    return { consumed: false, reason: "This nullifier has already been consumed." };
  }

  if (!res.ok) {
    return { consumed: false, reason: `Nullifier consumption failed: ${res.status}` };
  }

  return { consumed: true };
}
