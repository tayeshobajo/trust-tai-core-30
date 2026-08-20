/**
 * The case ledger, read first.
 *
 * What was decided about a reading, what happened afterwards, what a person
 * corrected, and where repeated evidence has earned a proposal to reword a
 * pattern. Nothing on this surface changes the canon: a revision is a human
 * act taken elsewhere, deliberately.
 */

import { useState } from "react";

import { MetaPill, TTButton, TTCard } from "@/components/tt/primitives";
import { decisionFor, patternById, proposalFingerprint } from "@/data/intelligence/canon";
import type { PriorExperience } from "@/data/intelligence/canon";
import {
  PROPOSAL_DECISION_LABEL,
  type ExperienceHealth,
  type IntelligenceCase,
  type PatternOutcome,
  type PatternRevisionDecision,
  type PatternRevisionProposal,
  type ProposalDecisionKind,
} from "@/domain/intelligence-canon";

export interface CaseLedgerProps {
  open: IntelligenceCase[];
  resolved: { entry: IntelligenceCase; outcome: PatternOutcome }[];
  experience: PriorExperience[];
  /** How many open cases can be checked against the rooms right now. */
  checkable?: number;
  checking?: boolean;
  onCheck?: () => void;
  /** A person's own reading of what happened, when the rooms cannot show it. */
  onManualOutcome?: (input: {
    entry: IntelligenceCase;
    result: "success" | "failure";
    because: string;
  }) => void | Promise<void>;
  saving?: boolean;
  notice?: string;
  /** Answers already given to revision proposals. */
  proposalDecisions?: PatternRevisionDecision[];
  onProposalDecision?: (input: {
    proposal: PatternRevisionProposal;
    decision: ProposalDecisionKind;
    note?: string;
  }) => void | Promise<void>;
  decidingProposal?: boolean;
  /** Seven day read of whether experience is accumulating at all. */
  health?: ExperienceHealth;
}

function patternName(patternId: string): string {
  return patternById(patternId)?.name ?? patternId;
}

