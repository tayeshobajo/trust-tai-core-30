/**
 * The one decision this page is asking for.
 *
 * The move itself is computed in `data/scout/recommended-move.ts`; this card
 * only makes the state unmistakable and carries the explicit human action.
 * One move, one clear reason, one primary action, the card ends shortly
 * after its action row, and "Why this move" holds concise supporting
 * evidence, never a second prose interpretation.
 *
 * When the first message is gated, the one action opens a guided flow: each
 * blocker with its own next step, honest progress as each clears, and an
 * automatic continuation to the first message once the way in is clear.
 * Nothing sends automatically.
 */

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

import { ConfidenceChip, Panel } from "@/components/tt/prospect/panel";
import { TTButton } from "@/components/tt/primitives";
import {
  advanceAfterBlockers,
  blockerProgress,
  type MoveBlocker,
} from "@/data/scout/move-blockers";
import type { RecommendedMoveAction, RecommendedNextMove } from "@/data/scout/recommended-move";
import type { ConfidenceLevel } from "@/domain/confidence";
import type { Person } from "@/domain/people";
import type { WatchState } from "@/domain/relationship-development";
import type { ProspectCandidate } from "@/domain/scout";
import { cn } from "@/lib/utils";

export function RecommendedNextMoveCard({
  move,
  candidate,
  blockers = [],
  busy,
  preparingBrief,
  prepareError,
  firstMessageReady,
  routingFirstMessage = false,
  confirmingEmailId = null,
  confirmedEmailId = null,
  confirmEmailError = null,
  researchPending = false,
  confidenceLevel,
  onPrimary,
  onPrepareFirstMessage,
  onPrepareBrief,
  onConfirmEmail,
  onRunResearch,
  onOpenPeople,
  onWatch,
  onSeeResearch,
}: {
  move: RecommendedNextMove;
  candidate: ProspectCandidate;
  /** The live blockers between this company and a safe first message. */
  blockers?: MoveBlocker[];
  busy?: boolean;
  /** True while governed relationship research is being prepared. */
  preparingBrief?: boolean;
  /** Inline failure for the prepare-research action; retry stays in place. */
  prepareError?: string | null;
  /** Whether the handoff behind "Prepare first message" is safe today. */
  firstMessageReady: boolean;
  /** True while the approved brief is being carried into Comms. */
  routingFirstMessage?: boolean;
  /** The person whose address confirmation is being recorded. */
  confirmingEmailId?: string | null;
  /** The person whose confirmation just saved, while the read catches up. */
  confirmedEmailId?: string | null;
  /** Inline failure for the confirm action, bound to the person it concerns. */
  confirmEmailError?: { personId: string; message: string } | null;
  /** True while the governed company research pass is running. */
  researchPending?: boolean;
  /** How sure the underlying read is, shown quietly inside "Why this move". */
  confidenceLevel?: ConfidenceLevel | undefined;
  onPrimary: (kind: RecommendedMoveAction) => void;
  onPrepareFirstMessage: () => void;
  onPrepareBrief: (force: boolean) => void;
  /** The governed confirmation that a found address is real. */
  onConfirmEmail: (person: Person) => void;
  /** The governed company research pass. */
  onRunResearch: () => void;
  /** Moves to the canonical People area and focuses the blocker section. */
  onOpenPeople: () => void;
  onWatch: (watch: WatchState | null) => void;
  onSeeResearch: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [flow, setFlow] = useState<{ total: number } | null>(null);
  const [confirmedIds, setConfirmedIds] = useState<ReadonlySet<string>>(new Set());
  const canAct = move.primary.kind !== "none";
  const progress = blockerProgress(flow?.total ?? blockers.length, blockers.length);

  // A different company restarts the decision surface.
  useEffect(() => {
    setConfirming(false);
    setFlow(null);
    setConfirmedIds(new Set());
  }, [candidate.prospect.id]);

  // A saved confirmation is acknowledged in place until the refreshed read
  // clears the blocker, a click that changed governed state never looks
  // like nothing happened.
  useEffect(() => {
    if (!confirmedEmailId) return;
    setConfirmedIds((prev) =>
      prev.has(confirmedEmailId) ? prev: new Set(prev).add(confirmedEmailId),
    );
  }, [confirmedEmailId]);

  // Once the re-read no longer lists a person as blocked, the acknowledgement
  // has done its job and leaves with the blocker.
  useEffect(() => {
    setConfirmedIds((prev) => {
      if (prev.size === 0) return prev;
      const stillBlocked = new Set(
        blockers
.map((blocker) => blocker.person?.id)
.filter((id): id is string => Boolean(id)),
      );
      const next = new Set([...prev].filter((id) => stillBlocked.has(id)));
      return next.size === prev.size ? prev: next;
    });
  }, [blockers]);

  // The final blocker clears through the evidence, not through a click: once
  // the move offers the first message, the flow hands over to it directly.
  useEffect(() => {
    if (
      advanceAfterBlockers({
        flowOpen: flow !== null,
        firstMessageReady,
        primaryKind: move.primary.kind,
      })
    ) {
      setFlow(null);
      setConfirming(true);
    }
  }, [flow, firstMessageReady, move.primary.kind]);

  const runPrimary = () => {
    if (move.primary.kind === "prepare_research") {
      onPrepareBrief(move.prepareForce);
      return;
    }
    if (move.primary.kind === "prepare_first_message") {
      if (firstMessageReady) setConfirming(true);
      else setFlow({ total: Math.max(blockers.length, 1) });
      return;
    }
    if (move.primary.kind === "resolve_blockers") {
      setFlow({ total: Math.max(blockers.length, 1) });
      return;
    }
    if (move.primary.kind === "confirm_email") {
      // The one action IS the governed confirmation: act on the person the
      // lone unverified-address blocker concerns, with the same pending and
      // acknowledgement feedback the guided flow gives.
      const blocker = blockers.find(
        (entry) => entry.action.kind === "confirm_email" && entry.person,
      );
      if (blocker?.person) onConfirmEmail(blocker.person);
      return;
    }
    onPrimary(move.primary.kind);
  };

  const runBlockerAction = (blocker: MoveBlocker) => {
    if (blocker.action.kind === "confirm_email" && blocker.person) {
      onConfirmEmail(blocker.person);
      return;
    }
    if (blocker.action.kind === "run_research") {
      onRunResearch();
      return;
    }
    onOpenPeople();
  };

  return (
    <Panel
      eyebrow="Recommended next move"
      title={move.label}
      aside={<StatusTag state={move.state} />}
      emphasis="primary"
      className={cn(preparingBrief && "ring-1 ring-royal/25")}
    >
      <div className="space-y-5">
        <ProgressStrip stages={move.progress} />

        {preparingBrief ? (
          <div
            role="status"
            aria-live="polite"
            className="rounded-xl border border-royal/25 bg-royal/8 p-4"
          >
            <div className="flex items-center gap-3">
              <span aria-hidden className="size-2 animate-pulse rounded-full bg-royal" />
              <p className="text-sm font-medium text-foreground">
                Preparing relationship research…
              </p>
            </div>
            <div
              aria-hidden
              className="mt-3 h-1 overflow-hidden rounded-full bg-secondary"
            >
              <span className="block h-full w-1/3 rounded-full bg-royal animate-[tt-progress-indeterminate_1.2s_ease-in-out_infinite]" />
            </div>
            <p className="mt-3 text-[13px] text-muted-foreground">
              Scout is reading the stored public evidence and refreshing the brief. Nothing is
              being sent.
            </p>
          </div>
        ): null}

        <div>
          <h3 className="max-w-[28ch] text-[22px] font-semibold leading-tight tracking-tight text-foreground">
            {move.headline}
          </h3>
          <p className="mt-2 max-w-reading text-[15px] leading-7 text-foreground">
            {move.reason}
          </p>
          {move.person ? (
            <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              Person on record · {move.person.fullName}
              {move.person.roleTitle ? ` · ${move.person.roleTitle}`: ""}
            </p>
          ): null}
        </div>

        {move.whyNow ? (
          <div className="rounded-xl border border-royal/25 bg-royal/8 px-4 py-3">
            <p className="tt-eyebrow text-royal">Why now</p>
            <p className="mt-1 text-sm text-foreground">{move.whyNow}</p>
          </div>
        ): null}

        {move.watch ? (
          <div className="rounded-xl border border-border bg-surface-tertiary px-4 py-3">
            <p className="text-sm text-foreground">
              {move.watch === "watching"
                ? "Watching for a real dated signal."
: "Marked not now. The research stays; nothing is owed."}
            </p>
          </div>
        ): null}

        {prepareError ? (
          <div
            role="alert"
            className="rounded-xl border border-destructive/30 bg-destructive/8 p-4"
          >
            <p className="text-sm font-medium text-foreground">Research was not prepared.</p>
            <p className="mt-1 text-[13px] text-muted-foreground">{prepareError}</p>
            <div className="mt-3">
              <TTButton
                variant="secondary"
                size="sm"
                pending={preparingBrief}
                pendingLabel="Retrying…"
                disabled={busy}
                onClick={() => onPrepareBrief(move.prepareForce)}
              >
                Retry
              </TTButton>
            </div>
          </div>
        ): null}

        {move.evidence.length > 0 ? (
          <details className="group rounded-xl border border-border bg-surface-tertiary px-4 py-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[13px] font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Why this move
              <span className="flex items-center gap-2">
                {confidenceLevel ? <ConfidenceChip level={confidenceLevel} />: null}
                <ChevronDown
                  aria-hidden
                  className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
                />
              </span>
            </summary>
            <ul className="mt-3 space-y-2 border-t border-border pt-3">
              {move.evidence.map((item, index) => (
                <li key={`${item.label}-${index}`} className="text-[13px] text-muted-foreground">
                  {item.url ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-royal underline-offset-4 hover:underline"
                    >
                      {item.label}
                    </a>
                  ): (
                    item.label
                  )}
                </li>
              ))}
            </ul>
          </details>
        ): null}

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-5">
          {canAct ? (
            move.primary.kind === "confirm_email" && confirmedIds.size > 0 ? (
              <p
                role="status"
                aria-live="polite"
                className="inline-flex items-center rounded-lg border border-success/25 bg-success/8 px-3 py-2 text-sm font-medium text-success"
              >
                Address confirmed, refreshing the read.
              </p>
            ): (
              <TTButton
                pending={
                  (preparingBrief && move.primary.kind === "prepare_research") ||
                  (move.primary.kind === "confirm_email" && confirmingEmailId !== null)
                }
                pendingLabel={
                  move.primary.kind === "confirm_email"
                    ? "Confirming…"
: "Preparing relationship research…"
                }
                disabled={busy || (preparingBrief && move.primary.kind !== "prepare_research")}
                onClick={runPrimary}
              >
                {move.primary.label}
              </TTButton>
            )
          ): null}

          {move.primary.kind === "confirm_email" && confirmEmailError ? (
            <p role="alert" className="text-[13px] text-destructive">
              {confirmEmailError.message}
            </p>
          ): null}

          {move.state === "no_urgency" || move.state === "act_now" ? (
            <>
              <TTButton
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => onWatch("watching")}
              >
                Watch for a signal
              </TTButton>
              <TTButton
                variant="quiet"
                size="sm"
                disabled={busy}
                onClick={() => onWatch("not_now")}
              >
                Not now
              </TTButton>
            </>
          ): null}

          {move.watch ? (
            <TTButton
              variant="quiet"
              size="sm"
              disabled={busy}
              onClick={() => onWatch(null)}
            >
              Clear pacing
            </TTButton>
          ): null}

          <TTButton variant="quiet" size="sm" onClick={onSeeResearch}>
            Open research
          </TTButton>
        </div>

        {flow ? (
          <div
            role="region"
            aria-label="Resolve the way in"
            className="rounded-xl border border-royal/25 bg-royal/8 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-medium text-foreground">Resolve the way in</p>
              <p
                role="status"
                aria-live="polite"
                className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground"
              >
                {progress.resolved} of {progress.total} resolved
              </p>
            </div>

            {blockers.length > 0 ? (
              <ul className="mt-3 space-y-3">
                {blockers.map((blocker) => {
                  const personId = blocker.person?.id;
                  const acknowledged =
                    blocker.action.kind === "confirm_email" &&
                    personId !== undefined &&
                    confirmedIds.has(personId);
                  const failure =
                    blocker.action.kind === "confirm_email" &&
                    personId !== undefined &&
                    confirmEmailError?.personId === personId
                      ? confirmEmailError
: null;
                  return (
                    <li
                      key={blocker.key}
                      className="rounded-lg border border-border bg-background p-3"
                    >
                      <p className="text-[13px] font-medium text-foreground">{blocker.message}</p>
                      <p className="mt-1 text-[13px] text-muted-foreground">{blocker.detail}</p>
                      <div className="mt-2">
                        {acknowledged ? (
                          <p
                            role="status"
                            aria-live="polite"
                            className="inline-flex items-center rounded-lg border border-success/25 bg-success/8 px-3 py-1.5 text-[13px] font-medium text-success"
                          >
                            Address confirmed, refreshing the read.
                          </p>
                        ): (
                          <TTButton
                            variant="secondary"
                            size="sm"
                            pending={
                              (blocker.action.kind === "confirm_email" &&
                                confirmingEmailId === personId) ||
                              (blocker.action.kind === "run_research" && researchPending)
                            }
                            pendingLabel={
                              blocker.action.kind === "confirm_email"
                                ? "Confirming…"
: "Reading the public pages…"
                            }
                            disabled={busy}
                            onClick={() => runBlockerAction(blocker)}
                          >
                            {blocker.action.label}
                          </TTButton>
                        )}
                      </div>
                      {failure ? (
                        <div
                          role="alert"
                          className="mt-2 rounded-lg border border-destructive/30 bg-destructive/8 p-3"
                        >
                          <p className="text-[13px] font-medium text-foreground">
                            The confirmation was not saved.
                          </p>
                          <p className="mt-1 text-[13px] text-muted-foreground">
                            {failure.message}
                          </p>
                          <div className="mt-2">
                            <TTButton
                              variant="secondary"
                              size="sm"
                              disabled={busy}
                              onClick={() => runBlockerAction(blocker)}
                            >
                              Retry
                            </TTButton>
                          </div>
                        </div>
                      ): null}
                    </li>
                  );
                })}
              </ul>
            ): (
              <p className="mt-3 text-[13px] text-muted-foreground">
                The way in is clear. The recommendation above has the next move.
              </p>
            )}

            <div className="mt-4">
              <TTButton variant="quiet" size="sm" disabled={busy} onClick={() => setFlow(null)}>
                Back to the recommendation
              </TTButton>
            </div>
          </div>
        ): null}

        {confirming &&
        move.primary.kind === "prepare_first_message" &&
        firstMessageReady ? (
          <div className="rounded-xl border border-royal/25 bg-royal/8 p-4">
            <p className="text-sm font-medium text-foreground">
              Carry {candidate.prospect.name} into Comms?
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Comms will prepare the first message for your review. Nothing is sent
              automatically, and sending is always your click.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <TTButton
                size="sm"
                pending={routingFirstMessage}
                pendingLabel="Carrying to Comms…"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  onPrepareFirstMessage();
                }}
              >
                Prepare first message
              </TTButton>
              <TTButton
                variant="quiet"
                size="sm"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Stay in Scout
              </TTButton>
            </div>
          </div>
        ): null}
      </div>
    </Panel>
  );
}

