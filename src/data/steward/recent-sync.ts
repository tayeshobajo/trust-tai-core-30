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
  /** Calls deliberately left untouched (no identity, uncertain overwrite). */
  warnings: string[];
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
  /** Calls deliberately left untouched, with the reason, surfaced honestly. */
  warnings: string[];
}

/**
 * An upgrade is only safe when it is demonstrably fuller: the stored row has
 * NO transcript segments and the incoming read has some. When the stored row
 * already has segments, a re-segmented read could look "fuller" by count
 * while actually losing content — so we skip and warn instead of risking an
 * overwrite.
 */
function isDemonstrablyFuller(stored: StoredConversation, incoming: NormalizedConversation): boolean {
  return storedSegmentCount(stored) === 0 && incoming.segments.length > 0;
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
  const warnings: string[] = [];
  let pendingTranscript = 0;
  const seen = new Set<string>();
  for (const call of incoming) {
    const keys = [
      call.sourceRef.externalId?.trim() ? `id:${call.sourceRef.externalId.trim()}` : null,
      call.sourceRef.url?.trim() ? `url:${call.sourceRef.url.trim()}` : null,
    ].filter((k): k is string => Boolean(k));
    if (keys.some((k) => seen.has(k))) continue;
    for (const k of keys) seen.add(k);
    /* A call with no stable identity at all can neither be matched nor
       safely upserted (the conflict key would collapse to a shared null):
       skip it and say so. */
    if (keys.length === 0) {
      warnings.push(`“${call.title}” has no stable source identity and was not stored.`);
      continue;
    }
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
    /* Late transcript upgrade. The upsert conflict key is
       org+provider+source_external_id, and a row stored by URL has its URL
       as that key — so the write MUST carry the stored row's identity or it
       would insert a duplicate second row. Preserve the stored externalId
       and URL on the conversation handed to the writer. */
    if (isDemonstrablyFuller(existing, call)) {
      const storedExternal = existing.conversation?.sourceRef?.externalId;
      const { externalId: _incomingId, ...restRef } = call.sourceRef;
      upgrades.push({
        ...call,
        sourceRef: {
          ...restRef,
          /* Carry the stored row's identity: its externalId when it has one,
             otherwise no externalId so the conflict key falls back to the
             stored URL — either way the upsert hits the SAME row. */
          ...(storedExternal ? { externalId: storedExternal } : {}),
          url: existing.sourceUrl ?? call.sourceRef.url,
        },
      });
    } else if (storedSegmentCount(existing) > 0) {
      warnings.push(
        `“${call.title}” already has a stored transcript; the fresh read was not demonstrably fuller, so it was left untouched.`,
      );
    }
  }
  return { missing, upgrades, pendingTranscript, warnings };
}

const inFlight = new Map<string, Promise<SyncOutcome>>();

/** Pull recent calls and store the ones the workspace lacks. Deduped per org. */
export function syncRecentMeetings(input: {
  organizationId: string;
  userId: string;
  stored: StoredConversation[];
}): Promise<SyncOutcome> {
  /* Dedupe concurrent runs per org AND user, so an identity change never
     shares or mixes another identity's in-flight result. */
  const flightKey = `${input.organizationId}:${input.userId}`;
  const running = inFlight.get(flightKey);
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
    const { missing, upgrades, pendingTranscript, warnings } = missingCalls(incoming, input.stored);

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
      warnings,
    };
  })().finally(() => {
    inFlight.delete(flightKey);
  });

  inFlight.set(flightKey, run);
  return run;
}
