/**
 * The semantic review surface.
 *
 * A person reads meaning, not speech. Each row leads with one operational
 * sentence Steward is willing to stand behind; the transcript line, the
 * reasoning, and anything still ambiguous sit behind disclosure. Passages
 * Steward judged to be context, doubt or repetition are counted, not paraded.
 *
 * This is also where Steward learns. A person can put a reading right before
 * confirming it — the meaning, who carries it, who it is for, which work it
 * belongs to, what was said about timing — and every field that moves is
 * remembered as a correction taught by a named person. Correcting is never
 * punished with extra steps: edit in place, confirm once.
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
import {
  STATE_CHANGE_LABEL,
  type CorrectionDraft,
  type MemoryConflict,
  type StateChangeProposal,
} from "@/domain/steward-memory";
import { correctionsFromEdit } from "@/data/steward/learning";
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

/**
 * Where memory and this conversation disagree.
 *
 * Shown side by side, in full, with who taught Steward the remembered side and
 * when. Steward does not pick. A person reads both sentences and says which is
 * true now — memory going stale is as ordinary as a reading going wrong.
 */
function ConflictBanner({
  conflict,
  onResolve,
}: {
  conflict: MemoryConflict;
  onResolve?: (conflict: MemoryConflict, keep: "memory" | "transcript") => void;
}) {
  const [settled, setSettled] = useState<"memory" | "transcript" | null>(null);

  return (
    <div className="mt-3 border-l-2 border-foreground/40 pl-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground">
        This disagrees with something you decided before
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="tt-surface p-3">
          <p className="tt-eyebrow">What Steward remembers</p>
          <p className="mt-1 text-sm text-foreground">{conflict.memorySays}</p>
          {conflict.beliefStatement ? (
            <p className="mt-1 text-[13px] text-muted-foreground">“{conflict.beliefStatement}”</p>
          ) : null}
          <p className="mt-2 text-[13px] text-muted-foreground">
            {conflict.memoryRecordedBy
              ? `Taught by ${conflict.memoryRecordedBy}`
              : "Recorded earlier"}
            {conflict.memoryRecordedAt ? ` on ${conflict.memoryRecordedAt.slice(0, 10)}` : ""}.
          </p>
          {onResolve ? (
            <TTButton
              type="button"
              variant="secondary"
              className="mt-3"
              disabled={settled !== null}
              onClick={() => {
                setSettled("memory");
                onResolve(conflict, "memory");
              }}
            >
              {settled === "memory" ? "Kept" : "Memory is still right"}
            </TTButton>
          ) : null}
        </div>
        <div className="tt-surface p-3">
          <p className="tt-eyebrow">What this conversation says</p>
          <p className="mt-1 text-sm text-foreground">{conflict.transcriptSays}</p>
          {conflict.transcriptStatement ? (
            <p className="mt-1 text-[13px] text-muted-foreground">
              “{conflict.transcriptStatement}”
            </p>
          ) : null}
          <p className="mt-2 text-[13px] text-muted-foreground">Heard in this conversation.</p>
          {onResolve ? (
            <TTButton
              type="button"
              variant="secondary"
              className="mt-3"
              disabled={settled !== null}
              onClick={() => {
                setSettled("transcript");
                onResolve(conflict, "transcript");
              }}
            >
              {settled === "transcript" ? "Updated" : "This is true now"}
            </TTButton>
          ) : null}
        </div>
      </div>
      <p className="mt-2 text-[13px] text-muted-foreground">{conflict.because}</p>
    </div>
  );
}

