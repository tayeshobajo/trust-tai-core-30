/**
 * The recommended next move — the one canonical decision surface on the
 * company page.
 *
 * One move. One clear reason. One primary action. Everything else on the
 * page is evidence for this card, never a competing answer. The move itself
 * is computed by `buildRecommendedNextMove`; this component only renders it
 * and carries the person's click. Nothing here sends anything: the first
 * message is prepared in Comms, reviewed by a person, and sent only by them.
 */

import { useMemo, useState } from "react";

import { MetaPill, TTButton } from "@/components/tt/primitives";
import {
  computeRelationshipOpportunity,
  planRelationshipPreparation,
} from "@/data/relationship-development";
import type {
  RecommendedMoveAction,
  RecommendedNextMove,
} from "@/data/scout/recommended-move";
import type { Person } from "@/domain/people";
import {
  RELATIONSHIP_CHANNEL_LABEL,
  type WatchState,
} from "@/domain/relationship-development";
import type { ProspectCandidate } from "@/domain/scout";
import { EMPTY_INTEL } from "@/domain/scout-intel";
import { cn } from "@/lib/utils";

const STATE_TONE: Record<RecommendedNextMove["state"], string> = {
  act_now: "border-emerald-200 bg-emerald-50 text-emerald-900",
  no_urgency: "border-border bg-secondary text-secondary-foreground",
  find_person: "border-royal/30 bg-royal/5 text-royal",
  research_first: "border-royal/30 bg-royal/5 text-royal",
  in_comms: "border-royal/30 bg-royal/5 text-royal",
  not_ready: "border-border bg-card text-muted-foreground",
};

