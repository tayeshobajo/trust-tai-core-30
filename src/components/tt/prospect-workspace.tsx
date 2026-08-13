import { useState } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { TTButton } from "@/components/tt/primitives";
import type { ProspectCandidate } from "@/domain/scout";
import type { FitCriterion, FitCriterionState, FitLight } from "@/domain/scout-fit";
import { cn } from "@/lib/utils";

import { FIT_LIGHT_LABEL, FitDot, StageTag, formatChecked } from "./fit-light";

const STATE_LABEL: Record<FitCriterionState, string> = {
  met: "Met",
  partial: "Partial",
  missing: "Unknown",
  mismatch: "Mismatch",
};

const STATE_TONE: Record<FitCriterionState, string> = {
  met: "text-success",
  partial: "text-warning",
  mismatch: "text-destructive",
  missing: "text-muted-foreground",
};

const OVERRIDES: { light: FitLight; label: string }[] = [
  { light: "green", label: "Green" },
  { light: "yellow", label: "Yellow" },
  { light: "red", label: "Red" },
];

/** Criteria that describe the opportunity rather than the fit read itself. */
const OPPORTUNITY_KEYS = new Set(["limiting_system", "first_milestone", "roadmap_depth"]);
const DECISION_KEYS = new Set(["decision_maker"]);

function Panel({
  eyebrow,
  title,
  description,
  children,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card p-6", className)}>
      {eyebrow ? <p className="tt-eyebrow">{eyebrow}</p> : null}
      <h2 className="mt-1.5 text-base font-semibold tracking-tight text-foreground">{title}</h2>
      {description ? (
        <p className="mt-1 max-w-reading text-[13px] text-muted-foreground">{description}</p>
      ) : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 truncate text-[13px] text-foreground">{value}</dd>
    </div>
  );
}

function CriterionRow({ criterion }: { criterion: FitCriterion }) {
  return (
    <li className="border-b border-border pb-4 last:border-b-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-[13px] font-medium text-foreground">{criterion.label}</p>
        <p
          className={cn(
            "shrink-0 font-mono text-[10px] uppercase tracking-[0.14em]",
            STATE_TONE[criterion.state],
          )}
        >
          {STATE_LABEL[criterion.state]}
          {criterion.maxScore > 0 ? ` · ${criterion.score}/${criterion.maxScore}` : ""}
        </p>
      </div>
      <p className="mt-1 text-[13px] text-muted-foreground">{criterion.reason}</p>
      {criterion.sourceUrls?.length ? (
        <div className="mt-1.5 flex flex-wrap gap-3">
          {criterion.sourceUrls.map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noreferrer noopener"
              className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              source
            </a>
          ))}
        </div>
      ) : null}
    </li>
  );
}

