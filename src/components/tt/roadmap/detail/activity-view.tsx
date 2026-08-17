/**
 * Roadmap detail — Activity.
 *
 * History as it happened, from the shared activity stream. Nothing is written
 * here; the rooms that acted own their own records.
 */

import { DetailSection } from "./parts";
import type { ActivityEvent } from "@/domain/activity";

export function ActivityView({
  events,
  loading,
  error,
}: {
  events: ActivityEvent[];
  loading: boolean;
  error: string | null;
}) {
  return (
    <DetailSection
      eyebrow="Activity"
      title="What has happened here"
      supporting="Every entry names the room that recorded it and the person or system behind it."
    >
      {loading ? (
        <p className="text-[13px] text-muted-foreground">Reading history…</p>
      ) : error ? (
        <p className="text-[13px] text-destructive">{error}</p>
      ) : events.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Nothing has been recorded against this roadmap yet.
        </p>
      ) : (
        <ol className="space-y-4">
          {events.map((event) => (
            <li key={event.id} className="border-l-2 border-border pl-3">
              <p className="text-[13px] leading-relaxed text-foreground">{event.summary}</p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                {event.name} · {event.provenance.actor.label ?? event.provenance.appId} ·{" "}
                {new Date(event.occurredAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ol>
      )}
    </DetailSection>
  );
}