/**
 * The quiet "where am I" strip: Match → Person → Research → First message.
 * Completed, current, upcoming, never a wizard, never interactive.
 */
function ProgressStrip({ stages }: { stages: RecommendedNextMove["progress"] }) {
  return (
    <ol
      aria-label="Where this relationship stands"
      className="flex flex-wrap items-center gap-x-2 gap-y-1.5"
    >
      {stages.map((stage, index) => (
        <li key={stage.key} className="flex items-center gap-2">
          {index > 0 ? (
            <span aria-hidden className="h-px w-4 bg-border" />
          ): null}
          <span
            aria-current={stage.state === "current" ? "step": undefined}
            className={cn(
              "inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em]",
              stage.state === "complete" && "text-success",
              stage.state === "current" && "font-medium text-foreground",
              stage.state === "upcoming" && "text-muted-foreground/60",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "size-1.5 rounded-full",
                stage.state === "complete" && "bg-success",
                stage.state === "current" && "bg-royal",
                stage.state === "upcoming" && "bg-border",
              )}
            />
            {stage.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function StatusTag({ state }: { state: RecommendedNextMove["state"] }) {
  const tone =
    state === "act_now"
      ? "border-royal/30 bg-royal/8 text-royal"
: state === "in_comms"
        ? "border-success/25 bg-success/8 text-success"
: state === "not_ready"
          ? "border-border bg-surface-tertiary text-muted-foreground"
: "border-warning/30 bg-warning/8 text-warning";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]",
        tone,
      )}
    >
      {state.replace(/_/g, " ")}
    </span>
  );
}
