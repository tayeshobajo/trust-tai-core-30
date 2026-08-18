/**
 * Needs your decision.
 *
 * Decisions are separated from general information everywhere in Trust Tai.
 * A decision states the question, why it matters, what it rests on, and, only
 * when there is evidence for it, a recommendation clearly marked as suggested.
 */

import { useState } from "react";

import { MetaPill, TTButton } from "@/components/tt/primitives";
import { EvidenceList } from "@/components/tt/roadmap/tier";
import type { DecisionState, RoadmapDecision } from "@/domain/roadmap";
import { DECISION_STATE_LABEL } from "@/domain/roadmap";

export interface DecisionRequest {
  question: string;
  whyItMatters: string;
  options: string[];
  labels: string[];
}

export function DecisionPanel({
  decisions,
  onResolve,
  onRequest,
  onLabels,
  requesting,
  busyId,
}: {
  decisions: RoadmapDecision[];
  onResolve: (
    decision: RoadmapDecision,
    status: Exclude<DecisionState, "open">,
    note: string,
  ) => void;
  /** Ask for a decision. Asking is not deciding: it opens the question only. */
  onRequest?: (input: DecisionRequest) => void;
  onLabels?: (decision: RoadmapDecision, labels: string[]) => void;
  requesting?: boolean;
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
            {...(onLabels ? { onLabels } : {})}
            busy={busyId === decision.id}
          />
        ))
      )}

      {onRequest ? <RequestDecision onRequest={onRequest} busy={requesting === true} /> : null}

      {resolved.length > 0 ? (
        <div className="tt-surface p-6">
          <p className="tt-eyebrow">Decided</p>
          <ul className="mt-3 space-y-3">
            {resolved.map((decision) => (
              <li
                key={decision.id}
                className="border-t border-border pt-3 first:border-0 first:pt-0"
              >
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

/**
 * Asking for a decision.
 *
 * A question is recorded exactly as a person wrote it, with why it matters and
 * the options they can see. It stays open until they answer it themselves.
 */
function RequestDecision({
  onRequest,
  busy,
}: {
  onRequest: (input: DecisionRequest) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [why, setWhy] = useState("");
  const [options, setOptions] = useState("");
  const [labels, setLabels] = useState("");

  if (!open) {
    return (
      <div className="tt-surface p-6">
        <p className="tt-eyebrow">Something you need to settle?</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Record it here so it stays visible until it is answered.
        </p>
        <TTButton size="sm" variant="secondary" className="mt-3" onClick={() => setOpen(true)}>
          Request a decision
        </TTButton>
      </div>
    );
  }

  return (
    <form
      className="tt-surface space-y-3 p-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (!question.trim() || !why.trim()) return;
        onRequest({
          question: question.trim(),
          whyItMatters: why.trim(),
          options: options
            .split("\n")
            .map((entry) => entry.trim())
            .filter(Boolean),
          labels: labels
            .split(",")
            .map((entry) => entry.trim().toLowerCase())
            .filter(Boolean),
        });
        setQuestion("");
        setWhy("");
        setOptions("");
        setLabels("");
        setOpen(false);
      }}
    >
      <p className="tt-eyebrow">Request a decision</p>
      <input
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        placeholder="The question, in one line"
        aria-label="Decision question"
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
      />
      <textarea
        value={why}
        onChange={(event) => setWhy(event.target.value)}
        rows={2}
        placeholder="Why it matters, what is blocked until it is answered"
        aria-label="Why it matters"
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
      />
      <textarea
        value={options}
        onChange={(event) => setOptions(event.target.value)}
        rows={3}
        placeholder="Options, one per line (optional)"
        aria-label="Options"
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
      />
      <input
        value={labels}
        onChange={(event) => setLabels(event.target.value)}
        placeholder="Labels, comma separated (optional)"
        aria-label="Labels"
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
      />
      <div className="flex gap-2">
        <TTButton size="sm" type="submit" disabled={!question.trim() || !why.trim() || busy}>
          {busy ? "Opening…" : "Open this decision"}
        </TTButton>
        <TTButton size="sm" variant="secondary" type="button" onClick={() => setOpen(false)}>
          Cancel
        </TTButton>
      </div>
    </form>
  );
}

function OpenDecision({
  decision,
  onResolve,
  onLabels,
  busy,
}: {
  decision: RoadmapDecision;
  onResolve: (
    decision: RoadmapDecision,
    status: Exclude<DecisionState, "open">,
    note: string,
  ) => void;
  onLabels?: (decision: RoadmapDecision, labels: string[]) => void;
  busy: boolean;
}) {
  const [note, setNote] = useState("");
  const [labelDraft, setLabelDraft] = useState("");
  const labels = decision.labels ?? [];

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
  · {option}
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

      {onLabels ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {labels.map((label) => (
            <button
              key={label}
              type="button"
              className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() =>
                onLabels(
                  decision,
                  labels.filter((entry) => entry !== label),
                )
              }
              aria-label={`Remove label ${label}`}
            >
              {label} ×
            </button>
          ))}
          <input
            value={labelDraft}
            onChange={(event) => setLabelDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !labelDraft.trim()) return;
              event.preventDefault();
              onLabels(decision, [...labels, labelDraft.trim().toLowerCase()]);
              setLabelDraft("");
            }}
            placeholder="Add a label"
            aria-label="Add a label"
            className="w-32 rounded-full border border-dashed border-border bg-background px-2.5 py-1 text-[11px]"
          />
        </div>
      ) : null}

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
