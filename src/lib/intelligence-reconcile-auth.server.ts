/**
 * Authorisation for the scheduled reconciliation endpoint.
 *
 * The shared secret lives in the database, in a service role only config
 * table, not in the app environment. That way the hourly job can be turned on
 * from Supabase alone: the schedule reads the same row when it builds the
 * request header, and nothing has to be copied into a deployment.
 *
 * Laws:
 *  - one global config row, read with the service role client
 *  - a missing or empty row means the endpoint is not configured, so it refuses
 *  - the presented header is compared in constant time
 *  - the secret is never returned to a caller and never logged
 */

/** The single global config row. */
export const RECONCILE_CONFIG_ID = "global";

type ConfigClient = {
  from: (table: string) => any;
};

/** Equal length, byte for byte, without an early exit. */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}

/**
 * Reads the configured secret. Returns null when reconciliation has not been
 * configured, or when the read fails for any reason. Never throws upward, so a
 * database problem reads as "not configured" rather than as an open door.
 */
export async function loadReconcileSecret(client: ConfigClient): Promise<string | null> {
  try {
    const { data, error } = await client
      .from("intelligence_reconcile_config")
      .select("secret")
      .eq("id", RECONCILE_CONFIG_ID)
      .maybeSingle();
    if (error) return null;
    const secret = typeof data?.secret === "string" ? data.secret.trim() : "";
    return secret.length > 0 ? secret : null;
  } catch {
    return null;
  }
}

export type ReconcileAuthResult = { ok: true } | { ok: false; status: 503 | 401; error: string };

/** Decides whether a presented header may run reconciliation. */
export async function authorizeReconcileRequest(
  client: ConfigClient,
  presented: string | null,
): Promise<ReconcileAuthResult> {
  const secret = await loadReconcileSecret(client);
  if (!secret) {
    return {
      ok: false,
      status: 503,
      error: "Reconciliation is not configured on this deployment.",
    };
  }
  if (!constantTimeEquals(presented ?? "", secret)) {
    return { ok: false, status: 401, error: "Not allowed." };
  }
  return { ok: true };
}
