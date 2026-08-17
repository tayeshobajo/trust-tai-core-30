/**
 * The context rail.
 *
 * Deliberately secondary: a few compact cards that answer "why does this matter
 * and what happens next", with everything else behind a disclosure.
 */

import { useState } from "react";

import {
  CADENCE_LABEL,
  HEALTH_LABEL,
  MOMENTUM_LABEL,
  NEXT_MOVE_LABEL,
  STRENGTH_LABEL,
  WAITING_LABEL,
  type ConversationHealth,
  type RelationshipStrengthRead,
} from "@/domain/comms-health";
import { REASON_LABEL, type CommsDraft, type Relationship } from "@/domain/comms";
import type { ReminderCandidate } from "@/data/comms-reminders";
import { TTButton, TTInput } from "@/components/tt/primitives";
import { cn } from "@/lib/utils";

import { HealthDot } from "./health-marks";

function Card({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="tt-eyebrow">{title}</p>
        {action}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Factor({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      <span className="text-right text-[12px] text-foreground">{value}</span>
    </div>
  );
}

function relative(value?: string): string {
  if (!value) return "None yet";
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(value).toLocaleDateString();
}

export function ConversationHealthCard({ health }: { health: ConversationHealth }) {
  const [open, setOpen] = useState(false);
  return (
    <Card
      title="Conversation health"
      action={
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? "Hide" : "View"}
        </button>
      }
    >
      <p className="flex items-center gap-2 text-[13px] text-foreground">
        <HealthDot status={health.status} />
        {HEALTH_LABEL[health.status]}
        <span className="font-mono text-[10px] text-muted-foreground">{health.score}/100</span>
      </p>
      <p className="mt-1.5 text-[12px] text-muted-foreground">{health.reasons[0]}</p>

      {open ? (
        <div className="mt-2.5 border-t border-border pt-2">
          <Factor label="Last reply" value={relative(health.lastReplyAt)} />
          <Factor label="Cadence" value={CADENCE_LABEL[health.responseCadence]} />
          <Factor label="Next step" value={NEXT_MOVE_LABEL[health.nextMoveStatus]} />
          <Factor label="Momentum" value={MOMENTUM_LABEL[health.momentum]} />
          <Factor label="Waiting on" value={WAITING_LABEL[health.waitingOn]} />
          {health.reasons.length > 1 ? (
            <ul className="mt-2 space-y-1">
              {health.reasons.slice(1).map((reason) => (
                <li key={reason} className="text-[12px] text-muted-foreground">
                  {reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

export function RelationshipStrength({ strength }: { strength: RelationshipStrengthRead }) {
  const [open, setOpen] = useState(false);
  return (
    <Card
      title="Relationship strength"
      action={
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? "Hide" : "View"}
        </button>
      }
    >
      <p className="text-[13px] text-foreground">
        {STRENGTH_LABEL[strength.band]}
        <span className="ml-2 font-mono text-[10px] text-muted-foreground">
          {strength.score}/100
        </span>
      </p>
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-foreground/70"
          style={{ width: `${strength.score}%` }}
        />
      </div>
      {open ? (
        <div className="mt-2.5 border-t border-border pt-2">
          {strength.factors.map((factor) => (
            <Factor key={factor.label} label={factor.label} value={factor.value} />
          ))}
        </div>
      ) : null}
    </Card>
  );
}

export function ConversationContext({
  relationship,
  health,
  strength,
  reasons,
  savedDraft,
  busy,
  onNextAction,
  onOpenDraft,
  className,
}: {
  relationship: Relationship;
  health: ConversationHealth;
  strength: RelationshipStrengthRead;
  reasons: ReminderCandidate[];
  savedDraft?: CommsDraft | undefined;
  busy?: boolean;
  onNextAction: (value: string) => void;
  onOpenDraft?: (draft: CommsDraft) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [nextAction, setNextAction] = useState(relationship.nextAction ?? "");
  const known = [...relationship.decided, ...relationship.observed].slice(0, 3);
  const tags = [...relationship.observed, ...relationship.inferred]
    .map((item) => item.label)
    .filter((label, index, list) => list.indexOf(label) === index)
    .slice(0, 5);

  return (
    <div className={cn("min-h-0 flex-1 space-y-3 overflow-y-auto p-3", className)}>
      <Card title="Reason to reach out">
        {reasons.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">
            Nothing true has changed. This conversation can sit quietly until it does.
          </p>
        ) : (
          <>
            <p className="text-[13px] text-foreground">
              {REASON_LABEL[reasons[0]!.reasonCode]}
            </p>
            <p className="mt-1 text-[12px] text-muted-foreground">{reasons[0]!.reasonText}</p>
            {reasons.length > 1 ? (
              <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                +{reasons.length - 1} more
              </p>
            ) : null}
          </>
        )}
      </Card>

      <Card title="What we know">
        {known.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">Nothing on record yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {known.map((item, index) => (
              <li key={`${item.label}-${index}`} className="text-[12px] text-muted-foreground">
                <span className="text-foreground">{item.label}:</span> {item.value}
              </li>
            ))}
          </ul>
        )}
        {tags.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </Card>

      <Card
        title="Next move"
        action={
          <button
            type="button"
            onClick={() => setEditing((value) => !value)}
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {editing ? "Cancel" : "Edit"}
          </button>
        }
      >
        {editing ? (
          <div className="space-y-2">
            <TTInput
              className="h-9"
              value={nextAction}
              onChange={(event) => setNextAction(event.target.value)}
              placeholder="What happens next?"
              aria-label="Next move"
            />
            <TTButton
              disabled={busy}
              onClick={() => {
                onNextAction(nextAction.trim());
                setEditing(false);
              }}
            >
              Save
            </TTButton>
          </div>
        ) : (
          <p className="text-[12px] text-muted-foreground">
            {relationship.nextAction?.trim() || "No next move set."}
          </p>
        )}
      </Card>

      {savedDraft ? (
        <Card
          title="Saved draft"
          action={
            onOpenDraft ? (
              <button
                type="button"
                onClick={() => onOpenDraft(savedDraft)}
                className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                View
              </button>
            ) : undefined
          }
        >
          <p className="text-[13px] text-foreground">
            {savedDraft.subject?.trim() || savedDraft.intent}
          </p>
          <p className="mt-1 line-clamp-3 text-[12px] text-muted-foreground">{savedDraft.body}</p>
        </Card>
      ) : null}

      <ConversationHealthCard health={health} />
      <RelationshipStrength strength={strength} />
    </div>
  );
}
