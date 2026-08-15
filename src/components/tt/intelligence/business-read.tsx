/**
 * The Intelligence Engine's read of the business, as a person sees it.
 *
 * One sentence at the top, then a small number of proposals, each of which can
 * be accepted, edited, deferred or rejected. Nothing here acts: every proposal
 * routes to the room that owns the change. What the read rests on is always
 * one disclosure away, and what could not be read is stated rather than hidden.
 */

import { useState } from "react";
import { Link } from "@tanstack/react-router";

import { MetaPill, TTButton, TTCard } from "@/components/tt/primitives";
import { CONFIDENCE_LEVEL_LABEL } from "@/domain/confidence";
import type { AccessContext } from "@/domain/access";
import { canAuthorizeAction } from "@/domain/action-authority";
import { proposeActions } from "@/data/intelligence/engine/propose";
import {
  BUSINESS_THEME_LABEL,
  RECOMMENDATION_KIND_LABEL,
  type ActionAuthorizationDecision,
  type ActionProposal,
  type EngineRead,
  type Hypothesis,
  type Recommendation,
  type RecommendationDecision,
} from "@/domain/intelligence-engine";

const ROOM_LABEL: Record<string, string> = {
  scout: "Scout",
  comms: "Comms",
  roadmap: "Roadmap",
  projects: "Projects",
  ops: "Ops",
  studio: "Studio",
  steward: "Steward",
  activity: "Activity",
};

const EFFORT_LABEL = { small: "Small", medium: "Medium", large: "Large" } as const;

export interface BusinessReadProps {
  read: EngineRead;
  /** Called when a person decides about a proposal. Awaited before clearing. */
  onDecide: (input: {
    recommendation: Recommendation;
    decision: RecommendationDecision;
    editedText?: string;
  }) => Promise<void>;
  /**
   * Called when a person authorises or declines a bounded action. Omit it and
   * no action is offered: authorisation must have somewhere to be recorded.
   */
  onAuthorize?: (input: {
    proposal: ActionProposal;
    decision: ActionAuthorizationDecision;
    note?: string;
  }) => Promise<void>;
  /**
   * Who is looking. Authorising a bounded action is a role question owned by
   * the room the change belongs to; without an access context nothing is
   * approvable.
   */
  access?: AccessContext | null;
  /** True while the model stage is still running behind a deterministic read. */
  reasoning?: boolean;
}

export function BusinessRead({
  read,
  onDecide,
  onAuthorize,
  access,
  reasoning = false,
}: BusinessReadProps) {
  const [decided, setDecided] = useState<Record<string, RecommendationDecision>>({});

  async function decide(
    recommendation: Recommendation,
    decision: RecommendationDecision,
    editedText?: string,
  ) {
    await onDecide({
      recommendation,
      decision,
      ...(editedText ? { editedText } : {}),
    });
    setDecided((current) => ({ ...current, [recommendation.id]: decision }));
  }

  const open = read.recommendations.filter((row) => !decided[row.id]);

  return (
    <section aria-labelledby="business-read-heading" className="space-y-6">
      <div>
        <p className="tt-eyebrow">
          {read.reasoned ? "Read across the suite" : "Read across the suite, deterministic"}
        </p>
        <h2
          id="business-read-heading"
          className="mt-2 font-serif text-2xl leading-snug text-foreground"
        >
          {read.headline}
        </h2>
        {reasoning ? (
          <p className="mt-2 text-sm text-muted-foreground">Still connecting the rooms.</p>
        ) : null}
      </div>

      {open.length > 0 ? (
        <div className="space-y-4">
          {open.map((recommendation) => (
            <ProposalCard
              key={recommendation.id}
              recommendation={recommendation}
              hypotheses={read.hypotheses.filter((row) =>
                recommendation.hypothesisRefs.includes(row.id),
              )}
              onDecide={decide}
              {...(onAuthorize ? { onAuthorize } : {})}
            />
          ))}
        </div>
      ) : read.recommendations.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          You have decided on everything the engine proposed. It will learn from that.
        </p>
      ) : null}

      <ReadFooting read={read} />
    </section>
  );
}

