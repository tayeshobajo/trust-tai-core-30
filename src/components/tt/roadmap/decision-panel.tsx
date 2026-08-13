/**
 * Needs your decision.
 *
 * Decisions are separated from general information everywhere in Trust Tai.
 * A decision states the question, why it matters, what it rests on, and — only
 * when there is evidence for it — a recommendation clearly marked as suggested.
 */

import { useState } from "react";

import { MetaPill, TTButton } from "@/components/tt/primitives";
import { EvidenceList } from "@/components/tt/roadmap/tier";
import type { DecisionState, RoadmapDecision } from "@/domain/roadmap";
import { DECISION_STATE_LABEL } from "@/domain/roadmap";

export function DecisionPanel({
  decisions,
  onResolve,
  busyId,
}: {
  decisions: RoadmapDecision[];
  onResolve: (decision: RoadmapDecision, status: Exclude<DecisionState, "open">, note: string) => void;
  busyId?: string | null;
}) {
  const open = decisions.filter((decision) => decision.status === "open");
  const resolved = decisions.filter((decision) => decision.status !== "open");

  return (
    <section className="space-y-4" aria-label="Decisions on this roadmap">
      {open.length === 0 ? (
        <div className="tt-surface p-6">
          <p className="tt-eyebrow">Needs your decision</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Nothing is waiting on you here. The next move below can go ahead.
          </p>
        </div>
      ) : (
        open.map((decision) => (
          <OpenDecision
            key={decision.id}
            decision={decision}
            onResolve={onResolve}
            busy={busyId === decision.id}
          />
        ))
      )}

      {resolved.length > 0 ? (
        <div className="tt-surface p-6">
          <p className="tt-eyebrow">Decided</p>
          <ul className="mt-3 space-y-3">
            {resolved.map((decision) => (
              <li key={decision.id} className="border-t border-border pt-3 first:border-0 first:pt-0">
                <div className="flex flex-wrap items-center gap-2">
                  <MetaPill>{DECISION_STATE_LABEL[decision.status]}</MetaPill>
                  {decision.resolvedAt ? (
                    <MetaPill>{new Date(decision.resolvedAt).toLocaleDateString()}</MetaPill>
                  ) : null}
                </div>
                <p className="mt-2 text-sm text-foreground">{decision.question}</p>
                {decision.resolutionNote ? (
                  <p className="mt-1 text-sm text-muted-foreground">{decision.resolutionNote}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function OpenDecision({
  decision,
  onResolve,
  busy,
}: {
  decision: RoadmapDecision;
  onResolve: (decision: RoadmapDecision, status: Exclude<DecisionState, "open">, note: string) => void;
  busy: boolean;
}) {
  const [note, setNote] = useState("");

  return (
    <article className="tt-surface border-royal/20 p-6">
      <p className="tt-eyebrow text-royal">Needs your decision</p>
      <h3 className="mt-2 text-lg font-semibold tracking-tight text-foreground">
        {decision.question}
      </h3>
      <p className="mt-2 text-sm text-muted-foreground">{decision.whyItMatters}</p>

      {decision.options.length > 0 ? (
        <ul className="mt-4 space-y-1.5">
          {decision.options.map((option) => (
            <li key={option} className="text-sm text-foreground">
              — {option}
            </li>
          ))}
        </ul>
      ) : null}

      {decision.recommendation ? (
        <div className="mt-4 rounded-lg border border-royal/20 bg-royal/5 p-4">
          <p className="tt-eyebrow text-royal">Suggested by the intelligence layer</p>
          <p className="mt-1 text-sm text-foreground">{decision.recommendation}</p>
          {decision.recommendationBecause ? (
            <p className="mt-1 text-sm text-muted-foreground">{decision.recommendationBecause}</p>
          ) : null}
        </div>
      ) : null}

      <EvidenceList evidence={decision.evidence} />

      <label className="mt-5 block">
        <span className="tt-eyebrow">Note (optional)</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="What you decided, in your words."
        />
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        <TTButton size="sm" disabled={busy} onClick={() => onResolve(decision, "approved", note)}>
          Approve
        </TTButton>
        <TTButton
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => onResolve(decision, "declined", note)}
        >
          Decline
        </TTButton>
        <TTButton
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => onResolve(decision, "deferred", note)}
        >
          Defer
        </TTButton>
      </div>
    </article>
  );
}
