/**
 * One reading, as a person meets it.
 *
 * A card says what to do, why it matters, what would prove it worked, and
 * which room owns it. The bounded step underneath appears only when a real
 * adapter can carry it, a step with no adapter is not a step, so it is said
 * plainly rather than offered as a button that cannot act.
 */

import { useState } from "react";
import { Link } from "@tanstack/react-router";

import { MetaPill, TTButton, TTCard } from "@/components/tt/primitives";
import { ActionProposalRow } from "@/components/tt/intelligence/business-read";
import { proposeActions } from "@/data/intelligence/engine/propose";
import { isSupportedOperation } from "@/domain/adapter-registry";
import { operationGap } from "@/data/conductor/adapters";
import { roomLabel } from "@/data/conductor/page-projection";
import { CONFIDENCE_LEVEL_LABEL } from "@/domain/confidence";
import type { AccessContext } from "@/domain/access";
import {
  RECOMMENDATION_KIND_LABEL,
  type ActionAuthorizationDecision,
  type ActionProposal,
  type Hypothesis,
  type Recommendation,
  type RecommendationDecision,
} from "@/domain/intelligence-engine";

const EFFORT_LABEL = { small: "Small effort", medium: "Medium effort", large: "Large effort" } as const;

export interface RecommendationCardProps {
  recommendation: Recommendation;
  hypotheses: Hypothesis[];
  access: AccessContext | null;
  onDecide: (input: {
    recommendation: Recommendation;
    decision: RecommendationDecision;
    editedText?: string;
  }) => Promise<void>;
  onAuthorize?: (input: {
    proposal: ActionProposal;
    decision: ActionAuthorizationDecision;
    note?: string;
  }) => Promise<void>;
}

export function RecommendationCard({
  recommendation,
  hypotheses,
  access,
  onDecide,
  onAuthorize,
}: RecommendationCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(recommendation.headline);
  const [busy, setBusy] = useState(false);

  /* Adapter-backed only. Everything else is a reading, not a step. */
  const proposals = proposeActions(recommendation);
  const routable = proposals.filter((proposal) =>
    isSupportedOperation(proposal.appId, proposal.operation),
  );
  const unroutable = proposals.filter(
    (proposal) => !isSupportedOperation(proposal.appId, proposal.operation),
  );

  async function decide(decision: RecommendationDecision, editedText?: string) {
    setBusy(true);
    try {
      await onDecide({
        recommendation,
        decision,
        ...(editedText ? { editedText } : {}),
      });
    } finally {
      setBusy(false);
    }
  }

  const destination = recommendation.destination;
  const external = /^https?:\/\//.test(destination.route);

  return (
    <TTCard className="p-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <MetaPill>{RECOMMENDATION_KIND_LABEL[recommendation.kind]}</MetaPill>
        <MetaPill>{CONFIDENCE_LEVEL_LABEL[recommendation.confidence]}</MetaPill>
        <MetaPill>{EFFORT_LABEL[recommendation.effort]}</MetaPill>
      </div>

      <h3 className="mt-3 text-[17px] font-semibold leading-snug text-foreground">
        {recommendation.headline}
      </h3>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="tt-eyebrow">Why this matters</p>
          <p className="mt-1 text-sm text-muted-foreground">{recommendation.rationale}</p>
        </div>
        <div>
          <p className="tt-eyebrow">If this works</p>
          <p className="mt-1 text-sm text-muted-foreground">{recommendation.expectedSignal}</p>
        </div>
      </div>

      {hypotheses.length > 0 ? (
        <details className="mt-3 border-t border-border pt-3">
          <summary className="tt-eyebrow cursor-pointer select-none">View evidence</summary>
          <ul className="mt-2 space-y-2">
            {hypotheses.map((hypothesis) => (
              <li key={hypothesis.id} className="text-sm">
                <p className="text-foreground">{hypothesis.claim}</p>
                <p className="text-muted-foreground">{hypothesis.because}</p>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  {hypothesis.origin === "reasoned" ? "Connected" : "Derived"} ·{" "}
                  {hypothesis.sourceApps.map(roomLabel).join(", ")} ·{" "}
                  {hypothesis.observationRefs.length} observation
                  {hypothesis.observationRefs.length === 1 ? "" : "s"}
                </p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {editing ? (
        <div className="mt-4 space-y-2 border-t border-border pt-4">
          <label className="tt-eyebrow block" htmlFor={`edit-${recommendation.id}`}>
            Say it the way you would
          </label>
          <textarea
            id={`edit-${recommendation.id}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={3}
            className="w-full rounded-xl border border-border bg-background p-3 text-sm text-foreground outline-none focus:border-royal"
          />
          <div className="flex flex-wrap gap-2">
            <TTButton
              disabled={busy || draft.trim().length === 0}
              onClick={() => void decide("edited", draft.trim())}
            >
              Save and accept
            </TTButton>
            <TTButton variant="quiet" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </TTButton>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <TTButton disabled={busy} onClick={() => void decide("accepted")}>
            Accept
          </TTButton>
          <TTButton variant="quiet" disabled={busy} onClick={() => setEditing(true)}>
            Edit
          </TTButton>
          <TTButton variant="quiet" disabled={busy} onClick={() => void decide("deferred")}>
            Not now
          </TTButton>
          <TTButton variant="quiet" disabled={busy} onClick={() => void decide("rejected")}>
            Not useful
          </TTButton>

          {external ? (
            <a
              href={destination.route}
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-[13px] text-royal underline underline-offset-4"
            >
              {destination.label} →
            </a>
          ) : (
            <Link
              to={destination.route}
              className="ml-auto text-[13px] text-royal underline underline-offset-4"
            >
              {destination.label} →
            </Link>
          )}
        </div>
      )}

      {onAuthorize && routable.length > 0 ? (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          <p className="tt-eyebrow">Next step (bounded)</p>
          {routable.map((proposal) => (
            <ActionProposalRow
              key={proposal.id}
              action={proposal}
              onAuthorize={onAuthorize}
              access={access}
            />
          ))}
        </div>
      ) : null}

      {unroutable.length > 0 ? (
        <p className="mt-3 border-t border-border pt-3 text-[13px] text-muted-foreground">
          Nothing here can be carried out for you yet:{" "}
          {operationGap(unroutable[0]!.appId, unroutable[0]!.operation) ??
            `${roomLabel(unroutable[0]!.appId)} has no connected step for this.`}{" "}
          Open the room to do it yourself.
        </p>
      ) : null}
    </TTCard>
  );
}