function SignalRow({
  signal,
  names,
  confirmed,
  conflicts,
  continuity,
  onConfirm,
  onCorrect,
  onDismiss,
  onResolveConflict,
  readOnlyBecause,
}: {
  signal: InterpretedSignal;
  names: string[];
  confirmed: boolean;
  conflicts: MemoryConflict[];
  continuity: StateChangeProposal[];
  onConfirm?: (input: ConfirmInput) => void;
  onCorrect?: (corrections: CorrectionDraft[]) => void;
  onDismiss?: (signal: InterpretedSignal) => void;
  onResolveConflict?: (conflict: MemoryConflict, keep: "memory" | "transcript") => void;
  readOnlyBecause?: string;
}) {
  const [meaning, setMeaning] = useState(signal.normalizedMeaning);
  const [ownerName, setOwnerName] = useState(signal.ownerName ?? "");
  const [beneficiary, setBeneficiary] = useState(signal.beneficiary ?? "");
  const [dueText, setDueText] = useState(signal.dueText ?? "");
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  /* Editing then confirming is a different act from confirming as read. */
  const edited =
    meaning.trim() !== signal.normalizedMeaning.trim() ||
    ownerName.trim() !== (signal.ownerName ?? "").trim() ||
    beneficiary.trim() !== (signal.beneficiary ?? "").trim() ||
    dueText.trim() !== (signal.dueText ?? "").trim();


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
        <p className="mt-2 text-[13px] text-muted-foreground">Still unclear: {signal.ambiguity}</p>
      ) : null}

      {continuity.map((proposal) => (
        <p
          key={proposal.commitmentId}
          className="mt-3 border-l-2 border-border pl-3 text-[13px] text-muted-foreground"
        >
          {STATE_CHANGE_LABEL[proposal.kind]} Steward thinks this continues “
          {proposal.commitmentStatement}”, currently {proposal.currentStatus}. It has not changed
          anything — mark it yourself if that is right.
        </p>
      ))}

      {conflicts.map((conflict, index) => (
        <ConflictBanner
          key={conflict.beliefId ?? index}
          conflict={conflict}
          {...(onResolveConflict ? { onResolve: onResolveConflict } : {})}
        />
      ))}


      <Evidence signal={signal} />

      {confirmed ? (
        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Already a commitment in this workspace
        </p>
      ) : readOnlyBecause ? (
        <p className="mt-4 text-[13px] text-muted-foreground">{readOnlyBecause}</p>
      ) : onConfirm ? (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Put it in your own words — Steward remembers what you change
          </p>
          <label className="block">
            <span className="tt-eyebrow">What this actually is</span>
            <TTInput
              className="mt-2"
              value={meaning}
              onChange={(event) => setMeaning(event.target.value)}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
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
              <span className="tt-eyebrow">Who it is for</span>
              <TTInput
                className="mt-2"
                value={beneficiary}
                onChange={(event) => setBeneficiary(event.target.value)}
                placeholder="Optional"
              />
            </label>
            <label className="block">
              <span className="tt-eyebrow">Timing as said</span>
              <TTInput
                className="mt-2"
                value={dueText}
                onChange={(event) => setDueText(event.target.value)}
                placeholder="Optional"
              />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="block">
              <span className="tt-eyebrow">Due date (optional)</span>
              <TTInput
                className="mt-2"
                type="date"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <TTButton
                type="button"
                disabled={
                  ownerName.trim().length === 0 || meaning.trim().length === 0 || busy || dismissed
                }
                onClick={() => {
                  setBusy(true);
                  const corrections = correctionsFromEdit({
                    signal,
                    edit: {
                      normalizedMeaning: meaning,
                      ownerName,
                      beneficiary,
                      dueText,
                    },
                  });
                  if (corrections.length > 0) onCorrect?.(corrections);

                  const proposal = signalToProposal(signal);
                  onConfirm({
                    proposal: {
                      ...proposal,
                      statement: meaning.trim(),
                      ownerName: ownerName.trim(),
                      ownerResolved: true,
                      beneficiary: beneficiary.trim() || null,
                      dueText: dueText.trim() || null,
                    },
                    ownerName: ownerName.trim(),
                    dueAt: dueAt ? new Date(`${dueAt}T12:00:00`).toISOString() : null,
                  });
                  setBusy(false);
                }}
              >
                {busy ? "Confirming…" : edited ? "Edit & confirm" : "Confirm"}
              </TTButton>
              {/* Not everything said is work. Saying so is feedback, not deletion. */}
              {onDismiss ? (
                <TTButton
                  type="button"
                  variant="secondary"
                  disabled={busy || dismissed}
                  onClick={() => {
                    setDismissed(true);
                    onDismiss(signal);
                  }}
                >
                  {dismissed ? "Dismissed as context" : "Dismiss as context"}
                </TTButton>
              ) : null}
            </div>
          </div>
          {dismissed ? (
            <p className="text-[13px] text-muted-foreground">
              Recorded as context. Steward will raise this shape of reading less often.
            </p>
          ) : null}
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
  stateChanges = [],
  conflicts = [],
  onConfirm,
  onCorrect,
  readOnlyBecause,
}: {
  run: InterpretationRun;
  names: string[];
  confirmedKeys: Set<string>;
  stateChanges?: StateChangeProposal[];
  conflicts?: MemoryConflict[];
  onConfirm?: (input: ConfirmInput) => void;
  onCorrect?: (corrections: CorrectionDraft[]) => void;
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
        {stateChanges.length > 0 ? (
          <MetaPill>{stateChanges.length} may continue existing work</MetaPill>
        ) : null}
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
                    conflicts={conflicts.filter((conflict) => conflict.signalId === signal.id)}
                    continuity={stateChanges.filter((change) => change.signalId === signal.id)}
                    {...(onConfirm ? { onConfirm } : {})}
                    {...(onCorrect ? { onCorrect } : {})}
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
                <p className="text-sm text-foreground">{signal.normalizedMeaning || signal.quote}</p>
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