function ProposalCard({
  recommendation,
  hypotheses,
  onDecide,
  onAuthorize,
}: {
  recommendation: Recommendation;
  hypotheses: Hypothesis[];
  onDecide: (
    recommendation: Recommendation,
    decision: RecommendationDecision,
    editedText?: string,
  ) => Promise<void>;
  onAuthorize?: (input: {
    proposal: ActionProposal;
    decision: ActionAuthorizationDecision;
    note?: string;
  }) => Promise<void>;
}) {
  const actions = proposeActions(recommendation);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(recommendation.headline);
  const [busy, setBusy] = useState(false);

  async function run(decision: RecommendationDecision, editedText?: string) {
    setBusy(true);
    try {
      await onDecide(recommendation, decision, editedText);
    } finally {
      setBusy(false);
    }
  }

  return (
    <TTCard className="p-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <MetaPill>{RECOMMENDATION_KIND_LABEL[recommendation.kind]}</MetaPill>
        <MetaPill>{BUSINESS_THEME_LABEL[recommendation.theme]}</MetaPill>
        <MetaPill>{CONFIDENCE_LEVEL_LABEL[recommendation.confidence]}</MetaPill>
        <MetaPill>{EFFORT_LABEL[recommendation.effort]} effort</MetaPill>
      </div>

      <h3 className="mt-3 text-base font-semibold text-foreground">{recommendation.headline}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{recommendation.rationale}</p>

      <p className="mt-3 text-sm text-foreground">
        <span className="text-muted-foreground">If this worked: </span>
        {recommendation.expectedSignal}
      </p>

      {hypotheses.length > 0 ? (
        <details className="mt-3 border-t border-border pt-3">
          <summary className="tt-eyebrow cursor-pointer select-none">What this rests on</summary>
          <ul className="mt-2 space-y-2">
            {hypotheses.map((hypothesis) => (
              <li key={hypothesis.id} className="text-sm">
                <p className="text-foreground">{hypothesis.claim}</p>
                <p className="text-muted-foreground">{hypothesis.because}</p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {hypothesis.origin === "reasoned" ? "Connected" : "Derived"} ·{" "}
                  {hypothesis.sourceApps.map((app) => ROOM_LABEL[app] ?? app).join(", ")} ·{" "}
                  {hypothesis.observationRefs.length} observation
                  {hypothesis.observationRefs.length === 1 ? "" : "s"}
                </p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {editing ? (
        <div className="mt-4 space-y-2">
          <label className="tt-eyebrow block" htmlFor={`edit-${recommendation.id}`}>
            Say it the way you would
          </label>
          <textarea
            id={`edit-${recommendation.id}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={3}
            className="w-full rounded-md border border-border bg-background p-3 text-sm text-foreground"
          />
          <div className="flex flex-wrap gap-2">
            <TTButton
              disabled={busy || draft.trim().length === 0}
              onClick={() => void run("edited", draft.trim())}
            >
              Save and accept
            </TTButton>
            <TTButton variant="quiet" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </TTButton>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <TTButton disabled={busy} onClick={() => void run("accepted")}>
            Accept
          </TTButton>
          <TTButton variant="quiet" disabled={busy} onClick={() => setEditing(true)}>
            Edit
          </TTButton>
          <TTButton variant="quiet" disabled={busy} onClick={() => void run("deferred")}>
            Not now
          </TTButton>
          <TTButton variant="quiet" disabled={busy} onClick={() => void run("rejected")}>
            Not useful
          </TTButton>

          {/^https?:\/\//.test(recommendation.destination.route) ? (
            <a
              href={recommendation.destination.route}
              target="_blank"
              rel="noreferrer"
              className="ml-auto font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground underline underline-offset-4 transition-colors hover:text-royal"
            >
              {recommendation.destination.label} →
            </a>
          ) : (
            <Link
              to={recommendation.destination.route}
              className="ml-auto font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground underline underline-offset-4 transition-colors hover:text-royal"
            >
              {recommendation.destination.label} →
            </Link>
          )}
        </div>
      )}

      {onAuthorize && actions.length > 0 ? (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          <p className="tt-eyebrow">Bounded next step · needs your authorisation</p>
          {actions.map((action) => (
            <ActionProposalRow key={action.id} action={action} onAuthorize={onAuthorize} />
          ))}
        </div>
      ) : null}
    </TTCard>
  );
}

/**
 * One bounded action. Nothing happens until a person authorises it, and even
 * then the work is done by that person in the room that owns the change.
 */
function ActionProposalRow({
  action,
  onAuthorize,
}: {
  action: ActionProposal;
  onAuthorize: (input: {
    proposal: ActionProposal;
    decision: ActionAuthorizationDecision;
    note?: string;
  }) => Promise<void>;
}) {
  const [state, setState] = useState<ActionAuthorizationDecision | null>(null);
  const [busy, setBusy] = useState(false);

  async function decide(decision: ActionAuthorizationDecision) {
    setBusy(true);
    try {
      await onAuthorize({ proposal: action, decision });
      setState(decision);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <MetaPill>{ROOM_LABEL[action.appId] ?? action.appId}</MetaPill>
        <MetaPill>{action.reversible ? "Reversible" : "Not reversible"}</MetaPill>
        <MetaPill>Needs approval</MetaPill>
      </div>

      <h4 className="mt-2 text-sm font-semibold text-foreground">{action.title}</h4>
      <p className="mt-1 text-sm text-muted-foreground">{action.summary}</p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="tt-eyebrow">What it will do</p>
          <ul className="mt-1 space-y-1 text-sm text-foreground">
            {action.willDo.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="tt-eyebrow">What it will not do</p>
          <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
            {action.willNotDo.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </div>

      {state === "authorized" ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-sm text-foreground">
            Authorised. {ROOM_LABEL[action.appId] ?? action.appId} owns the change — finish it
            there.
          </p>
          <a
            href={action.route}
            className="font-mono text-[10px] uppercase tracking-[0.16em] text-royal underline underline-offset-4"
          >
            {action.routeLabel} →
          </a>
        </div>
      ) : state === "declined" ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Declined. The engine will not propose this step again unprompted.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <TTButton disabled={busy} onClick={() => void decide("authorized")}>
            Authorise this step
          </TTButton>
          <TTButton variant="quiet" disabled={busy} onClick={() => void decide("declined")}>
            Don&rsquo;t do this
          </TTButton>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {action.operation}
          </span>
        </div>
      )}
    </div>
  );
}


/** What the read saw, what it could not see, and what it was told to leave alone. */
function ReadFooting({ read }: { read: EngineRead }) {
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <details>
        <summary className="tt-eyebrow cursor-pointer select-none">
          What the engine read ({read.observations.length})
        </summary>
        <ul className="mt-2 space-y-1.5">
          {read.observations.map((observation) => (
            <li key={observation.id} className="text-sm text-muted-foreground">
              <span className="text-foreground">{observation.statement}</span>{" "}
              <span className="font-mono text-[10px] uppercase tracking-[0.16em]">
                {observation.sourceApps.map((app) => ROOM_LABEL[app] ?? app).join(", ")}
              </span>
            </li>
          ))}
          {read.observations.length === 0 ? (
            <li className="text-sm text-muted-foreground">Nothing was readable just now.</li>
          ) : null}
        </ul>
      </details>

      {read.decided.length > 0 ? (
        <details>
          <summary className="tt-eyebrow cursor-pointer select-none">
            Decisions the read respected ({read.decided.length})
          </summary>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {read.decided.map((statement) => (
              <li key={statement}>{statement}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {read.withheld.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Not read: {read.withheld.map((row) => ROOM_LABEL[row.appId] ?? row.appId).join(", ")}.
          Nothing here assumes what those rooms contain.
        </p>
      ) : null}

      {read.suppressed.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {read.suppressed.length} reading{read.suppressed.length === 1 ? "" : "s"} you rejected
          before {read.suppressed.length === 1 ? "was" : "were"} left out.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The same read, compressed to one line for Home.
 *
 * Home is a doorway, not a console: it says the one thing that would change
 * someone's day and points at Pulse for the rest. Deterministic only — the
 * model stage runs where a person went looking for it.
 */
export function BusinessReadSummary({ read }: { read: EngineRead }) {
  const lead = read.recommendations[0];
  return (
    <TTCard className="p-5">
      <p className="tt-eyebrow">What the engine reads across the suite</p>
      <p className="mt-2 font-serif text-lg leading-snug text-foreground">{read.headline}</p>
      {lead ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {lead.headline} — {lead.rationale}
        </p>
      ) : null}
      <Link
        to="/modules/pulse"
        className="mt-4 inline-block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground underline underline-offset-4 transition-colors hover:text-royal"
      >
        Open Pulse →
      </Link>
    </TTCard>
  );
}
