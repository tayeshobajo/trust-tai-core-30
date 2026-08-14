/**
 * The semantic review surface.
 *
 * A person reads meaning, not speech. Each row leads with one operational
 * sentence Steward is willing to stand behind; the transcript line, the
 * reasoning, and anything still ambiguous sit behind disclosure. Passages
 * Steward judged to be context, doubt or repetition are counted, not paraded.
 *
 * Nothing here is truth. Confirmation is the only thing that makes it truth.
 */

import { useState } from "react";

import { MetaPill, TTButton, TTInput } from "@/components/tt/primitives";
import { CONFIDENCE_LEVEL_LABEL } from "@/domain/confidence";
import { TRUTH_TIER_LABEL } from "@/domain/signals";
import {
  DISPOSITION_LABEL,
  REVIEWABLE_DISPOSITIONS,
  dispositionCounts,
  type InterpretationRun,
  type InterpretedSignal,
  type SemanticDisposition,
} from "@/domain/steward-semantic";
import { reviewableSignals, signalToProposal, withheldSignals } from "@/data/steward/interpretation";
import type { ConfirmInput } from "@/components/tt/steward/proposal-review";

function Evidence({ signal }: { signal: InterpretedSignal }) {
  return (
    <details className="group mt-3">
      <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground">
        <span className="group-open:hidden">What was actually said →</span>
        <span className="hidden group-open:inline">Hide the transcript</span>
      </summary>
      <blockquote className="mt-3 border-l-2 border-border pl-3 text-sm text-foreground">
        “{signal.quote}”
      </blockquote>
      <p className="mt-2 text-[13px] text-muted-foreground">{signal.rationale}</p>
      <ul className="mt-2 space-y-1">
        {signal.evidence.map((item, index) => (
          <li key={index} className="text-[13px] text-muted-foreground">
            {item.url ? (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4 hover:text-foreground"
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
  );
}

function SignalRow({
  signal,
  names,
  confirmed,
  onConfirm,
  readOnlyBecause,
}: {
  signal: InterpretedSignal;
  names: string[];
  confirmed: boolean;
  onConfirm?: (input: ConfirmInput) => void;
  readOnlyBecause?: string;
}) {
  const [ownerName, setOwnerName] = useState(signal.ownerName ?? "");
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <li className="tt-surface p-5">
      <div className="flex flex-wrap items-center gap-2">
        <MetaPill>{DISPOSITION_LABEL[signal.disposition]}</MetaPill>
        <MetaPill>{TRUTH_TIER_LABEL[signal.truthTier]}</MetaPill>
        <MetaPill>{CONFIDENCE_LEVEL_LABEL[signal.confidence]}</MetaPill>
        <MetaPill>{signal.at}</MetaPill>
        {confirmed ? <MetaPill>Confirmed</MetaPill> : null}
      </div>

      <p className="mt-3 max-w-reading text-[15px] text-foreground">{signal.normalizedMeaning}</p>

      <p className="mt-2 text-sm text-muted-foreground">
        {signal.ownerName
          ? `Steward reads ${signal.ownerName} as carrying this${
              signal.ownerConfidence === "high" ? "" : ", though not with certainty"
            }.`
          : "Nobody was clearly named. Steward will not choose an owner."}
        {signal.dueText
          ? ` Timing was said as “${signal.dueText}”, which is not a date until you set one.`
          : " No timing was said."}
        {signal.blockedBy ? ` Waiting on ${signal.blockedBy}.` : ""}
      </p>

      {signal.ambiguity ? (
        <p className="mt-2 text-[13px] text-muted-foreground">
          Still unclear: {signal.ambiguity}
        </p>
      ) : null}

      <Evidence signal={signal} />

      {confirmed ? (
        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Already a commitment in this workspace
        </p>
      ) : readOnlyBecause ? (
        <p className="mt-4 text-[13px] text-muted-foreground">{readOnlyBecause}</p>
      ) : onConfirm ? (
        <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-[1.2fr_1fr_auto] sm:items-end">
          <label className="block">
            <span className="tt-eyebrow">Who carries it</span>
            <TTInput
              className="mt-2"
              list={`people-${signal.id}`}
              value={ownerName}
              onChange={(event) => setOwnerName(event.target.value)}
              placeholder="Name the owner"
            />
            <datalist id={`people-${signal.id}`}>
              {names.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </label>
          <label className="block">
            <span className="tt-eyebrow">Due date (optional)</span>
            <TTInput
              className="mt-2"
              type="date"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </label>
          <TTButton
            type="button"
            disabled={ownerName.trim().length === 0 || busy}
            onClick={() => {
              setBusy(true);
              onConfirm({
                proposal: signalToProposal(signal),
                ownerName: ownerName.trim(),
                dueAt: dueAt ? new Date(`${dueAt}T12:00:00`).toISOString() : null,
              });
              setBusy(false);
            }}
          >
            {busy ? "Confirming…" : "Confirm"}
          </TTButton>
        </div>
      ) : null}
    </li>
  );
}

const ORDER: SemanticDisposition[] = REVIEWABLE_DISPOSITIONS;

export function SemanticReview({
  run,
  names,
  confirmedKeys,
  onConfirm,
  readOnlyBecause,
}: {
  run: InterpretationRun;
  names: string[];
  confirmedKeys: Set<string>;
  onConfirm?: (input: ConfirmInput) => void;
  readOnlyBecause?: string;
}) {
  const reviewable = reviewableSignals(run.signals);
  const withheld = withheldSignals(run.signals);
  const counts = dispositionCounts(run.signals);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap gap-2">
        <MetaPill>{run.candidateCount} passages read</MetaPill>
        <MetaPill>{reviewable.length} worth your attention</MetaPill>
        <MetaPill>{withheld.length} held back</MetaPill>
      </div>

      {run.memory.available ? null : (
        <p className="tt-surface p-4 text-[13px] text-muted-foreground">{run.memory.because}</p>
      )}

      {reviewable.length === 0 ? (
        <p className="tt-surface p-6 text-sm text-muted-foreground">
          Steward read this conversation and found nothing it can honestly call a commitment, a
          decision or a dependency. That is a real answer, not an empty screen.
        </p>
      ) : (
        ORDER.filter((disposition) =>
          reviewable.some((signal) => signal.disposition === disposition),
        ).map((disposition) => (
          <section key={disposition}>
            <h3 className="tt-eyebrow">
              {DISPOSITION_LABEL[disposition]} · {counts[disposition]}
            </h3>
            <ul className="mt-3 space-y-3">
              {reviewable
                .filter((signal) => signal.disposition === disposition)
                .map((signal) => (
                  <SignalRow
                    key={signal.id}
                    signal={signal}
                    names={names}
                    confirmed={confirmedKeys.has(signal.candidateId)}
                    {...(onConfirm ? { onConfirm } : {})}
                    {...(readOnlyBecause ? { readOnlyBecause } : {})}
                  />
                ))}
            </ul>
          </section>
        ))
      )}

      {withheld.length > 0 ? (
        <details className="tt-surface p-5">
          <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Held back · {withheld.length} passages Steward chose not to raise
          </summary>
          <ul className="mt-4 space-y-3">
            {withheld.map((signal) => (
              <li key={signal.id} className="border-l-2 border-border pl-3">
                <p className="text-[13px] text-muted-foreground">
                  {DISPOSITION_LABEL[signal.disposition]} · {signal.at}
                </p>
                <p className="text-sm text-foreground">
                  {signal.normalizedMeaning || signal.quote}
                </p>
                <p className="text-[13px] text-muted-foreground">
                  {signal.ambiguity || signal.rationale}
                </p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
