/**
 * Handoff to Comms.
 *
 * A brief, not a message: who to contact, what the conversation is for, and
 * the context Comms cannot work without. Every line is derived from stored
 * evidence and carries its tier. Nothing here sends anything.
 */

import { useMemo, useState } from "react";

import { buildHandoffDraft } from "@/data/comms-handoff";
import type { ConfidenceRead } from "@/domain/confidence";
import { HANDOFF_INTENT_LABEL, type HandoffDraft } from "@/domain/comms-handoff";
import { EMAIL_STATUS_LABEL, type Person } from "@/domain/people";
import type { ModuleEmphasis, ResearchCoverage } from "@/domain/prospect-modules";
import type { ProspectCandidate } from "@/domain/scout";
import { TTButton } from "@/components/tt/primitives";
import { cn } from "@/lib/utils";

import { ConfidenceChip, EvidenceLinks, Panel, TierTag } from "./panel";

const TIER_LABEL = { fact: "Read", inference: "Inferred", decision: "Decided" } as const;

export function HandoffPanel({
  candidate,
  coverage,
  people,
  fitConfidence,
  onRoute,
  routed,
  busy,
  emphasis,
}: {
  candidate: ProspectCandidate;
  coverage: ResearchCoverage;
  people: Person[];
  fitConfidence: ConfidenceRead;
  onRoute: (draft: HandoffDraft) => void;
  /** True once this company has already been carried across to Comms. */
  routed: boolean;
  busy?: boolean | undefined;
  emphasis?: ModuleEmphasis | undefined;
}) {
  const [open, setOpen] = useState(false);
  const draft = useMemo(
    () => buildHandoffDraft({ candidate, people, coverage, fitConfidence }),
    [candidate, people, coverage, fitConfidence],
  );

  return (
    <Panel
      eyebrow="Handoff"
      title={routed ? "Already carried to Comms" : "Prepare the Comms brief"}
      description={
        routed
          ? `${draft.companyName} has been handed over. Comms holds the context; a person still writes the message.`
          : draft.ready
            ? `${draft.companyName} can be carried across with its context intact.`
            : `${draft.blockers.length} thing${draft.blockers.length === 1 ? "" : "s"} still stand${draft.blockers.length === 1 ? "s" : ""} in the way.`
      }
      aside={
        <div className="flex items-center gap-2">
          <ConfidenceChip level={draft.confidence.level} />
          <TierTag tier="decision" />
        </div>
      }
      {...(emphasis ? { emphasis } : {})}
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-background p-4">
            <p className="tt-eyebrow">Outreach targets</p>
            {draft.targets.length === 0 ? (
              <p className="mt-1.5 text-[13px] text-muted-foreground">
                No founder or decision maker is on record. Comms cannot open without one.
              </p>
            ) : (
              <ul className="mt-2 space-y-3">
                {draft.targets.map((target) => (
                  <li key={target.personId ?? target.fullName}>
                    <p className="text-[13px] text-foreground">
                      {target.fullName}
                      <span
                        className={cn(
                          "ml-2 font-mono text-[10px] uppercase tracking-[0.14em]",
                          target.rank === "primary" ? "text-royal" : "text-muted-foreground",
                        )}
                      >
                        {target.rank === "primary" ? "open with" : "fallback"}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">{target.why}</p>
                    <p className="mt-0.5 text-[13px]">
                      <span className="text-muted-foreground">
                        {target.email ?? "No email on record"}
                      </span>
                      <span
                        className={cn(
                          "ml-2 font-mono text-[10px] uppercase tracking-[0.14em]",
                          target.reachable ? "text-success" : "text-warning",
                        )}
                      >
                        {EMAIL_STATUS_LABEL[target.emailStatus]}
                      </span>
                    </p>
                    {target.blocker ? (
                      <p className="mt-0.5 text-[13px] text-muted-foreground">{target.blocker}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border border-border bg-background p-4">
            <p className="tt-eyebrow">Message intent</p>
            <p className="mt-1.5 text-sm text-foreground">
              {HANDOFF_INTENT_LABEL[draft.intent]}
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">{draft.intentBecause}</p>
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="tt-eyebrow underline decoration-border underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Required context · {draft.requiredContext.length} items
          </button>
          {open ? (
            <ul className="mt-3 space-y-3">
              {draft.requiredContext.map((item, index) => (
                <li
                  key={`${item.label}-${index}`}
                  className="border-b border-border pb-3 last:border-b-0 last:pb-0"
                >
                  <p className="text-[13px] text-foreground">
                    {item.label}
                    <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {TIER_LABEL[item.tier]}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">{item.value}</p>
                  <EvidenceLinks evidence={item.evidence} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {draft.blockers.length > 0 ? (
          <div className="rounded-lg border border-border bg-secondary/40 p-4">
            <p className="tt-eyebrow">Still in the way</p>
            <ul className="mt-2 space-y-1.5 text-[13px] text-muted-foreground">
              {draft.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <TTButton disabled={!draft.ready || busy || routed} onClick={() => onRoute(draft)}>
            {routed ? "Carried to Comms" : "Carry to Comms"}
          </TTButton>
          <p className="text-[13px] text-muted-foreground">
            The brief travels with its provenance. Nothing is sent automatically.
          </p>
        </div>
      </div>
    </Panel>
  );
}
