import type { SupabaseClient } from "@supabase/supabase-js";

/** Every existing approved thread is eligible; only transport ownership can select a mailbox. */
export function fairThreadBatch(ids: string[], after: string | null, cap = 25) {
  const sorted = [...new Set(ids)].sort();
  const start = after ? sorted.findIndex((id) => id > after) : 0;
  const offset = start < 0 ? 0 : start;
  const ordered = [...sorted.slice(offset), ...sorted.slice(0, offset)];
  const selected = ordered.slice(0, Math.max(0, cap));
  return { ids: selected, total: sorted.length, next: selected.at(-1) ?? after };
}

/** Keyset pages avoid a global recent-message window starving older approved threads. */
export async function readAllSyncMetadata(
  client: SupabaseClient,
  table: "comms_threads" | "comms_messages",
  organizationId: string,
) {
  const rows: { id: string; provider_thread_id: string | null; provenance?: unknown }[] = [];
  let after: string | null = null;
  let expected: number | null = null;
  for (;;) {
    let query = client
      .from(table)
      .select(
        table === "comms_messages" ? "id,provider_thread_id,provenance" : "id,provider_thread_id",
        { count: "exact" },
      )
      .eq("organization_id", organizationId)
      .eq("provider", "gmail")
      .order("id", { ascending: true })
      .limit(500);
    if (after) query = query.gt("id", after);
    const result = await query;
    if (result.error)
      throw new Error(`Approved-thread ${table} read failed: ${result.error.message}`);
    if (result.count === null) throw new Error("Approved-thread metadata count unavailable.");
    if (expected === null) expected = result.count;
    if (rows.length + result.count !== expected)
      throw new Error("Approved-thread metadata changed during pagination; retry required.");
    const page = (result.data ?? []) as unknown as typeof rows;
    if (page.some((row) => !row.id || (after !== null && row.id <= after)))
      throw new Error("Invalid approved-thread metadata page.");
    rows.push(...page);
    if (new Set(rows.map((row) => row.id)).size !== rows.length)
      throw new Error("Duplicate approved-thread metadata rows.");
    if (rows.length === expected) return rows;
    if (!page.length || rows.length > expected || rows.length >= 100_000)
      throw new Error("Approved-thread metadata incomplete; retry required.");
    after = page.at(-1)!.id;
  }
}

export class GoogleReadError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly retryAfterAt?: string,
  ) {
    super(message);
  }
}
export function revokedCredential(error: unknown): boolean {
  return error instanceof GoogleReadError && error.code === "invalid_grant";
}
export function retryAfterAt(value: string | null, now = Date.now()): string | undefined {
  if (!value) return undefined;
  const seconds = /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : null;
  const time = seconds === null ? Date.parse(value) : now + seconds * 1000;
  return Number.isFinite(time) && time > now ? new Date(time).toISOString() : undefined;
}
export function retryAt(failures: number, now = Date.now(), providerNotBefore?: string): string {
  const backoff = now + Math.min(6 * 60, 5 * 2 ** Math.min(Math.max(failures - 1, 0), 7)) * 60_000;
  const provider = providerNotBefore ? Date.parse(providerNotBefore) : NaN;
  return new Date(Number.isFinite(provider) ? Math.max(backoff, provider) : backoff).toISOString();
}
export function retryDue(
  status: string,
  cursor: Record<string, unknown>,
  now = Date.now(),
): boolean {
  if (status !== "connected" && status !== "error") return false;
  const retry = cursor["retry"] as { next_at?: string } | undefined;
  const at = retry?.next_at ? Date.parse(retry.next_at) : 0;
  return !Number.isFinite(at) || at <= now;
}
