/**
 * Automatic pull of recent Fathom calls while an authenticated Steward page
 * is open.
 *
 * The server lists and normalizes; the member's own browser stores through
 * the existing RLS upsert pipeline. Each incoming call is matched against
 * the conversations table by an AUTHORITATIVE per-call lookup — exact
 * equality on source_external_id or source_url, scoped to the organization
 * and provider — never by scanning a capped listing, so a match anywhere in
 * the table is found and an older row is never duplicated or overwritten.
 * A call whose transcript is not ready yet is skipped and retried on a
 * later pass — an empty read never overwrites a stored transcript, and a
 * late-arriving fuller transcript upgrades a stored empty one only through
 * the stored row's OWN conflict identity (its actual source_external_id).
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
  /** Equivalent meaningful transcript content; no write needed. */
  unchanged: number;
  /** Changed nonempty stored transcripts preserved for review. */
  preserved: number;
  /** Calls skipped because their transcript is not ready yet. */
  pendingTranscript: number;
  /** True when the source has older calls beyond this bounded pull. */
  hasMore: boolean;
  /** Per-call store or lookup failures, surfaced rather than hidden. */
  errors: string[];
  /** Genuine cautions (no identity, changed transcript), not unchanged reads. */
  warnings: string[];
}

/** The stable identity of a stored or incoming call. */
export function callIdentity(call: { externalId?: string | null; url?: string }): string | null {
  if (call.externalId && call.externalId.trim()) return `id:${call.externalId.trim()}`;
  if (call.url && call.url.trim()) return `url:${call.url.trim()}`;
  return null;
}

function segmentCount(conversation: { segments?: unknown[] }): number {
  return Array.isArray(conversation.segments) ? conversation.segments.length : 0;
}

function storedSegmentCount(row: StoredConversation): number {
  const segments = (row.conversation as { segments?: unknown[] } | undefined)?.segments;
  return Array.isArray(segments) ? segments.length : 0;
}

/** Compare transcript meaning, not provider indexes, links or segment count alone. */
export function transcriptsEquivalent(
  stored: NormalizedConversation,
  incoming: NormalizedConversation,
): boolean {
  if (!Array.isArray(stored?.segments) || stored.segments.length !== incoming.segments.length) {
    return false;
  }
  const meaningful = (value: string) => value.replace(/\s+/g, " ").trim();
  return stored.segments.every((segment, index) => {
    const next = incoming.segments[index];
    if (
      !segment ||
      !next ||
      typeof segment.text !== "string" ||
      typeof segment.speaker !== "string" ||
      typeof segment.at !== "string"
    ) {
      return false;
    }
    return (
      meaningful(segment.text) === meaningful(next.text) &&
      meaningful(segment.speaker) === meaningful(next.speaker) &&
      segment.at.trim() === next.at.trim() &&
      (segment.speakerEmail?.trim() ?? "") === (next.speakerEmail?.trim() ?? "")
    );
  });
}

/**
 * An upgrade is only safe when it is demonstrably fuller: the stored row has
 * NO transcript segments and the incoming read has some. When the stored row
 * already has segments, a re-segmented read could look "fuller" by count
 * while actually losing content — so we skip and warn instead of risking an
 * overwrite.
 */
function isDemonstrablyFuller(
  stored: StoredConversation,
  incoming: NormalizedConversation,
): boolean {
  return storedSegmentCount(stored) === 0 && incoming.segments.length > 0;
}

interface PlannedWrite {
  conversation: NormalizedConversation;
  kind: "added" | "refreshed";
}

/**
 * Decide what to do with one incoming call, using an authoritative per-call
 * lookup against the conversations table (member RLS, scoped to org and
 * provider, exact equality — no capped listing). Returns the planned write,
 * or null when the call is skipped; skips and failures are reported through
 * the outcome collectors.
 */
