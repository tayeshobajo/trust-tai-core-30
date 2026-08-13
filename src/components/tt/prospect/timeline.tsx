/**
 * Activity timeline — the recorded history of this company inside Trust Tai.
 * Research, decisions, and overrides, newest first.
 */

import type { ActivityEvent } from "@/domain/activity";

import { formatChecked } from "../fit-light";
import { RailCard } from "./panel";

export function TimelineCard({ events }: { events: ActivityEvent[] }) {
  return (
    <RailCard title="Activity">
      <ol className="space-y-3">
        {events.map((event) => (
          <li key={event.id} className="border-l border-border pl-3">
            <p className="text-[13px] text-foreground">{event.summary}</p>
            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {formatChecked(event.occurredAt)} · {event.name.replace(/[._]/g, " ")}
            </p>
          </li>
        ))}
      </ol>
    </RailCard>
  );
}