function Disclosure({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-lg border border-border bg-background px-4 py-3 [&_summary::-webkit-details-marker]:hidden">
      <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {summary}
        <span aria-hidden className="ml-2 opacity-60 group-open:hidden">
          +
        </span>
        <span aria-hidden className="ml-2 hidden opacity-60 group-open:inline">
          −
        </span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

export function ProspectWorkspace({
  candidate,
  activeIcpVersion,
  backSearch,
  onQualify,
  onPass,
  onResearch,
  onOverride,
  busy,
}: {
  candidate: ProspectCandidate;
  activeIcpVersion: number | null;
  backSearch: { section: "scout" | "qualified" | "research"; fit: "all" | FitLight };
  onQualify: (id: string) => void;
  onPass: (id: string) => void;
  onResearch: (websiteUrl: string) => void;
  onOverride: (id: string, light: FitLight | null) => void;
  busy?: boolean;
}) {
  const [showOverride, setShowOverride] = useState(false);
  const { prospect, evaluation, signals, fit, source } = candidate;

  const staleScore =
    evaluation.scoreable &&
    activeIcpVersion !== null &&
    evaluation.icpVersion !== null &&
    evaluation.icpVersion !== activeIcpVersion;
  const qualified = prospect.status === "qualified" || prospect.status === "ready_for_comms";
  const passed = prospect.status === "passed";

  const fitCriteria = evaluation.criteria.filter(
    (c) => !OPPORTUNITY_KEYS.has(c.key) && !DECISION_KEYS.has(c.key),
  );
  const opportunityCriteria = evaluation.criteria.filter((c) => OPPORTUNITY_KEYS.has(c.key));
  const decisionCriteria = evaluation.criteria.filter((c) => DECISION_KEYS.has(c.key));
  const unknown = evaluation.criteria.filter(
    (c) => c.state === "missing" || c.state === "mismatch",
  );

  return (
    <div className="space-y-6">
      <Link
        to="/modules/scout"
        search={backSearch}
        className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Back to Scout
      </Link>

      {/* A. Company header */}
      <header className="tt-rise rounded-xl border border-border bg-card p-6 lg:p-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="tt-eyebrow">Trust Tai OS / Scout / Prospect</p>
            <h1 className="tt-display mt-2 text-3xl text-foreground lg:text-4xl">
              {prospect.name}
            </h1>
            <p className="mt-2 font-mono text-[12px] text-muted-foreground">
              {prospect.websiteUrl ? (
                <a
                  href={prospect.websiteUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1.5 underline decoration-border underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {prospect.domain}
                  <ExternalLink aria-hidden className="size-3" />
                </a>
              ) : (
                "No website recorded"
              )}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5">
                <FitDot light={evaluation.light} />
                <span className="text-[13px] text-foreground">
                  {FIT_LIGHT_LABEL[evaluation.light]}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {evaluation.scoreable ? `${evaluation.score}%` : "—"}
                </span>
              </span>
              <StageTag status={prospect.status} />
              {source.kind === "preview_demo" ? (
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Preview demo
                </span>
              ) : null}
            </div>
          </div>

          {/* One primary action, sized for touch. */}
          <div className="flex flex-wrap items-center gap-2">
            {!qualified && !passed ? (
              <TTButton disabled={busy} onClick={() => onQualify(prospect.id)}>
                Qualify {prospect.name}
              </TTButton>
            ) : null}
            {!passed ? (
              <TTButton variant="secondary" disabled={busy} onClick={() => onPass(prospect.id)}>
                Pass
              </TTButton>
            ) : null}
            {prospect.websiteUrl ? (
              <TTButton
                variant="secondary"
                disabled={busy}
                onClick={() => onResearch(prospect.websiteUrl)}
              >
                Re-research
              </TTButton>
            ) : null}
            <TTButton
              variant="quiet"
              onClick={() => setShowOverride((value) => !value)}
              aria-expanded={showOverride}
            >
              Override fit
            </TTButton>
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-5 sm:grid-cols-3 lg:grid-cols-5">
          <Meta label="Stage" value={prospect.status.replace(/_/g, " ")} />
          <Meta
            label="Active ICP"
            value={activeIcpVersion !== null ? `v${activeIcpVersion}` : "None saved"}
          />
          <Meta label="Evaluator" value={evaluation.evaluatorVersion} />
          <Meta
            label="Research"
            value={evaluation.researchVersion ? `v${evaluation.researchVersion}` : "—"}
          />
          <Meta
            label="Pages / last checked"
            value={`${evaluation.pagesResearched ?? source.pagesResearched?.length ?? 0} · ${formatChecked(candidate.lastCheckedAt)}`}
          />
        </dl>

        {staleScore ? (
          <p className="mt-5 rounded-md border border-warning/30 bg-warning/8 px-4 py-3 text-[13px] text-warning">
            Needs rescore — this was evaluated against ICP v{evaluation.icpVersion}, and the active
            ICP is v{activeIcpVersion}.
          </p>
        ) : null}

        {showOverride ? (
          <div className="mt-5 rounded-lg border border-border bg-background p-4">
            <p className="text-[13px] text-muted-foreground">
              Set the fit light yourself. The evaluator's reading is kept and shown alongside it.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {OVERRIDES.map((option) => (
                <TTButton
                  key={option.light}
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onOverride(prospect.id, option.light)}
                >
                  <FitDot light={option.light} />
                  {option.label}
                </TTButton>
              ))}
              <TTButton
                size="sm"
                variant="quiet"
                disabled={busy}
                onClick={() => onOverride(prospect.id, null)}
              >
                Clear override
              </TTButton>
            </div>
          </div>
        ) : null}
      </header>

      {/* B. Two-column intelligence summary */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          eyebrow="Current truth"
          title="Why Scout thinks this"
          description={evaluation.explanation}
        >
          <div className="space-y-5">
            <div className="rounded-lg border border-royal/20 bg-royal/5 p-4">
              <p className="tt-eyebrow text-royal">Strongest signal</p>
              <p className="mt-1.5 text-sm text-foreground">{evaluation.strongestSignal}</p>
            </div>

            {fitCriteria.length > 0 ? (
              <ul className="space-y-4">
                {fitCriteria.map((criterion) => (
                  <CriterionRow key={criterion.key} criterion={criterion} />
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted-foreground">
                No ICP criteria were scored for this record. Preview candidates are never scored
                against live evidence.
              </p>
            )}

            {unknown.length > 0 ? (
              <div className="rounded-lg border border-border bg-secondary/40 p-4">
                <p className="tt-eyebrow">Still missing or unknown</p>
                <ul className="mt-2 space-y-1.5 text-[13px] text-muted-foreground">
                  {unknown.map((criterion) => (
                    <li key={criterion.key}>
                      {criterion.label} — {STATE_LABEL[criterion.state].toLowerCase()}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel
          eyebrow="Observed"
          title="What Scout found"
          description={
            source.kind === "live_website"
              ? "Read from public pages only. No search engines, no private data."
              : "A fixed preview set. Nothing external was searched."
          }
        >
          <div className="space-y-5">
            <dl className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-background p-4">
              <Meta
                label="Research depth"
                value={evaluation.researchDepthNote ?? source.note ?? "Not recorded"}
              />
              <Meta
                label="Pages checked"
                value={String(evaluation.pagesResearched ?? source.pagesResearched?.length ?? 0)}
              />
            </dl>

            {signals.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                Nothing has been observed for this company yet.
              </p>
            ) : (
              <ul className="space-y-2.5 text-[13px] text-muted-foreground">
                {signals.map((signal) => (
                  <li key={signal.id} className="flex gap-2.5">
                    <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-border" />
                    <span>
                      {signal.statement}
                      {signal.sourceUrl ? (
                        <>
                          {" "}
                          <a
                            href={signal.sourceUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="underline decoration-border underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            source
                          </a>
                        </>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <Disclosure summary="Provenance">
              <p className="text-[13px] text-muted-foreground">
                {source.label}
                {source.note ? ` · ${source.note}` : ""} · last checked{" "}
                {formatChecked(candidate.lastCheckedAt)}
              </p>
              {source.pagesResearched?.length ? (
                <ul className="mt-2 space-y-1">
                  {source.pagesResearched.map((page) => (
                    <li key={page}>
                      <a
                        href={page}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="font-mono text-[11px] break-all text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {page}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Disclosure>
          </div>
        </Panel>
      </div>

      {/* C. Opportunity */}
      <Panel
        eyebrow="Inferred"
        title="Opportunity"
        description="Observed constraints stay separate from what Scout infers and what it suggests."
      >
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Observed constraints
            </p>
            {opportunityCriteria.length > 0 ? (
              <ul className="mt-3 space-y-4">
                {opportunityCriteria.map((criterion) => (
                  <CriterionRow key={criterion.key} criterion={criterion} />
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[13px] text-muted-foreground">
                No website or business constraint has been observed yet. Nothing is assumed in its
                place.
              </p>
            )}
          </div>
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-background p-4">
              <p className="tt-eyebrow">Inferred hypothesis</p>
              <p className="mt-1.5 text-[13px] text-muted-foreground">{fit.whyItFits}</p>
            </div>
            <div className="rounded-lg border border-border bg-background p-4">
              <p className="tt-eyebrow">Suggested</p>
              <p className="mt-1.5 text-[13px] text-muted-foreground">{fit.recommendation}</p>
            </div>
          </div>
        </div>
      </Panel>

      {/* D. Decision maker */}
      <Panel
        eyebrow="Who carries what"
        title="Decision maker"
        description="Only what has actually been seen on public pages. Nothing here is invented."
      >
        {decisionCriteria.length > 0 ? (
          <ul className="space-y-4">
            {decisionCriteria.map((criterion) => (
              <CriterionRow key={criterion.key} criterion={criterion} />
            ))}
          </ul>
        ) : (
          <div className="rounded-lg border border-dashed border-border p-5">
            <p className="text-[13px] text-foreground">No decision-maker intelligence yet.</p>
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              Scout still needs a named person with a role, and a reachable contact route, before
              this company can be handed to Comms. Re-research the website or add the contact
              manually.
            </p>
          </div>
        )}
      </Panel>

      {/* E. Next move / handoff */}
      <Panel
        eyebrow="Next move"
        title={qualified ? "Handoff preparation" : "What happens next"}
        description={
          qualified
            ? "Qualified in Scout. Nothing is sent automatically."
            : "This company is still being read. Qualify it when the evidence supports it."
        }
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-royal/20 bg-royal/5 p-4">
            <p className="tt-eyebrow text-royal">Current recommendation</p>
            <p className="mt-1.5 text-sm text-foreground">{fit.recommendation}</p>
          </div>
          <ol className="space-y-2 text-[13px] text-muted-foreground">
            <li>1. Identify or confirm the decision maker.</li>
            <li>2. Prepare the opportunity brief.</li>
            <li>3. Move to Comms when contact context is ready.</li>
          </ol>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Nothing is sent automatically.
          </p>
        </div>
      </Panel>
    </div>
  );
}