function formatDay(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "recently"
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function RecommendedNextMoveCard({
  move,
  candidate,
  people,
  busy = false,
  preparingBrief = false,
  /** False when the handoff record still has blockers; the people tab says why. */
  firstMessageReady,
  onPrimary,
  onPrepareFirstMessage,
  onWatch,
  onPrepareBrief,
  onSeeResearch,
}: {
  move: RecommendedNextMove;
  candidate: ProspectCandidate;
  people: Person[];
  busy?: boolean;
  preparingBrief?: boolean;
  firstMessageReady: boolean;
  onPrimary: (kind: RecommendedMoveAction) => void;
  /** The explicit, confirmed handoff: carry the brief to Comms and open it there. */
  onPrepareFirstMessage: () => void;
  onWatch: (watch: WatchState | null) => void;
  onPrepareBrief: (force?: boolean) => void;
  onSeeResearch: () => void;
}) {
  const [showWhy, setShowWhy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const intel = candidate.intel ?? EMPTY_INTEL;
  const research = candidate.development?.research;
  const brief = research?.state === "prepared" ? research.brief : undefined;

  // The evidence behind the move, shown only when asked for.
  const why = useMemo(
    () => ({
      opportunity: computeRelationshipOpportunity({ candidate, intel, people }),
      preparation: planRelationshipPreparation({ candidate, people }),
    }),
    [candidate, intel, people],
  );

  const primary = move.primary;
  const showWatch = move.state !== "in_comms" && move.state !== "not_ready";

  const handlePrimary = () => {
    if (primary.kind === "prepare_first_message") {
      // A handoff with open blockers routes to the people record, where the
      // Comms brief lists exactly what still stands in the way.
      if (!firstMessageReady) {
        onPrimary("find_person");
        return;
      }
      setConfirming(true);
      return;
    }
    onPrimary(primary.kind);
  };

  return (
    <section
      aria-label="Recommended next move"
      className={cn(
        "tt-rise rounded-xl border bg-card p-6",
        move.state === "not_ready" ? "border-border" : "border-royal/30",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="tt-eyebrow">Recommended next move</p>
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
            STATE_TONE[move.state],
          )}
        >
          {move.label}
        </span>
        {move.watch === "watching" ? <MetaPill>Watching</MetaPill> : null}
        {move.watch === "not_now" ? <MetaPill>Set aside</MetaPill> : null}
      </div>

      <h2 className="mt-3 font-serif text-[22px] leading-snug text-foreground">{move.headline}</h2>
      <p className="mt-2 max-w-reading text-sm leading-relaxed text-muted-foreground">
        {move.reason}
      </p>

      {move.person && move.state !== "in_comms" ? (
        <p className="mt-3 text-[13px] text-muted-foreground">
          <span className="text-foreground">{move.person.fullName}</span>
          {move.person.roleTitle ? ` · ${move.person.roleTitle}` : ""}
          {move.channel
            ? ` · ${RELATIONSHIP_CHANNEL_LABEL[move.channel.channel]} is the natural way in`
            : ""}
        </p>
      ) : null}

      {move.watch === "watching" ? (
        <p className="mt-3 text-[12px] text-muted-foreground">
          You are watching this company. The read above stays current; resume whenever it earns it.
        </p>
      ) : null}

      <div className="mt-5 border-t border-border pt-4">
        {confirming ? (
          <div className="rounded-lg border border-royal/30 bg-royal/5 p-4">
            <p className="text-[13px] text-foreground">
              This carries {candidate.prospect.name} to Comms with its brief and context intact.
              The first message is prepared there for your review — nothing is sent, and sending is
              always your click.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <TTButton
                size="sm"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  onPrepareFirstMessage();
                }}
              >
                Continue to Comms
              </TTButton>
              <TTButton variant="quiet" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
                Not yet
              </TTButton>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {primary.kind !== "none" ? (
              <TTButton disabled={busy || preparingBrief} onClick={handlePrimary}>
                {preparingBrief && primary.kind === "prepare_research"
                  ? "Preparing…"
                  : primary.label}
              </TTButton>
            ) : null}

            {showWatch ? (
              move.watch === "watching" ? (
                <>
                  <TTButton variant="secondary" disabled={busy} onClick={() => onWatch(null)}>
                    Resume
                  </TTButton>
                  <TTButton variant="quiet" disabled={busy} onClick={() => onWatch("not_now")}>
                    Not now
                  </TTButton>
                </>
              ) : move.watch === "not_now" ? (
                <TTButton variant="quiet" disabled={busy} onClick={() => onWatch(null)}>
                  Bring back
                </TTButton>
              ) : (
                <>
                  <TTButton variant="secondary" disabled={busy} onClick={() => onWatch("watching")}>
                    Watch
                  </TTButton>
                  <TTButton variant="quiet" disabled={busy} onClick={() => onWatch("not_now")}>
                    Not now
                  </TTButton>
                </>
              )
            ) : null}

            <span className="ml-auto flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => setShowWhy((value) => !value)}
                className="tt-eyebrow underline decoration-border underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {showWhy ? "Hide why" : "See why"}
              </button>
              <button
                type="button"
                onClick={onSeeResearch}
                className="tt-eyebrow underline decoration-border underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                See research
              </button>
            </span>
          </div>
        )}

        {primary.kind === "prepare_first_message" && !firstMessageReady && !confirming ? (
          <p className="mt-3 text-[12px] text-muted-foreground">
            A few things still stand between this brief and a safe handoff — the people record
            lists them.
          </p>
        ) : null}
      </div>

      {showWhy ? (
        <div className="mt-5 space-y-5 border-t border-border pt-5">
          {research?.state === "prepared" && research.preparedAt ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[12px] text-muted-foreground">
                Brief prepared {formatDay(research.preparedAt)}
                {research.evidenceAt ? ` from evidence read ${formatDay(research.evidenceAt)}` : ""}.
                Research only — nothing has been sent and no relationship was created.
                {why.preparation.action === "refresh" ? ` ${why.preparation.because}` : ""}
              </p>
              {why.preparation.action === "refresh" ? (
                <TTButton
                  variant="quiet"
                  size="sm"
                  disabled={preparingBrief}
                  onClick={() => onPrepareBrief(true)}
                >
                  {preparingBrief ? "Preparing…" : "Refresh the brief"}
                </TTButton>
              ) : null}
            </div>
          ) : null}

          {why.opportunity.factors.length > 0 ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {why.opportunity.factors.map((factor) => (
                <li key={factor.key} className="rounded-lg border border-border bg-background p-3">
                  <p className="text-[13px] text-foreground">
                    <span
                      aria-hidden
                      className={cn(
                        "mr-2 inline-block size-1.5 rounded-full align-middle",
                        factor.state === "present" ? "bg-success" : "bg-muted-foreground/40",
                      )}
                    />
                    {factor.label}
                  </p>
                  <p className="mt-1 pl-3.5 text-[12px] text-muted-foreground">{factor.because}</p>
                </li>
              ))}
            </ul>
          ) : null}

          {brief && brief.bridgeIdeas.length > 0 ? (
            <div className="rounded-lg border border-border bg-background p-4">
              <p className="tt-eyebrow">Useful bridges</p>
              <ul className="mt-2 space-y-2.5">
                {brief.bridgeIdeas.map((idea) => (
                  <li key={`${idea.kind}-${idea.idea.slice(0, 24)}`}>
                    <p className="text-[13px] text-foreground">
                      {idea.label}: {idea.idea}
                    </p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">{idea.why}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {brief ? (
            <div className="rounded-lg border border-border bg-secondary/40 p-4">
              <p className="tt-eyebrow">First-move posture</p>
              <p className="mt-1.5 text-[13px] text-muted-foreground">{brief.firstMovePosture}</p>
              {brief.risksOrAssumptions.length > 0 ? (
                <ul className="mt-3 space-y-1 border-t border-border pt-3 text-[12px] text-muted-foreground">
                  {brief.risksOrAssumptions.map((risk) => (
                    <li key={risk}>{risk}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
