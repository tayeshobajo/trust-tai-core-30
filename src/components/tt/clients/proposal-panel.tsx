/**
 * The human path into a proposal, on the lineage node that already owns it.
 *
 * A proposal lives on the roadmap this company already has: there is no deal
 * object and no second pipeline. A person says the amount and the day it went
 * out, and later says what came back. Nothing here is derived, suggested or
 * filled in by the system, and an answer already recorded is shown, never
 * quietly rewritten.
 */

import { useState } from "react";

import {
  MetaPill,
  SectionHeading,
  TTButton,
  TTCard,
  TTField,
  TTInput,
} from "@/components/tt/primitives";
import {
  answered,
  proposalOutcomeRefusal,
  readProposalOutcomeForm,
  readProposalSentForm,
  type ProposalFormCurrent,
  type ProposalOutcomeIntent,
  type ProposalSentIntent,
} from "@/domain/proposal-form";

export interface ProposalLineageNode {
  roadmapId: string;
  title: string;
  current: ProposalFormCurrent;
}

export interface ProposalPanelProps {
  nodes: ProposalLineageNode[];
  pendingRoadmapId: string | null;
  problem: string | null;
  savedRoadmapId: string | null;
  onSend: (input: { roadmapId: string } & ProposalSentIntent) => void;
  onAnswer: (input: { roadmapId: string } & ProposalOutcomeIntent) => void;
}


function money(cents: number | null): string {
  if (cents === null) return "amount not recorded";
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function NodeCard({
  node,
  pending,
  problem,
  saved,
  onSend,
  onAnswer,
}: {
  node: ProposalLineageNode;
  pending: boolean;
  problem: string | null;
  saved: boolean;
  onSend: ProposalPanelProps["onSend"];
  onAnswer: ProposalPanelProps["onAnswer"];
}) {
  const [amount, setAmount] = useState("");
  const [sentOn, setSentOn] = useState("");
  const [answeredOn, setAnsweredOn] = useState("");

  const [refusal, setRefusal] = useState<string | null>(null);

  const current = node.current;
  const isAnswered = answered(current);
  const sent = current.sentAt !== null;

  return (
    <TTCard className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-foreground">{node.title}</p>
        {sent ? <MetaPill>{current.outcome ?? "open"}</MetaPill> : <MetaPill>no proposal</MetaPill>}
      </div>

      <p className="mt-2 text-sm text-muted-foreground">
        {sent
          ? `Sent ${current.sentAt?.slice(0, 10)} for ${money(current.amountCents)}.`
          : "No proposal has been recorded on this roadmap. Nothing is assumed to have been sent."}
      </p>

      {!isAnswered ? (
        <form
          className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            const result = readProposalSentForm({ amount, sentOn }, current);
            if (!result.ok) {
              setRefusal(result.because);
              return;
            }
            setRefusal(null);
            onSend({ roadmapId: node.roadmapId, ...result.intent });
          }}
        >
          <TTField label="Proposal amount" hint="In whole currency, like 3500.">
            <TTInput
              inputMode="decimal"
              value={amount}
              placeholder="Not set"
              onChange={(event) => setAmount(event.target.value)}
            />
          </TTField>
          <TTField label="Day it went out">
            <TTInput
              type="date"
              value={sentOn}
              onChange={(event) => setSentOn(event.target.value)}
            />
          </TTField>
          <TTButton type="submit" pending={pending} pendingLabel="Recording">
            {sent ? "Correct what was sent" : "Record proposal sent"}
          </TTButton>
        </form>
      ) : null}

      {sent && !isAnswered ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <span className="tt-eyebrow">What came back</span>
          {(["signed", "declined"] as const).map((outcome) => {
            const because = proposalOutcomeRefusal(current, outcome);
            return (
              <TTButton
                key={outcome}
                type="button"
                variant={outcome === "signed" ? "primary" : "secondary"}
                disabled={pending || because !== null}
                onClick={() => {
                  if (because) {
                    setRefusal(because);
                    return;
                  }
                  setRefusal(null);
                  onAnswer({ roadmapId: node.roadmapId, outcome });
                }}
              >
                {outcome === "signed" ? "Record signed" : "Record declined"}
              </TTButton>
            );
          })}
        </div>
      ) : null}

      {isAnswered ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Answered {current.outcome} on {current.sentAt?.slice(0, 10)}. A recorded answer is not
          rewritten here.
        </p>
      ) : null}

      {refusal ? (
        <p role="alert" className="mt-3 text-sm font-medium text-destructive">
          {refusal}
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="mt-3 text-sm font-medium text-destructive">
          {problem}
        </p>
      ) : null}
      {saved && !pending ? <p className="mt-3 text-sm text-muted-foreground">Recorded.</p> : null}
    </TTCard>
  );
}

export function ProposalPanel({
  nodes,
  pendingRoadmapId,
  problem,
  savedRoadmapId,
  onSend,
  onAnswer,
}: ProposalPanelProps) {
  return (
    <section className="space-y-4">
      <SectionHeading
        title="Proposal"
        description="Recorded by a person on the roadmap this company already has. Nothing here is read from a document, a message or a model."
      />
      {nodes.length === 0 ? (
        <TTCard className="p-5">
          <p className="text-sm text-muted-foreground">
            A proposal belongs to a roadmap. This company has none yet, so there is nothing to
            record a proposal against.
          </p>
        </TTCard>
      ) : (
        nodes.map((node) => (
          <NodeCard
            key={node.roadmapId}
            node={node}
            pending={pendingRoadmapId === node.roadmapId}
            problem={
              pendingRoadmapId === node.roadmapId || savedRoadmapId === node.roadmapId
                ? problem
                : null
            }
            saved={savedRoadmapId === node.roadmapId}
            onSend={onSend}
            onAnswer={onAnswer}
          />
        ))
      )}
    </section>
  );
}