export function CaseLedgerPanel({
  open,
  resolved,
  experience,
  checkable,
  checking,
  onCheck,
  onManualOutcome,
  saving,
  notice,
  proposalDecisions,
  onProposalDecision,
  decidingProposal,
  health,
}: CaseLedgerProps) {
  const corrections = experience.filter((row) => row.corrections.length > 0);
  const proposals = experience.filter((row) => row.proposal);

  return (
    <section className="space-y-4" aria-labelledby="case-ledger-heading">
      <div>
        <p className="tt-eyebrow">Case ledger</p>
        <h3 id="case-ledger-heading" className="mt-1 text-[15px] font-semibold text-foreground">
          What we have learned from acting on these readings
        </h3>
        <p className="mt-1 max-w-reading text-[13px] text-muted-foreground">
          Cases hold references and decisions only. The rooms keep owning the work itself.
        </p>
        {notice ? <p className="mt-2 text-[13px] text-muted-foreground">{notice}</p> : null}
      </div>

      {onCheck ? (
        <div className="flex flex-wrap items-center gap-3">
          <TTButton variant="quiet" disabled={checking || (checkable ?? 0) === 0} onClick={onCheck}>
            {checking ? "Checking the rooms" : "Check what happened"}
          </TTButton>
          <p className="text-[13px] text-muted-foreground">
            {(checkable ?? 0) === 0
              ? "No open case can be settled from what the rooms currently show."
              : `${checkable} open case${checkable === 1 ? "" : "s"} can be checked against the rooms.`}
          </p>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <TTCard className="p-4">
          <p className="tt-eyebrow">Open cases</p>
          {open.length === 0 ? (
            <p className="mt-1 text-[13px] text-muted-foreground">
              Nothing is waiting on a result.
            </p>
          ) : (
            <ul className="mt-2 space-y-3">
              {open.map((entry) => (
                <OpenCaseRow
                  key={entry.id}
                  entry={entry}
                  {...(onManualOutcome ? { onManualOutcome } : {})}
                  {...(saving !== undefined ? { saving } : {})}
                />
              ))}
            </ul>
          )}
        </TTCard>

        <TTCard className="p-4">
          <p className="tt-eyebrow">Resolved cases</p>
          {resolved.length === 0 ? (
            <p className="mt-1 text-[13px] text-muted-foreground">
              No case has a result recorded against it yet.
            </p>
          ) : (
            <ul className="mt-2 space-y-3">
              {resolved.map(({ entry, outcome }) => (
                <li key={entry.id} className="text-[13px]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <MetaPill>{patternName(entry.patternId)}</MetaPill>
                    <MetaPill>{RESULT_LABEL[outcome.result]}</MetaPill>
                  </div>
                  <p className="mt-1 text-foreground">{entry.humanDecision}</p>
                  <p className="mt-0.5 text-muted-foreground">{outcome.resultBecause}</p>
                  {outcome.humanCorrection ? (
                    <p className="mt-0.5 text-foreground">
                      You corrected this: {outcome.humanCorrection}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </TTCard>
      </div>

      {corrections.length > 0 ? (
        <TTCard className="p-4">
          <p className="tt-eyebrow">Your corrections</p>
          <ul className="mt-2 space-y-2 text-[13px]">
            {corrections.map((row) => (
              <li key={row.patternId}>
                <span className="text-foreground">{patternName(row.patternId)}: </span>
                <span className="text-muted-foreground">{row.corrections[0]}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-muted-foreground">
            A correction you wrote outranks anything worked out from results.
          </p>
        </TTCard>
      ) : null}

      {experience.length > 0 ? (
        <TTCard className="p-4">
          <p className="tt-eyebrow">Pattern standing</p>
          <ul className="mt-2 space-y-2 text-[13px]">
            {experience.map((row) => (
              <li key={row.patternId}>
                <span className="text-foreground">{patternName(row.patternId)}: </span>
                <span className="text-muted-foreground">{row.standing.guidance}</span>
              </li>
            ))}
          </ul>
        </TTCard>
      ) : null}

      {proposals.length > 0 ? (
        <TTCard className="p-4">
          <p className="tt-eyebrow">Revision proposals</p>
          <ul className="mt-2 space-y-4 text-[13px]">
            {proposals.map((row) => (
              <ProposalRow
                key={row.patternId}
                name={patternName(row.patternId)}
                proposal={row.proposal!}
                decisions={proposalDecisions ?? []}
                {...(onProposalDecision ? { onDecide: onProposalDecision } : {})}
                {...(decidingProposal !== undefined ? { saving: decidingProposal } : {})}
              />
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-muted-foreground">
            Accepting authorises a later review of the pattern wording. It does not change any
            pattern now, and no room behaves differently today.
          </p>
        </TTCard>
      ) : null}

      {health ? (
        <TTCard className="p-4">
          <p className="tt-eyebrow">Last seven days</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-3">
            <HealthStat label="Cases opened" value={health.casesOpened} />
            <HealthStat label="Cases resolved" value={health.casesResolved} />
            <HealthStat label="Corrections you wrote" value={health.corrections} />
            <HealthStat label="Patterns with enough results" value={health.patternsWithEnoughOutcomes} />
            <HealthStat label="Proposals awaiting you" value={health.proposalsAwaitingDecision} />
            <HealthStat
              label="Oldest open case"
              value={
                health.oldestOpenCaseDays === null
                  ? "None open"
                  : `${health.oldestOpenCaseDays} day${health.oldestOpenCaseDays === 1 ? "" : "s"}`
              }
            />
          </dl>
          <p className="mt-2 text-[12px] text-muted-foreground">
            Counted from the ledger only. Zero is a truthful answer, not a bad one.
          </p>
        </TTCard>
      ) : null}

    </section>
  );
}

const RESULT_LABEL: Record<string, string> = {
  success: "Held up",
  failure: "Did not hold",
  unknown: "Not readable",
};

function OpenCaseRow({
  entry,
  onManualOutcome,
  saving,
}: {
  entry: IntelligenceCase;
  onManualOutcome?: CaseLedgerProps["onManualOutcome"];
  saving?: boolean;
}) {
  const [because, setBecause] = useState("");
  const [open, setOpen] = useState(false);

  return (
    <li className="text-[13px]">
      <MetaPill>{patternName(entry.patternId)}</MetaPill>
      <p className="mt-1 text-foreground">{entry.humanDecision}</p>
      {entry.correction ? (
        <p className="mt-0.5 text-foreground">You corrected the reading: {entry.correction}</p>
      ) : null}
      <p className="mt-0.5 text-muted-foreground">{entry.hypothesis}</p>

      {onManualOutcome ? (
        open ? (
          <div className="mt-2 space-y-2">
            <input
              value={because}
              onChange={(event) => setBecause(event.target.value)}
              placeholder="What actually happened"
              className="w-full rounded-md border border-border bg-transparent p-2 text-[13px] outline-none focus:border-foreground"
            />
            <div className="flex flex-wrap gap-2">
              <TTButton
                variant="secondary"
                disabled={saving || because.trim().length === 0}
                onClick={() =>
                  void onManualOutcome({ entry, result: "success", because: because.trim() })
                }
              >
                It worked
              </TTButton>
              <TTButton
                variant="quiet"
                disabled={saving || because.trim().length === 0}
                onClick={() =>
                  void onManualOutcome({ entry, result: "failure", because: because.trim() })
                }
              >
                It did not work
              </TTButton>
            </div>
          </div>
        ) : (
          <TTButton className="mt-2" variant="quiet" onClick={() => setOpen(true)}>
            Record what happened
          </TTButton>
        )
      ) : null}
    </li>
  );
}

function HealthStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}

const PROPOSAL_ORDER: ProposalDecisionKind[] = ["accepted", "rejected", "deferred"];

const PROPOSAL_ANSWER: Record<ProposalDecisionKind, string> = {
  accepted: "You accepted this for a later canon review.",
  rejected: "You rejected this wording.",
  deferred: "You set this aside for now.",
};

function ProposalRow({
  name,
  proposal,
  decisions,
  onDecide,
  saving,
}: {
  name: string;
  proposal: PatternRevisionProposal;
  decisions: PatternRevisionDecision[];
  onDecide?: CaseLedgerProps["onProposalDecision"];
  saving?: boolean;
}) {
  const [note, setNote] = useState("");
  const answered = decisionFor(proposal, decisions);

  return (
    <li>
      <span className="text-foreground">{name}: </span>
      <span className="text-muted-foreground">{proposal.suggestion}</span>
      {answered ? (
        <p className="mt-1 text-[12px] text-muted-foreground">
          {PROPOSAL_ANSWER[answered.decision]}
          {answered.note ? ` ${answered.note}` : ""}
        </p>
      ) : onDecide ? (
        <div className="mt-2 space-y-2">
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Add a note, if it helps a later reviewer"
            aria-label={`Note on the proposal for ${name}`}
            className="w-full rounded-md border border-border bg-transparent p-2 text-[13px] outline-none focus:border-foreground"
          />
          <div className="flex flex-wrap gap-2">
            {PROPOSAL_ORDER.map((kind) => (
              <TTButton
                key={`${proposalFingerprint(proposal)}-${kind}`}
                variant={kind === "accepted" ? "secondary" : "quiet"}
                disabled={saving}
                onClick={() =>
                  void onDecide({
                    proposal,
                    decision: kind,
                    ...(note.trim().length > 0 ? { note: note.trim() } : {}),
                  })
                }
              >
                {PROPOSAL_DECISION_LABEL[kind]}
              </TTButton>
            ))}
          </div>
        </div>
      ) : null}
    </li>
  );
}
