/**
 * The conversation room.
 *
 * The heart of Comms: one thread, read top to bottom. Their words on the left,
 * ours on the right, meeting notes and drafts inline where they happened.
 */

import {
  EVENT_LABEL,
  type ConversationDay,
  type ConversationEvent as EventShape,
} from "@/data/comms-timeline";
import { initials } from "@/data/comms-inbox";
import { HEALTH_LABEL, type ConversationHealth } from "@/domain/comms-health";
import { SOURCE_LABEL, STAGE_LABEL, type Relationship } from "@/domain/comms";
import { cn } from "@/lib/utils";

import { HealthDot } from "./health-marks";

function timeOf(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function ConversationEvent({ event }: { event: EventShape }) {
  const mine = event.kind === "we_wrote";
  const inline = event.kind === "meeting" || event.kind === "note" || event.kind === "system";

  if (inline) {
    return (
      <li className="flex justify-center">
        <div className="w-full max-w-[85%] rounded-lg border border-dashed border-border bg-secondary/40 px-3.5 py-2.5">
          <p className="tt-eyebrow">
            {EVENT_LABEL[event.kind]} · {timeOf(event.occurredAt)}
          </p>
          <p className="mt-1 text-[13px] text-foreground">{event.title}</p>
          {event.body ? (
            <p className="mt-1 whitespace-pre-wrap text-[13px] text-muted-foreground">{event.body}</p>
          ) : null}
        </div>
      </li>
    );
  }

  if (event.kind === "draft") {
    return (
      <li className="flex justify-end">
        <div className="max-w-[78%] rounded-2xl rounded-br-md border border-dashed border-border bg-background px-3.5 py-2.5">
          <p className="tt-eyebrow">Draft · not sent</p>
          <p className="mt-1 text-[13px] text-foreground">{event.title}</p>
          {event.body ? (
            <p className="mt-1 line-clamp-6 whitespace-pre-wrap text-[13px] text-muted-foreground">
              {event.body}
            </p>
          ) : null}
          <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {event.source ?? "Prepared in Comms"}
          </p>
        </div>
      </li>
    );
  }

  return (
    <li className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[78%] rounded-2xl px-3.5 py-2.5",
          mine
            ? "rounded-br-md bg-secondary text-foreground"
            : "rounded-bl-md border border-border bg-background text-foreground",
        )}
      >
        <p className="tt-eyebrow">
          {EVENT_LABEL[event.kind]} · {timeOf(event.occurredAt)}
        </p>
        <p className="mt-1 whitespace-pre-wrap text-[13px]">{event.title}</p>
        {event.body ? (
          <p className="mt-1 whitespace-pre-wrap text-[13px] text-muted-foreground">{event.body}</p>
        ) : null}
      </div>
    </li>
  );
}

export function ConversationRoom({
  relationship,
  days,
  health,
  onViewProfile,
  onOpenContext,
  children,
}: {
  relationship: Relationship;
  days: ConversationDay[];
  health: ConversationHealth;
  onViewProfile: () => void;
  onOpenContext?: () => void;
  children?: React.ReactNode;
}) {
  const chips = [
    STAGE_LABEL[relationship.stage],
    SOURCE_LABEL[relationship.source],
    relationship.nextAction?.trim() ? "Next move set" : "No next move set",
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-border px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-secondary font-mono text-[12px] text-muted-foreground"
          >
            {initials(relationship.fullName)}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-base font-medium text-foreground">
              {relationship.fullName}
            </h1>
            <p className="truncate text-[12px] text-muted-foreground">
              {[relationship.companyName, relationship.email, relationship.metWhere]
                .filter(Boolean)
                .join(" · ") || "Nothing else on record yet."}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {chips.map((chip) => (
                <span
                  key={chip}
                  className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  {chip}
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                <HealthDot status={health.status} />
                Health: {HEALTH_LABEL[health.status]}
              </span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {onOpenContext ? (
            <button
              type="button"
              onClick={onOpenContext}
              className="rounded-md border border-border px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:hidden"
            >
              Context
            </button>
          ) : null}
          <button
            type="button"
            onClick={onViewProfile}
            className="rounded-md border border-border px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            View profile
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-5 sm:px-6">
        {days.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-muted-foreground">
            Nothing has been said yet. Write the first message below and it will live here.
          </p>
        ) : (
          days.map((day) => (
            <section key={day.key} className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {day.label}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <ul className="space-y-2.5">
                {day.events.map((event) => (
                  <ConversationEvent key={event.id} event={event} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      {children}
    </div>
  );
}
