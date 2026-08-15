/**
 * The one way an app writes into the shared stream.
 *
 * There is no second event store: this is a thin adapter over the existing
 * `activities` table so Scout, Comms, Roadmap and later Projects all speak the
 * same vocabulary with the same envelope. Emitting is best-effort — history is
 * important, never important enough to lose a person's work.
 */

import { supabaseActivity } from "@/data/supabase/activities";
import type { ActivityEvent } from "@/domain/activity";
import { SUITE_EVENTS, SUITE_EVENT_LIST, type SuiteEventInput } from "@/domain/events";
import type { ID } from "@/domain/entities";

export async function emitSuiteEvent(input: SuiteEventInput): Promise<ActivityEvent | null> {
  const definition = SUITE_EVENTS[input.key];
  const at = input.occurredAt ?? new Date().toISOString();
  try {
    return await supabaseActivity.record({
      organizationId: input.organizationId,
      name: definition.name,
      subject: input.subject,
      ...(input.related ? { related: input.related } : {}),
      summary: input.summary,
      payload: {
        ...(input.metadata ?? {}),
        event: definition.name,
        // Read by `supabaseActivity.record` and written to the unique
        // `activities.source_event_key` column, so a retry is a no-op.
        ...(input.sourceEventKey ? { source_event_key: input.sourceEventKey } : {}),
      },
      provenance: {
        appId: definition.emittedBy,
        actor: input.actor,
        observedAt: at,
        ...(input.sourceEventKey ? { externalRef: input.sourceEventKey } : {}),
        confidence: input.confidence ?? "observed",
      },
      occurredAt: at,
    });
  } catch {
    return null;
  }
}

/** Read the shared stream, newest first. Organization scoped by RLS. */
export async function readSuiteEvents(
  organizationId: ID,
  limit = 40,
): Promise<ActivityEvent[]> {
  try {
    return await supabaseActivity.list({ organizationId, limit });
  } catch {
    return [];
  }
}

/** Only the cross-app vocabulary, for readers that must ignore local history. */
export function onlySuiteEvents(events: ActivityEvent[]): ActivityEvent[] {
  const names = new Set(SUITE_EVENT_LIST.map((definition) => definition.name as string));
  return events.filter((event) => names.has(event.name));
}
