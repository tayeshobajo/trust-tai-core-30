/**
 * Scout Research Workspace and the Tai Decision State.
 *
 * The workspace holds one honest comparison: what they told us beside what we
 * actually read. The decision state turns that comparison into bounded next
 * moves, each with a reason and a readiness gate. Nothing here executes on its
 * own, and nothing promotes testimony to evidence.
 */

import { Link } from "@tanstack/react-router";
import { ArrowUpRight, CircleDot, Quote, ShieldCheck, ShieldQuestion } from "lucide-react";

import { MetaPill, SectionHeading, TTButton } from "@/components/tt/primitives";
import { InboundBadge, InboundWash } from "@/components/tt/scout/inbound";
import type {
  DecisionAction,
  DecisionActionKey,
  EvidenceReview,
  TaiDecisionStateView,
} from "@/data/scout/research-workspace";
import { CONFIDENCE_LEVEL_LABEL, type ConfidenceLevel } from "@/domain/confidence";
import type { ProspectCandidate } from "@/domain/scout";
import { cn } from "@/lib/utils";

import { relativeTime } from "./parts";

const CONFIDENCE_TONE: Record<ConfidenceLevel, string> = {
  high: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
  moderate: "border-amber-500/30 bg-amber-500/10 text-amber-700",
  low: "border-orange-500/30 bg-orange-500/10 text-orange-700",
  unknown: "border-border bg-muted text-muted-foreground",
};

export function ConfidenceChip({ level }: { level: ConfidenceLevel }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]",
        CONFIDENCE_TONE[level],
      )}
    >
      <CircleDot className="h-3 w-3" aria-hidden />
      {CONFIDENCE_LEVEL_LABEL[level]}
    </span>
  );
}

/**
 * The evidence page header. Unmistakably website-origin, still premium: a
 * royal keyline, the mark, and the exact provenance of the conversation.
 */
export function EvidenceHeader({
  candidate,
  review,
  confidence,
}: {
  candidate: ProspectCandidate;
  review: EvidenceReview;
  confidence: ConfidenceLevel;
}) {
  const packet = candidate.stated;
  const percent = review.totalClaims === 0 ? 0 : Math.round(review.coverage * 100);
  return (
    <InboundWash>
      <div className="p-6">
        <div className="flex flex-wrap items-center gap-2">
          <InboundBadge />
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            TrustTai.com · Build My Roadmap
          </span>
          <span className="ml-auto">
            <ConfidenceChip level={confidence} />
          </span>
        </div>

        <h2 className="mt-3 font-serif text-[26px] leading-tight text-foreground">
          Research workspace · {candidate.prospect.name}
        </h2>
        <p className="mt-2 max-w-reading text-[15px] text-muted-foreground">
          Everything they stated, set beside everything we have actually read. Testimony is never
          scored and never becomes evidence here.
        </p>

        <dl className="mt-5 grid gap-4 sm:grid-cols-4">
          {[
            { label: "Stated claims", value: String(review.totalClaims) },
            { label: "Checked against evidence", value: `${percent}%` },
            { label: "Observed signals", value: String(review.observed.length) },
            {
              label: "Research consent",
              value: review.researchAuthorized ? "Given" : "Not given",
            },
          ].map((item) => (
            <div key={item.label}>
              <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {item.label}
              </dt>
              <dd className="mt-1 text-[15px] text-foreground">{item.value}</dd>
            </div>
          ))}
        </dl>

        {packet?.submissionRowId ? (
          <Link
            to="/modules/website/submissions/$submissionId"
            params={{ submissionId: packet.submissionRowId }}
            className="mt-5 inline-flex items-center gap-1.5 text-[13px] text-royal hover:underline"
          >
            Open the original submission
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        ) : null}
      </div>
    </InboundWash>
  );
}

