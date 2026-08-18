/**
 * Writing Conductor governance history.
 *
 * The same append-only stream as everything else, so there is no second event
 * store, but a separate vocabulary, because these events report the control
 * loop, not a room's truth. Emitting is best effort: history matters, never
 * enough to lose a person's decision.
 */

import { supabaseActivity } from "@/data/supabase/activities";
import type { ActivityEvent } from "@/domain/activity";
import { CONTROL_EVENTS, type ControlEventInput } from "@/domain/control-events";

export async function emitControlEvent(
  input: ControlEventInput,
): Promise<ActivityEvent | null> {
  const definition = CONTROL_EVENTS[input.key];
  const at = input.occurredAt ?? new Date().toISOString();
  try {
    return await supabaseActivity.record({
      organizationId: input.organizationId,
      name: definition.name,
      subject: { type: "decision", id: input.actionId, label: input.summary.slice(0, 120) },
      summary: input.summary,
      payload: {
        ...(input.metadata ?? {}),
        event: definition.name,
        owning_app: input.owningApp,
        conductor_action_id: input.actionId,
        source_event_key: input.sourceEventKey,
      },
      provenance: {
        appId: "conductor",
        actor: input.actor,
        observedAt: at,
        externalRef: input.sourceEventKey,
        confidence: "observed",
      },
      occurredAt: at,
    });
  } catch {
    return null;
  }
}
