/**
 * The relationship room.
 *
 * The heart of Comms: one relationship, read top to bottom. Their words on the
 * left, ours on the right, calls, meetings, notes and suggestions inline where
 * they happened. Each event says what it was, when it was, and, when it
 * matters, who put it on the record.
 *
 * Inbox finds the person; conversation owns the room. The header stays
 * compact — who this is, how it stands, and the few actions that matter —
 * and relationship intelligence lives one click away in the context drawer,
 * never as a permanent tax on reading width.
 */

import { FileText } from "lucide-react";

import {
  EVENT_LABEL,
  eventSide,
  type ConversationDay,
  type ConversationEvent as EventShape,
} from "@/data/comms-timeline";
import { initialsOf } from "@/domain/steward-accountability";
import { HEALTH_LABEL, type ConversationHealth } from "@/domain/comms-health";
import { STAGE_LABEL, type Relationship } from "@/domain/comms";
import { effectiveIntent, INTENT_LABEL } from "@/domain/comms-interactions";
import type { AttachmentMeta } from "@/domain/comms-integrations";
import { formatBytes } from "@/domain/comms-mime";
import { cn } from "@/lib/utils";

import { EmailBodyView, fileAttachments } from "./email-body";
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
  organizationId,
  onEdit,
  onRetract,
  onRestore,
  onDownloadAttachment,
}: {
  event: EventShape;
  /** The workspace — the access handle for inline images in email bodies. */
  organizationId?: string;
  onEdit?: (touchId: string) => void;
  onRetract?: (touchId: string) => void;
  onRestore?: (touchId: string) => void;
  onDownloadAttachment?: (event: EventShape, attachment: AttachmentMeta) => void;
}) {
  const side = eventSide(event.kind);
  const touchId = event.touchId;
  // A synced email shows the actual message — full body, inline images in
  // place, quoted history behind a toggle — never a clamped snippet.
  const isEmail = Boolean(event.messageId) && (event.kind === "we_emailed" || event.kind === "they_emailed");
  const chips = fileAttachments(event.attachments);

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
          side === "center" ? "w-full max-w-[92%] rounded-lg" : "max-w-[85%]",
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
        {isEmail && organizationId && event.messageId ? (
          <EmailBodyView
            organizationId={organizationId}
            messageId={event.messageId}
            {...(event.body ? { text: event.body } : {})}
            {...(event.htmlBody ? { html: event.htmlBody } : {})}
            inline={(event.attachments ?? []).filter((file) => file.inline)}
          />
        ) : event.body ? (
          <p className="mt-1 whitespace-pre-wrap break-words text-[13px] text-muted-foreground">
            {event.body}
          </p>
        ) : null}
        {chips.length ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((file) => {
              const downloadable = Boolean(event.messageId && file.attachmentId);
              return (
                <li key={`${file.filename}:${file.size}`}>
                  <button
                    type="button"
                    disabled={!downloadable || !onDownloadAttachment}
                    onClick={() => onDownloadAttachment?.(event, file)}
                    title={downloadable ? "Open from Gmail" : `${file.filename} · ${formatBytes(file.size)}`}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground",
                      downloadable && onDownloadAttachment
                        ? "transition-colors hover:border-royal/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        : "cursor-default",
                    )}
                  >
                    <FileText className="h-3 w-3" aria-hidden />
                    <span className="max-w-[180px] truncate">{file.filename}</span>
                    <span className="text-[10px] opacity-70">{formatBytes(file.size)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
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
  organizationId,
  onViewProfile,
  onOpenContext,
  onAddInteraction,
  onExportSummary,
  onEditTouch,
  onRetractTouch,
  onRestoreTouch,
  onDownloadAttachment,
  children,
}: {
  relationship: Relationship;
  days: ConversationDay[];
  health: ConversationHealth;
  /** The workspace — resolves inline images and attachment downloads. */
  organizationId?: string;
  onViewProfile: () => void;
  onOpenContext?: () => void;
  onAddInteraction?: () => void;
  onExportSummary?: () => void;
  onEditTouch?: (touchId: string) => void;
  onRetractTouch?: (touchId: string) => void;
  onRestoreTouch?: (touchId: string) => void;
  onDownloadAttachment?: (event: EventShape, attachment: AttachmentMeta) => void;
  children?: React.ReactNode;
}) {
  // One quiet row: what this relationship is for, where it stands, how the
  // conversation is doing. Provenance and the rest live in the context drawer.
  const chips = [
    INTENT_LABEL[effectiveIntent(relationship)],
    STAGE_LABEL[relationship.stage],
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-2.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary font-mono text-[12px] text-muted-foreground"
          >
            {initialsOf(relationship.fullName)}
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
            <div className="mt-1 flex flex-nowrap items-center gap-1.5 overflow-hidden">
              {chips.map((chip) => (
                <span
                  key={chip}
                  className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  {chip}
                </span>
              ))}
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                <HealthDot status={health.status} />
                {HEALTH_LABEL[health.status]}
              </span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {onAddInteraction ? (
            <button
              type="button"
              onClick={onAddInteraction}
              className="rounded-md border border-border bg-card px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              + Add interaction
            </button>
          ) : null}
          {onExportSummary ? (
            <button
              type="button"
              onClick={onExportSummary}
              className="rounded-md border border-border bg-card px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Export summary
            </button>
          ) : null}
          {onOpenContext ? (
            <button
              type="button"
              onClick={onOpenContext}
              className="rounded-md border border-border px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        {/* The thread gets the room the third rail released, held to a
            readable column rather than stretched edge to edge. */}
        <div className="mx-auto w-full max-w-[880px] space-y-6">
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
                      {...(organizationId ? { organizationId } : {})}
                      {...(onEditTouch ? { onEdit: onEditTouch } : {})}
                      {...(onRetractTouch ? { onRetract: onRetractTouch } : {})}
                      {...(onRestoreTouch ? { onRestore: onRestoreTouch } : {})}
                      {...(onDownloadAttachment
                        ? { onDownloadAttachment: onDownloadAttachment }
                        : {})}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>

      {children}
    </div>
  );
}
