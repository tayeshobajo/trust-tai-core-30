/**
 * Relationship intelligence, in the order a person actually asks for it.
 *
 *   A. Why this relationship matters
 *   B. What we know
 *   C. Next relationship move
 *   D. Conversation health
 *   E. Relationship strength
 *   F. Promises and commitments
 *
 * Health answers "does this conversation need attention". Strength answers
 * "how much real history exists". They are deliberately separate, and neither
 * is allowed to invent what it has not seen.
 */

import { useState } from "react";

import { TTButton } from "@/components/tt/primitives";
import type { NextRelationshipMove } from "@/data/comms-next-move";
import type { Relationship } from "@/domain/comms";
import { canMoveToNurture, relationshipSegment, TIER_LABEL } from "@/domain/comms";
import type { ConversationHealth, RelationshipStrengthRead } from "@/domain/comms-health";
import {
  COMMITMENT_OWNER_LABEL,
  commitmentsOf,
  effectiveIntent,
  INTENT_LABEL,
  INTENT_RHYTHM_LABEL,
  isCommitment,
  type Commitment,
} from "@/domain/comms-interactions";

import { ConversationHealthCard, RelationshipStrength } from "./conversation-context";

function RailCard({
  letter,
  title,
  action,
  children,
}: {
  letter: string;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="tt-eyebrow">
          <span className="text-muted-foreground/70">{letter}</span> {title}
        </p>
        {action}
      </div>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

function dateLabel(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/* -------------------------------------------------------- A. why it matters */

function WhyItMatters({
  relationship,
  onGraduate,
}: {
  relationship: Relationship;
  onGraduate?: () => void;
}) {
  const intent = effectiveIntent(relationship);
  const decided = relationship.decided.find((item) => !isCommitment(item));
  const segment = relationshipSegment(relationship);

  return (
    <RailCard
      letter="A."
      title="Why this relationship matters"
      action={
        segment === "nurture" && onGraduate ? (
          <TTButton variant="quiet" size="sm" type="button" onClick={onGraduate}>
            Mark as client
          </TTButton>
        ) : null
      }
    >
      <p className="text-[13px] text-foreground">
        {decided?.value ??
          `${INTENT_LABEL[intent]} relationship${relationship.companyName ? ` at ${relationship.companyName}` : ""}.`}
      </p>
      <p className="mt-1.5 text-[12px] text-muted-foreground">
        {INTENT_RHYTHM_LABEL[intent]}
        {segment === "nurture"
          ? " In Nurture — a relationship Trust Tai chose to develop."
          : ""}
      </p>
    </RailCard>
  );
}

/* --------------------------------------------------------- B. what we know */

function WhatWeKnow({
  relationship,
  onRemember,
}: {
  relationship: Relationship;
  onRemember?: () => void;
}) {
  const items = [...relationship.decided, ...relationship.observed, ...relationship.inferred]
    .filter((item) => !isCommitment(item))
    .slice(0, 6);

  return (
    <RailCard
      letter="B."
      title="What we know"
      action={
        onRemember ? (
          <TTButton variant="quiet" size="sm" type="button" onClick={onRemember}>
            Remember this
          </TTButton>
        ) : null
      }
    >
      {items.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Nothing is remembered yet. Add how you met or what they care about, and it stays here.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((item, index) => (
            <li key={`${item.label}-${index}`}>
              <p className="tt-eyebrow">
                {item.category ?? item.label} · {TIER_LABEL[item.tier]}
              </p>
              <p className="mt-0.5 text-[13px] text-foreground">{item.value}</p>
              {item.addedBy ? (
                <p className="text-[12px] text-muted-foreground">{item.addedBy}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </RailCard>
  );
}

/* --------------------------------------------------------- C. the next move */

function NextMoveCard({
  move,
  onPrepare,
  onRemindLater,
  onNotNeeded,
}: {
  move: NextRelationshipMove;
  onPrepare?: () => void;
  onRemindLater?: () => void;
  onNotNeeded?: () => void;
}) {
  return (
    <section
      className={
        move.needed
          ? "rounded-xl border border-royal/25 bg-royal/5 p-4"
          : "rounded-xl border border-border bg-card p-4"
      }
    >
      <p className="tt-eyebrow">
        <span className="text-muted-foreground/70">C.</span> Next relationship move
      </p>
      <p className="mt-2 text-[15px] text-foreground">{move.action}</p>
      <dl className="mt-2.5 space-y-1.5">
        <div>
          <dt className="tt-eyebrow">Why now</dt>
          <dd className="text-[13px] text-muted-foreground">{move.whyNow}</dd>
        </div>
        <div>
          <dt className="tt-eyebrow">Goal</dt>
          <dd className="text-[13px] text-muted-foreground">{move.goal}</dd>
        </div>
      </dl>
      {move.needed ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {onPrepare ? (
            <TTButton size="sm" type="button" onClick={onPrepare}>
              Prepare {move.urgency === "now" ? "this" : "check-in"}
            </TTButton>
          ) : null}
          {onRemindLater ? (
            <TTButton variant="quiet" size="sm" type="button" onClick={onRemindLater}>
              Remind me later
            </TTButton>
          ) : null}
          {onNotNeeded ? (
            <TTButton variant="quiet" size="sm" type="button" onClick={onNotNeeded}>
              Not needed
            </TTButton>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/* --------------------------------------------------------------- F. promises */

function CommitmentRow({
  commitment,
  onSettle,
}: {
  commitment: Commitment;
  onSettle?: (commitment: Commitment, status: "kept" | "released") => void;
}) {
  const due = dateLabel(commitment.due);
  return (
    <li className="rounded-lg border border-border p-2.5">
      <p className="text-[13px] text-foreground">{commitment.text}</p>
      <p className="mt-0.5 text-[12px] text-muted-foreground">
        {COMMITMENT_OWNER_LABEL[commitment.owner]}
        {due ? ` · due ${due}` : " · no date set"}
        {commitment.status !== "open" ? ` · ${commitment.status}` : ""}
      </p>
      {commitment.status === "open" && onSettle ? (
        <div className="mt-1.5 flex gap-2">
          <TTButton variant="quiet" size="sm" type="button" onClick={() => onSettle(commitment, "kept")}>
            Kept
          </TTButton>
          <TTButton
            variant="quiet"
            size="sm"
            type="button"
            onClick={() => onSettle(commitment, "released")}
          >
            Released
          </TTButton>
        </div>
      ) : null}
    </li>
  );
}

function Promises({
  relationship,
  onSettle,
}: {
  relationship: Relationship;
  onSettle?: (commitment: Commitment, status: "kept" | "released") => void;
}) {
  const [showSettled, setShowSettled] = useState(false);
  const all = commitmentsOf(relationship);
  const open = all.filter((entry) => entry.status === "open");
  const shown = showSettled ? all : open;

  return (
    <RailCard
      letter="F."
      title="Promises and commitments"
      action={
        all.length > open.length ? (
          <TTButton
            variant="quiet"
            size="sm"
            type="button"
            onClick={() => setShowSettled((value) => !value)}
          >
            {showSettled ? "Open only" : "Show settled"}
          </TTButton>
        ) : null
      }
    >
      {shown.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Nothing is promised in either direction.
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((commitment) => (
            <CommitmentRow key={commitment.id} commitment={commitment} {...(onSettle ? { onSettle } : {})} />
          ))}
        </ul>
      )}
    </RailCard>
  );
}

/* ------------------------------------------------------------------- rail */

export function RelationshipRail({
  relationship,
  health,
  strength,
  move,
  onRemember,
  onPrepareMove,
  onRemindLater,
  onNotNeeded,
  onSettleCommitment,
  onGraduate,
}: {
  relationship: Relationship;
  health: ConversationHealth;
  strength: RelationshipStrengthRead;
  move: NextRelationshipMove;
  onRemember?: () => void;
  onPrepareMove?: () => void;
  onRemindLater?: () => void;
  onNotNeeded?: () => void;
  onSettleCommitment?: (commitment: Commitment, status: "kept" | "released") => void;
  /**
   * Nurture → Clients. A stage change on the same record: every thread,
   * promise, memory, and Scout provenance stays exactly where it is.
   */
  onGraduate?: () => void;
}) {
  return (
    <div className="space-y-3">
      <WhyItMatters relationship={relationship} {...(onGraduate ? { onGraduate } : {})} />
      <WhatWeKnow relationship={relationship} {...(onRemember ? { onRemember } : {})} />
      <NextMoveCard
        move={move}
        {...(onPrepareMove ? { onPrepare: onPrepareMove } : {})}
        {...(onRemindLater ? { onRemindLater } : {})}
        {...(onNotNeeded ? { onNotNeeded } : {})}
      />
      <ConversationHealthCard health={health} />
      <RelationshipStrength strength={strength} />
      <Promises relationship={relationship} {...(onSettleCommitment ? { onSettle: onSettleCommitment } : {})} />
    </div>
  );
}