/** Claim by claim: what they said, and what we read that speaks to it. */
export function EvidenceReviewPanel({ review }: { review: EvidenceReview }) {
  if (review.totalClaims === 0) {
    return (
      <div className="tt-surface p-5">
        <SectionHeading
          eyebrow="Evidence review"
          title="This intake carried no claims"
          description="There is nothing stated to check. Read their public pages before deciding anything."
        />
      </div>
    );
  }

  return (
    <div className="tt-surface p-5">
      <SectionHeading
        eyebrow="Evidence review"
        title="What they said, against what we read"
        description="Corroboration means an observed signal speaks about the same thing. It is not proof."
      />
      <div className="space-y-5">
        {review.lanes.map((lane) => (
          <div key={lane.lane}>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {lane.laneLabel}
            </p>
            <ul className="mt-2 space-y-3">
              {lane.claims.map((claim, index) => (
                <li
                  key={`${lane.lane}-${index}`}
                  className="rounded-xl border border-border bg-card p-4"
                >
                  <div className="flex items-start gap-2">
                    <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-royal" aria-hidden />
                    <p className="text-[14px] text-foreground">{claim.statement}</p>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {claim.standing === "corroborated" ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-700">
                        <ShieldCheck className="h-3 w-3" aria-hidden />
                        Spoken to by evidence
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        <ShieldQuestion className="h-3 w-3" aria-hidden />
                        Unverified
                      </span>
                    )}
                    <MetaPill>Stated</MetaPill>
                  </div>

                  {claim.corroboration.length > 0 ? (
                    <ul className="mt-3 space-y-1.5 border-l-2 border-emerald-500/30 pl-3">
                      {claim.corroboration.slice(0, 3).map((signal) => (
                        <li key={signal.id} className="text-[13px] text-muted-foreground">
                          {signal.statement}
                          {signal.sourceUrl ? (
                            <a
                              href={signal.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="ml-1.5 text-royal hover:underline"
                            >
                              source
                            </a>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The Tai Decision State: where this company stands and what may happen next. */
export function TaiDecisionStatePanel({
  decision,
  conductorSearch,
  onAction,
  busy,
}: {
  decision: TaiDecisionStateView;
  conductorSearch: { signal: string; app: string; entity: string; ask: string };
  onAction: (key: DecisionActionKey) => void;
  busy: boolean;
}) {
  return (
    <div className="tt-surface p-5">
      <SectionHeading
        eyebrow="Tai decision state"
        title={decision.headline}
        description={decision.because}
      />

      <div className="flex flex-wrap items-center gap-2">
        <ConfidenceChip level={decision.confidence} />
        <MetaPill>{Math.round(decision.coverage * 100)}% of claims checked</MetaPill>
      </div>
      <p className="mt-2 text-[13px] text-muted-foreground">{decision.confidenceBecause}</p>

      <ul className="mt-5 space-y-2">
        {decision.actions.map((action) => (
          <ActionRow
            key={action.key}
            action={action}
            conductorSearch={conductorSearch}
            onAction={onAction}
            busy={busy}
          />
        ))}
      </ul>

      <div className="mt-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Decision trail
        </p>
        {decision.trail.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted-foreground">
            Nothing has been decided about this company yet.
          </p>
        ) : (
          <ol className="mt-3 space-y-3">
            {decision.trail.slice(0, 8).map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="flex gap-3">
                <span
                  aria-hidden
                  className={cn(
                    "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                    entry.byPerson ? "bg-royal" : "bg-muted-foreground/40",
                  )}
                />
                <div className="min-w-0">
                  <p className="text-[13px] text-foreground">{entry.label}</p>
                  <p className="text-[12px] text-muted-foreground">
                    {entry.actor} · {relativeTime(entry.at)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function ActionRow({
  action,
  conductorSearch,
  onAction,
  busy,
}: {
  action: DecisionAction;
  conductorSearch: { signal: string; app: string; entity: string; ask: string };
  onAction: (key: DecisionActionKey) => void;
  busy: boolean;
}) {
  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-medium text-foreground">{action.label}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {action.ready ? action.because : action.blockedBecause}
          </p>
        </div>
        {action.kind === "conductor" ? (
          <TTButton asChild variant="secondary" className="h-9 shrink-0 text-[13px]">
            <Link to="/modules/conductor" search={conductorSearch}>
              Open in Conductor
            </Link>
          </TTButton>
        ) : (
          <TTButton
            variant={action.key === "route_to_comms" ? "primary" : "secondary"}
            className="h-9 shrink-0 text-[13px]"
            disabled={!action.ready || busy}
            onClick={() => onAction(action.key)}
          >
            {action.label}
          </TTButton>
        )}
      </div>
    </li>
  );
}
