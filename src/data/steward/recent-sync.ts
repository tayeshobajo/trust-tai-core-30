/**
 * Automatic pull of recent Fathom calls while an authenticated Steward page
 * is open.
 *
 * The server lists and normalizes; the member's own browser stores through
 * the existing RLS upsert pipeline, deduplicated on the stable
 * org/provider/external id and on the source URL. A call whose transcript is
 * not ready yet is skipped and retried on a later pass — an empty read never
 * overwrites a stored transcript, and a late-arriving fuller transcript
 * upgrades a stored partial one only through the same stable identity.
 *
 * Limit, said plainly: this runs only while someone has Steward open. A
 * closed browser syncs nothing. There is no scheduler or webhook in this
 * repository; the open page is the trigger.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { NormalizedConversation } from "@/domain/steward";
import { stewardService, type StoredConversation } from "@/data/supabase/steward-service";

const ENDPOINT = "/api/public/steward/sync";

async function token(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const value = data.session?.access_token;
  if (!value) throw new Error("Your session has expired. Sign in again.");
  return value;
}

export interface SyncOutcome {
  /** Set only when the source answered and every required write succeeded. */
  checkedAt: string | null;
  /** Calls newly stored this pass. */
  added: number;
  /** Stored calls whose transcript was upgraded to a fuller read. */
  refreshed: number;
  /** Calls skipped because their transcript is not ready yet. */
  pendingTranscript: number;
  /** True when the source has older calls beyond this bounded pull. */
  hasMore: boolean;
  /** Per-call store failures, surfaced rather than hidden. */
  errors: string[];
}

/** The stable identity of a stored or incoming call. */
export function callIdentity(call: { externalId?: string | null; url?: string }): string | null {
  if (call.externalId && call.externalId.trim()) return `id:${call.externalId.trim()}`;
  if (call.url && call.url.trim()) return `url:${call.url.trim()}`;
  return null;
}

function storedSegmentCount(row: StoredConversation): number {
  const segments = (row.conversation as { segments?: unknown[] } | undefined)?.segments;
  return Array.isArray(segments) ? segments.length : 0;
}

export interface MissingResult {
  /** Calls with no stored record at all. */
  missing: NormalizedConversation[];
  /** Stored calls the source now has a fuller transcript for. */
  upgrades: NormalizedConversation[];
  pendingTranscript: number;
}

/**
 * Which incoming calls are not already stored, and which stored calls have a
 * fuller transcript available. Pure, so the dedupe rule is testable without
 * a network. A stored row is matched by stable external id OR source url, so
 * a numeric id arriving later never duplicates a url-stored row.
 */
export function missingCalls(
  incoming: NormalizedConversation[],
  stored: StoredConversation[],
): MissingResult {
  const byKey = new Map<string, StoredConversation>();
  for (const row of stored) {
    const external = row.conversation?.sourceRef?.externalId;
    if (external) byKey.set(`id:${external}`, row);
    if (row.sourceUrl) byKey.set(`url:${row.sourceUrl}`, row);
  }
  const missing: NormalizedConversation[] = [];
  const upgrades: NormalizedConversation[] = [];
  let pendingTranscript = 0;
  const seen = new Set<string>();
  for (const call of incoming) {
    const keys = [
      call.sourceRef.externalId?.trim() ? `id:${call.sourceRef.externalId.trim()}` : null,
      call.sourceRef.url?.trim() ? `url:${call.sourceRef.url.trim()}` : null,
    ].filter((k): k is string => Boolean(k));
    if (keys.some((k) => seen.has(k))) continue;
    for (const k of keys) seen.add(k);
    /* A call without a transcript is pending, not empty: skip it this pass
       so an empty read never replaces anything, and retry later. */
    if (call.segments.length === 0) {
      pendingTranscript += 1;
      continue;
    }
    const existing = keys.map((k) => byKey.get(k)).find((row): row is StoredConversation => !!row);
    if (!existing) {
      missing.push(call);
      continue;
    }
    /* Late transcript upgrade: only ever replace a stored transcript with a
       strictly fuller one, through the same stable identity. */
    if (call.segments.length > storedSegmentCount(existing)) upgrades.push(call);
  }
  return { missing, upgrades, pendingTranscript };
}

const inFlight = new Map<string, Promise<SyncOutcome>>();

/** Pull recent calls and store the ones the workspace lacks. Deduped per org. */
export function syncRecentMeetings(input: {
  organizationId: string;
  userId: string;
  stored: StoredConversation[];
}): Promise<SyncOutcome> {
  const running = inFlight.get(input.organizationId);
  if (running) return running;

  const run = (async (): Promise<SyncOutcome> => {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await token()}`,
      },
      body: JSON.stringify({ organization_id: input.organizationId }),
    });
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(String(body["error"] ?? "Steward could not check for recent calls."));
    }
    const incoming = (
      Array.isArray(body["conversations"]) ? body["conversations"] : []
    ) as NormalizedConversation[];
    const { missing, upgrades, pendingTranscript } = missingCalls(incoming, input.stored);

    const errors: string[] = [];
    let added = 0;
    let refreshed = 0;
    for (const [conversation, kind] of [
      ...missing.map((c) => [c, "added"] as const),
      ...upgrades.map((c) => [c, "refreshed"] as const),
    ]) {
      try {
        await stewardService.saveConversation({
          organizationId: input.organizationId,
          userId: input.userId,
          conversation,
        });
        if (kind === "added") added += 1;
        else refreshed += 1;
      } catch (error) {
        errors.push(
          error instanceof Error ? error.message : `Could not store “${conversation.title}”.`,
        );
      }
    }

    return {
      /* A check counts as successful only when the source answered and every
         required write landed. Otherwise the previous success stands. */
      checkedAt: errors.length === 0 ? new Date().toISOString() : null,
      added,
      refreshed,
      pendingTranscript,
      hasMore: body["hasMore"] === true,
      errors,
    };
  })().finally(() => {
    inFlight.delete(input.organizationId);
  });

  inFlight.set(input.organizationId, run);
  return run;
}
