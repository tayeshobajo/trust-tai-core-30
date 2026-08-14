/**
 * Activity stream backed by the shared `activities` table.
 *
 * Column mapping (schema is managed outside this project):
 *   app_key, event_type, actor_user_id, entity_type, entity_id,
 *   organization_id, summary, payload, occurred_at
 *
 * Optional columns we send but a table may not have are dropped automatically
 * by `writeTolerant`, so a schema difference never blocks a user action.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ActivityEvent, ActivityQuery, ActivityStream } from "@/domain/activity";

import { writeTolerant, type Row } from "./schema";

const REQUIRED = ["organization_id", "event_type", "entity_type", "entity_id"];

/**
 * The stable key for "the same happening". Producers may carry it on the
 * payload or inside provenance; both are accepted, and it is written to the
 * live `activities.source_event_key` column as well as to provenance so older
 * readers keep working.
 */
function dedupeKeyOf(event: Omit<ActivityEvent, "id">): string | null {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const candidates = [
    payload["source_event_key"],
    payload["sourceEventKey"],
    payload["dedupe_key"],
    event.provenance.externalRef,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) return candidate.trim();
  }
  return null;
}

function toEvent(row: Row): ActivityEvent {
  const stored = (row["payload"] ?? {}) as Record<string, unknown>;
  // The live column wins over anything mirrored into the payload.
  const payload: Record<string, unknown> =
    typeof row["source_event_key"] === "string" && row["source_event_key"]
      ? { ...stored, source_event_key: row["source_event_key"] }
      : stored;
  return {
    id: String(row["id"] ?? crypto.randomUUID()),
    organizationId: String(row["organization_id"] ?? ""),
    name: String(row["event_type"] ?? "activity.created") as ActivityEvent["name"],
    subject: {
      type: (row["entity_type"] ?? "activity") as ActivityEvent["subject"]["type"],
      id: String(row["entity_id"] ?? ""),
      ...(typeof payload["label"] === "string" ? { label: payload["label"] as string } : {}),
    },
    summary: String(row["summary"] ?? payload["summary"] ?? ""),
    payload,
    provenance: {
      appId: String(row["app_key"] ?? "scout"),
      actor: { type: "user", id: String(row["actor_user_id"] ?? "") },
      observedAt: String(row["occurred_at"] ?? row["created_at"] ?? new Date().toISOString()),
      confidence: "observed",
    },
    occurredAt: String(row["occurred_at"] ?? row["created_at"] ?? new Date().toISOString()),
  };
}

export const supabaseActivity: ActivityStream = {
  async record(event) {
    const occurredAt = event.occurredAt ?? new Date().toISOString();
    const dedupeKey = dedupeKeyOf(event);
    const payload: Row = {
      organization_id: event.organizationId,
      app_key: event.provenance.appId,
      event_type: event.name,
      actor_user_id: event.provenance.actor.type === "user" ? event.provenance.actor.id : null,
      entity_type: event.subject.type,
      entity_id: event.subject.id,
      summary: event.summary,
      occurred_at: occurredAt,
      payload: {
        ...(event.payload ?? {}),
        label: event.subject.label,
        ...(dedupeKey ? { source_event_key: dedupeKey } : {}),
        provenance: {
          ...event.provenance,
          ...(dedupeKey ? { dedupe_key: dedupeKey } : {}),
        },
      },
      // Live column with a unique partial index per organization and app.
      // `writeTolerant` drops it if a deployment has not run the migration.
      ...(dedupeKey ? { source_event_key: dedupeKey } : {}),
    };

    const { data, error } = await writeTolerant<Row>(payload, REQUIRED, async (body) => {
      const result = await supabase.from("activities").insert(body).select("*").maybeSingle();
      return { data: (result.data ?? null) as Row | null, error: result.error };
    });
    if (error) throw new Error(error.message);
    return data ? toEvent(data) : { ...event, id: crypto.randomUUID() };
  },

  async list(query: ActivityQuery) {
    let request = supabase
      .from("activities")
      .select("*")
      .eq("organization_id", query.organizationId)
      .order("occurred_at", { ascending: false })
      .limit(query.limit ?? 20);

    if (query.appIds && query.appIds.length > 0) request = request.in("app_key", query.appIds);
    if (query.subjectType) request = request.eq("entity_type", query.subjectType);
    if (query.subjectId) request = request.eq("entity_id", query.subjectId);

    const { data, error } = await request;
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map(toEvent);
  },
};