async function planCall(
  call: NormalizedConversation,
  organizationId: string,
  outcome: {
    errors: string[];
    warnings: string[];
    pendingTranscript: number;
    unchanged: number;
    preserved: number;
  },
): Promise<PlannedWrite | null> {
  const externalId = call.sourceRef.externalId?.trim() || undefined;
  const shareToken = call.sourceRef.shareToken?.trim() || undefined;
  const url = call.sourceRef.url?.trim() || undefined;

  /* A call with no stable identity at all can neither be matched nor
     safely upserted (the conflict key would collapse to a shared null):
     skip it and say so. */
  if (!externalId && !shareToken && !url) {
    outcome.warnings.push(`“${call.title}” has no stable source identity and was not stored.`);
    return null;
  }
  let existing: StoredConversation | null;
  try {
    existing = await stewardService.findConversationBySource({
      organizationId,
      provider: call.sourceRef.provider,
      /* The write's conflict key is the first of externalId / shareToken /
         url, so a stored row could be keyed by any of them — look up all. */
      externalIds: [externalId, shareToken].filter((v): v is string => Boolean(v)),
      ...(url ? { url } : {}),
    });
  } catch (error) {
    /* Lookup failed or was ambiguous: skip the write and surface it. A
       guess here is how duplicates and overwrites happen. */
    outcome.errors.push(
      `“${call.title}” was left untouched: ${
        error instanceof Error ? error.message : "its stored record could not be verified."
      }`,
    );
    return null;
  }

  if (existing && storedSegmentCount(existing) > 0) {
    if (transcriptsEquivalent(existing.conversation, call)) {
      outcome.unchanged += 1;
    } else {
      outcome.preserved += 1;
      outcome.warnings.push(`“${call.title}”: transcript changed; stored version preserved.`);
    }
    return null;
  }

  /* An empty read never overwrites anything, and can be retried later. */
  if (call.segments.length === 0) {
    outcome.pendingTranscript += 1;
    return null;
  }

  if (!existing) return { conversation: call, kind: "added" };

  if (!isDemonstrablyFuller(existing, call)) {
    return null;
  }

  /* Late transcript upgrade. The upsert conflict key is
     org+provider+source_external_id — so the write MUST carry the stored
     row's ACTUAL source_external_id, whatever it is (a numeric id, a share
     token, or the URL), or it would insert a duplicate second row. The
     incoming call's own identities are dropped from the key path: only the
     stored identity goes out, and the stored URL is preserved. */
  return {
    kind: "refreshed",
    conversation: {
      ...call,
      sourceRef: {
        provider: call.sourceRef.provider,
        externalId: existing.sourceExternalId,
        url: existing.sourceUrl || url || "",
      },
    },
  };
}

const inFlight = new Map<string, Promise<SyncOutcome>>();

/** Pull recent calls and store the ones the workspace lacks. Deduped per org. */
export function syncRecentMeetings(input: {
  organizationId: string;
  userId: string;
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

    const outcome = {
      errors: [] as string[],
      warnings: [] as string[],
      pendingTranscript: 0,
      unchanged: 0,
      preserved: 0,
    };
    const planned: PlannedWrite[] = [];
    /* Dedupe repeated identities within one pass. */
    const seen = new Set<string>();
    for (const call of incoming) {
      const keys = [
        call.sourceRef.externalId?.trim() ? `id:${call.sourceRef.externalId.trim()}` : null,
        call.sourceRef.url?.trim() ? `url:${call.sourceRef.url.trim()}` : null,
      ].filter((k): k is string => Boolean(k));
      if (keys.length > 0 && keys.some((k) => seen.has(k))) continue;
      for (const k of keys) seen.add(k);
      const plan = await planCall(call, input.organizationId, outcome);
      if (plan) planned.push(plan);
    }

    let added = 0;
    let refreshed = 0;
    for (const { conversation, kind } of planned) {
      try {
        await stewardService.saveConversation({
          organizationId: input.organizationId,
          userId: input.userId,
          conversation,
        });
        if (kind === "added") added += 1;
        else refreshed += 1;
      } catch (error) {
        outcome.errors.push(
          error instanceof Error ? error.message : `Could not store “${conversation.title}”.`,
        );
      }
    }

    return {
      /* A check counts as successful only when the source answered and every
         required write landed. Otherwise the previous success stands. */
      checkedAt: outcome.errors.length === 0 ? new Date().toISOString() : null,
      added,
      refreshed,
      unchanged: outcome.unchanged,
      preserved: outcome.preserved,
      pendingTranscript: outcome.pendingTranscript,
      hasMore: body["hasMore"] === true,
      errors: outcome.errors,
      warnings: outcome.warnings,
    };
  })().finally(() => {
    inFlight.delete(flightKey);
  });

  inFlight.set(flightKey, run);
  return run;
}
