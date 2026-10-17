/**
 * Automatic pull of recent Fathom calls while an authenticated Steward page
 * is open.
 *
 * The server lists and normalizes; the member's own browser stores through
 * the existing RLS upsert pipeline, deduplicated on the stable
 * org/provider/external id and on the source URL. A call whose transcript is
 * not ready yet is skipped and retried on a later pass — an empty read never
 * overwrites a stored full transcript. Reading is not confirming: nothing
 * here creates or confirms a commitment.
 *
 * Limit, said plainly: this runs only while someone has Steward open. A
 * closed browser syncs nothing.
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
  checkedAt: string;
  /** Calls newly stored this pass. */
  added: number;
  /** Calls skipped because their transcript is not ready yet. */
  pendingTranscript: number;
  /** True when the source has older calls beyond this bounded pull. */
  hasMore: boolean;
  /** Per-call store failures, surfaced rather than hidden. */
  errors: string[];
}

/** The stable identity of a stored or incoming call. */
export function callIdentity(call: {
  externalId?: string | null;
  url?: string;
}): string | null {
  if (call.externalId && call.externalId.trim()) return `id:${call.externalId.trim()}`;
  if (call.url && call.url.trim()) return `url:${call.url.trim()}`;
  return null;
}

/**
 * Which incoming calls are not already stored. Pure, so the dedupe rule is
 * testable without a network.
 */
export function missingCalls(
  incoming: NormalizedConversation[],
  stored: StoredConversation[],
): { missing: NormalizedConversation[]; pendingTranscript: number } {
  const known = new Set<string>();
  for (const row of stored) {
    const external = row.conversation?.sourceRef?.externalId;
    if (external) known.add(`id:${external}`);
    if (row.sourceUrl) known.add(`url:${row.sourceUrl}`);
  }
  const missing: NormalizedConversation[] = [];
  let pendingTranscript = 0;
  const seen = new Set<string>();
  for (const call of incoming) {
    const identity = callIdentity({
      externalId: call.sourceRef.externalId ?? null,
      url: call.sourceRef.url,
    });
    if (identity && (known.has(identity) || seen.has(identity))) continue;
    if (identity) seen.add(identity);
    /* A call without a transcript is pending, not empty: skip it this pass
       so an empty read never replaces anything, and retry later. */
    if (call.segments.length === 0) {
      pendingTranscript += 1;
      continue;
    }
    missing.push(call);
  }
  return { missing, pendingTranscript };
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
    const incoming = (Array.isArray(body["conversations"]) ? body["conversations"] : []) as
      NormalizedConversation[];
    const { missing, pendingTranscript } = missingCalls(incoming, input.stored);

    const errors: string[] = [];
    let added = 0;
    for (const conversation of missing) {
      try {
        await stewardService.saveConversation({
          organizationId: input.organizationId,
          userId: input.userId,
          conversation,
        });
        added += 1;
      } catch (error) {
        errors.push(
          error instanceof Error ? error.message : `Could not store “${conversation.title}”.`,
        );
      }
    }

    return {
      checkedAt: new Date().toISOString(),
      added,
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
