/**
 * The review surface: what Steward heard, and what a person decides.
 *
 * Every proposal shows its tier, its confidence, and the exact line it came
 * from. Nothing becomes workspace truth until someone confirms it, and a
 * proposal with no owner cannot be confirmed until a person names one.
 */

import { useState } from "react";

import { MetaPill, TTButton, TTInput } from "@/components/tt/primitives";
import { CONFIDENCE_LEVEL_LABEL } from "@/domain/confidence";
import { TRUTH_TIER_LABEL } from "@/domain/signals";
import {
  PROPOSAL_KIND_LABEL,
  type NormalizedConversation,
  type Proposal,
  type ProposalKind,
} from "@/domain/steward";
import { groupProposals } from "@/data/steward/extract";

export interface ConfirmInput {
  proposal: Proposal;
  ownerName: string;
  dueAt: string | null;
}

const ORDER: ProposalKind[] = ["action", "follow_up", "decision", "blocker", "question"];

function Evidence({ proposal }: { proposal: Proposal }) {
  return (
    <details className="group mt-3">
      <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground">
        <span className="group-open:hidden">Why we think this →</span>
        <span className="hidden group-open:inline">Hide the line</span>
      </summary>
      <blockquote className="mt-3 border-l-2 border-border pl-3 text-sm text-foreground">
        “{proposal.quote}”
      </blockquote>
      <ul className="mt-2 space-y-1">
        {proposal.evidence.map((item, index) => (
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

function ProposalRow({
  proposal,
  participants,
  confirmed,
  onConfirm,
  readOnlyBecause,
}: {
  proposal: Proposal;
  participants: string[];
  confirmed: boolean;
  onConfirm?: (input: ConfirmInput) => void;
  readOnlyBecause?: string;
}) {
  const [ownerName, setOwnerName] = useState(proposal.ownerName ?? "");
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);

  const needsOwner = ownerName.trim().length === 0;

  return (
    <li className="tt-surface p-5">
      <div className="flex flex-wrap items-center gap-2">
        <MetaPill>{TRUTH_TIER_LABEL[proposal.tier]}</MetaPill>
        <MetaPill>{CONFIDENCE_LEVEL_LABEL[proposal.confidence]}</MetaPill>
        <MetaPill>{proposal.at}</MetaPill>
        {confirmed ? <MetaPill>Confirmed</MetaPill> : null}
      </div>
      <p className="mt-3 max-w-reading text-[15px] text-foreground">{proposal.statement}</p>
      <p className="mt-2 text-sm text-muted-foreground">
        {proposal.ownerResolved
          ? `Steward heard ${proposal.ownerName} take this on.`
          : "Nobody was named. Steward will not choose an owner."}
        {proposal.dueText
          ? ` Timing was said as “${proposal.dueText}”, which is not a date until you set one.`
          : " No timing was said."}
      </p>

      <Evidence proposal={proposal} />

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
              list={`participants-${proposal.id}`}
              value={ownerName}
              onChange={(event) => setOwnerName(event.target.value)}
              placeholder="Name the owner"
            />
            <datalist id={`participants-${proposal.id}`}>
              {participants.map((name) => (
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
            disabled={needsOwner || busy}
            onClick={() => {
              setBusy(true);
              onConfirm({
                proposal,
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

export function ProposalReview({
  conversation,
  proposals,
  confirmedKeys,
  onConfirm,
  readOnlyBecause,
}: {
  conversation: NormalizedConversation;
  proposals: Proposal[];
  confirmedKeys: Set<string>;
  onConfirm?: (input: ConfirmInput) => void;
  readOnlyBecause?: string;
}) {
  const grouped = groupProposals(proposals);
  const participants = conversation.participants.map((person) => person.name);
  const speakers = Array.from(new Set(conversation.segments.map((segment) => segment.speaker)));
  const names = Array.from(new Set([...participants, ...speakers]));

  if (proposals.length === 0) {
    return (
      <p className="tt-surface p-6 text-sm text-muted-foreground">
        Steward read the transcript and found nothing it can honestly call an action, a decision or
        a blocker. That is a real answer, not an empty screen.
      </p>
    );
  }

  return (
    <div className="space-y-8">
      {ORDER.filter((kind) => grouped[kind].length > 0).map((kind) => (
        <section key={kind}>
          <h3 className="tt-eyebrow">
            {PROPOSAL_KIND_LABEL[kind]} · {grouped[kind].length}
          </h3>
          <ul className="mt-3 space-y-3">
            {grouped[kind].map((proposal) => (
              <ProposalRow
                key={proposal.id}
                proposal={proposal}
                participants={names}
                confirmed={confirmedKeys.has(proposal.id)}
                {...(onConfirm ? { onConfirm } : {})}
                {...(readOnlyBecause ? { readOnlyBecause } : {})}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
