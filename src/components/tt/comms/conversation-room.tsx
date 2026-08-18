/**
 * The relationship room.
 *
 * The heart of Comms: one relationship, read top to bottom. Their words on the
 * left, ours on the right, calls, meetings, notes and suggestions inline where
 * they happened. Each event says what it was, when it was, and, when it
 * matters, who put it on the record.
 */

import {
  EVENT_LABEL,
  eventSide,
  type ConversationDay,
  type ConversationEvent as EventShape,
} from "@/data/comms-timeline";
import { initials } from "@/data/comms-inbox";
import { HEALTH_LABEL, type ConversationHealth } from "@/domain/comms-health";
import { SOURCE_LABEL, STAGE_LABEL, type Relationship } from "@/domain/comms";
import { effectiveIntent, INTENT_LABEL } from "@/domain/comms-interactions";
import { cn } from "@/lib/utils";

import { HealthDot } from "./health-marks";

function timeOf(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Each kind reads differently at a glance, without relying on colour alone. */
const KIND_TONE: Record<EventShape["kind"], string> = {
  we_emailed: "border-cloud-line bg-cloud",
  they_emailed: "border-border bg-card",
  they_texted: "border-border bg-card",
  i_texted: "border-cloud-line bg-cloud",
  phone_call: "border-border bg-secondary/40",
  meeting: "border-border bg-secondary/40",
  note: "border-dashed border-border bg-secondary/30",
  suggestion: "border-dashed border-royal/30 bg-royal/5",
  draft: "border-dashed border-cloud-line bg-cloud/50",
};

export function ConversationEvent({
  event,
  onEdit,
  onRetract,
  onRestore,
}: {
  event: EventShape;
  onEdit?: (touchId: string) => void;
  onRetract?: (touchId: string) => void;
  onRestore?: (touchId: string) => void;
}) {
  const side = eventSide(event.kind);
  const touchId = event.touchId;

  return (
    <li
      className={cn(
        "flex",
        side === "us" ? "justify-end" : side === "them" ? "justify-start" : "justify-center",
      )}
    >
      <div
        className={cn(
          "rounded-2xl border px-3.5 py-2.5",
          side === "center" ? "w-full max-w-[88%] rounded-lg" : "max-w-[78%]",
          side === "us" ? "rounded-br-md" : side === "them" ? "rounded-bl-md" : "",
          KIND_TONE[event.kind],
          event.retracted ? "opacity-70" : "",
        )}
      >
        <p className="tt-eyebrow">
          {EVENT_LABEL[event.kind]}
          {timeOf(event.occurredAt) ? ` · ${timeOf(event.occurredAt)}` : ""}
        </p>
        <p
          className={cn(
            "mt-1 whitespace-pre-wrap text-[13px] text-foreground",
            event.retracted ? "line-through decoration-muted-foreground/60" : "",
          )}
        >
          {event.title}
        </p>
        {event.body ? (
          <p className="mt-1 line-clamp-[12] whitespace-pre-wrap text-[13px] text-muted-foreground">
            {event.body}
          </p>
        ) : null}
        {event.source ? (
          <p className="mt-1.5 text-[11px] text-muted-foreground">{event.source}</p>
        ) : null}
        {touchId && (onEdit || onRetract || onRestore) ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {!event.retracted && onEdit ? (
              <button
                type="button"
                onClick={() => onEdit(touchId)}
                className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Edit
              </button>
            ) : null}
            {!event.retracted && onRetract ? (
              <button
                type="button"
                onClick={() => onRetract(touchId)}
                className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Retract
              </button>
            ) : null}
            {event.retracted && onRestore ? (
              <button
                type="button"
                onClick={() => onRestore(touchId)}
                className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Restore
              </button>
            ) : null}
          </div>
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
  onAddInteraction,
  onEditTouch,
  onRetractTouch,
  onRestoreTouch,
  children,
}: {
  relationship: Relationship;
  days: ConversationDay[];
  health: ConversationHealth;
  onViewProfile: () => void;
  onOpenContext?: () => void;
  onAddInteraction?: () => void;
  onEditTouch?: (touchId: string) => void;
  onRetractTouch?: (touchId: string) => void;
  onRestoreTouch?: (touchId: string) => void;
  children?: React.ReactNode;
}) {
  const chips = [
    INTENT_LABEL[effectiveIntent(relationship)],
    STAGE_LABEL[relationship.stage],
    SOURCE_LABEL[relationship.source],
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
                {HEALTH_LABEL[health.status]}
              </span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {onAddInteraction ? (
            <button
              type="button"
              onClick={onAddInteraction}
              className="rounded-md border border-border bg-card px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              + Add interaction
            </button>
          ) : null}
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
            Nothing is on the record yet. Add an interaction that already happened, or prepare the
            first message below.
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
                  <ConversationEvent
                    key={event.id}
                    event={event}
                    {...(onEditTouch ? { onEdit: onEditTouch } : {})}
                    {...(onRetractTouch ? { onRetract: onRetractTouch } : {})}
                    {...(onRestoreTouch ? { onRestore: onRestoreTouch } : {})}
                  />
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
