/**
 * The one decision this page is asking for.
 *
 * The move itself is computed in `data/scout/recommended-move.ts`; this card
 * only makes the state unmistakable and carries the explicit human action.
 * Nothing sends automatically. When the first message is blocked, the card
 * leads to the blocker instead of presenting a dead button.
 */

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

import { Panel, WhyWeThink } from "@/components/tt/prospect/panel";
import { TTButton } from "@/components/tt/primitives";
import type { RecommendedMoveAction, RecommendedNextMove } from "@/data/scout/recommended-move";
import type { Person } from "@/domain/people";
import type { WatchState } from "@/domain/relationship-development";
import type { ProspectCandidate } from "@/domain/scout";
import { cn } from "@/lib/utils";

function blockerLabel(count: number): string {
  return `Resolve ${count} blocker${count === 1 ? "" : "s"}`;
}

export function RecommendedNextMoveCard({
  move,
  candidate,
  people: _people,
  busy,
  preparingBrief,
  prepareError,
  firstMessageReady,
  firstMessageBlockers = 0,
  routingFirstMessage = false,
  onPrimary,
  onPrepareFirstMessage,
  onPrepareBrief,
  onResolveBlockers,
  onWatch,
  onSeeResearch,
}: {
  move: RecommendedNextMove;
  candidate: ProspectCandidate;
  people: Person[];
  busy?: boolean;
  /** True while governed relationship research is being prepared. */
  preparingBrief?: boolean;
  /** Inline failure for the prepare-research action; retry stays in place. */
  prepareError?: string | null;
  /** Whether the handoff behind "Prepare first message" is safe today. */
  firstMessageReady: boolean;
  /** The truthful number of blockers between this company and Comms. */
  firstMessageBlockers?: number;
  /** True while the approved brief is being carried into Comms. */
  routingFirstMessage?: boolean;
  onPrimary: (kind: RecommendedMoveAction) => void;
  onPrepareFirstMessage: () => void;
  onPrepareBrief: (force: boolean) => void;
  onResolveBlockers: () => void;
  onWatch: (watch: WatchState | null) => void;
  onSeeResearch: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const canAct = move.primary.kind !== "none";
  const blockedFirstMessage =
    move.primary.kind === "prepare_first_message" && !firstMessageReady;
  const primaryLabel = blockedFirstMessage
    ? blockerLabel(firstMessageBlockers)
    : move.primary.label;

  useEffect(() => {
    setConfirming(false);
  }, [candidate.prospect.id, move.state, move.primary.kind]);

  const runPrimary = () => {
    if (move.primary.kind === "prepare_research") {
      setConfirming(false);
      onPrepareBrief(move.prepareForce);
      return;
    }
    if (move.primary.kind === "prepare_first_message") {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onPrimary(move.primary.kind);
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
        ) : null}

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
              {move.person.roleTitle ? ` · ${move.person.roleTitle}` : ""}
            </p>
          ) : null}
        </div>

        {move.whyNow ? (
          <div className="rounded-xl border border-royal/25 bg-royal/8 px-4 py-3">
            <p className="tt-eyebrow text-royal">Why now</p>
            <p className="mt-1 text-sm text-foreground">{move.whyNow}</p>
          </div>
        ) : null}

        {move.watch ? (
          <div className="rounded-xl border border-border bg-surface-tertiary px-4 py-3">
            <p className="text-sm text-foreground">
              {move.watch === "watching"
                ? "Watching for a real dated signal."
                : "Marked not now. The research stays; nothing is owed."}
            </p>
          </div>
        ) : null}

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
        ) : null}

        {move.evidence.length > 0 ? (
          <details className="group rounded-xl border border-border bg-surface-tertiary px-4 py-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[13px] font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              See why
              <ChevronDown
                aria-hidden
                className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
              />
            </summary>
            <ul className="mt-3 space-y-2 border-t border-border pt-3">
              {move.evidence.slice(0, 4).map((item, index) => (
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
                  ) : (
                    item.label
                  )}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-5">
          {canAct ? (
            <TTButton
              pending={preparingBrief && move.primary.kind === "prepare_research"}
              pendingLabel="Preparing relationship research…"
              disabled={busy || (preparingBrief && move.primary.kind !== "prepare_research")}
              onClick={runPrimary}
            >
              {primaryLabel}
            </TTButton>
          ) : null}

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
          ) : null}

          {move.watch ? (
            <TTButton
              variant="quiet"
              size="sm"
              disabled={busy}
              onClick={() => onWatch(null)}
            >
              Clear pacing
            </TTButton>
          ) : null}

          <TTButton variant="quiet" size="sm" onClick={onSeeResearch}>
            See the evidence
          </TTButton>
        </div>

        {confirming && move.primary.kind === "prepare_first_message" ? (
          <div className="rounded-xl border border-royal/25 bg-royal/8 p-4">
            {firstMessageReady ? (
              <>
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
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-foreground">
                  Resolve {firstMessageBlockers} blocker{firstMessageBlockers === 1 ? "" : "s"}{" "}
                  first.
                </p>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  Scout will take you to People and focus the exact area to fix. The handoff stays
                  closed until the evidence is safe.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <TTButton
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setConfirming(false);
                      onResolveBlockers();
                    }}
                  >
                    Open People blockers
                  </TTButton>
                  <TTButton
                    variant="quiet"
                    size="sm"
                    disabled={busy}
                    onClick={() => setConfirming(false)}
                  >
                    Stay on Overview
                  </TTButton>
                </div>
              </>
            )}
          </div>
        ) : null}

        <WhyWeThink confidence={{ level: "moderate", because: move.reason, evidence: move.evidence }} />
      </div>
    </Panel>
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
