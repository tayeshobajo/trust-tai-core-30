/**
 * The Scout research brief: a calm analyst workspace for one company.
 *
 * Four provenance classes are shown as words, never as colour alone:
 * Stated (they told us), Observed (we read it), Inferred (our read of it),
 * Suggested (a possible next move). Nothing here executes, and nothing is
 * promoted from one class to another.
 */

import { useState } from "react";
import { ChevronDown, ExternalLink, Quote, ShieldAlert, ShieldQuestion } from "lucide-react";

import { MetaPill, SectionHeading, TTButton } from "@/components/tt/primitives";
import { InboundBadge, InboundWash } from "@/components/tt/scout/inbound";
import type {
  Contradiction,
  CoverageArea,
  EvidenceTheme,
  ResearchState,
  ScoutRead,
} from "@/data/scout/research-brief";
import { RESEARCH_STATE_LABEL } from "@/data/scout/research-brief";
import type { EvidenceAudit } from "@/data/scout/evidence-provenance";
import {
  EVIDENCE_KIND_LABEL,
  auditForInferred,
  auditForSignal,
  auditForSuggested,
} from "@/data/scout/evidence-provenance";
import type { ResearchRunPlan } from "@/data/scout/research-run";
import type { ResearchPermission } from "@/data/scout/research-consent";
import { RESEARCH_PERMISSION_LABEL } from "@/data/scout/research-consent";
import { CONFIDENCE_LEVEL_LABEL } from "@/domain/confidence";
import type { ScoutSignal } from "@/domain/scout";
import { cn } from "@/lib/utils";

import { relativeTime } from "./parts";

type Klass = "stated" | "observed" | "inferred" | "suggested";

const KLASS_LABEL: Record<Klass, string> = {
  stated: "Stated",
  observed: "Observed",
  inferred: "Inferred",
  suggested: "Suggested",
};

const KLASS_NOTE: Record<Klass, string> = {
  stated: "They told us in the intake. Testimony, not verified fact.",
  observed: "Scout read this from a public page.",
  inferred: "Scout's read of the evidence. Interpretation, not fact.",
  suggested: "A possible next move. Not approved work.",
};

const KLASS_TONE: Record<Klass, string> = {
  stated: "border-royal/30 bg-royal/10 text-royal",
  observed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
  inferred: "border-amber-500/30 bg-amber-500/10 text-amber-700",
  suggested: "border-border bg-muted text-muted-foreground",
};

export function ProvenancePill({ klass }: { klass: Klass }) {
  return (
    <span
      title={KLASS_NOTE[klass]}
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]",
        KLASS_TONE[klass],
      )}
    >
      {KLASS_LABEL[klass]}
    </span>
  );
}

/* --------------------------------------------------------------- header -- */

const STATE_TONE: Record<ResearchState, string> = {
  not_started: "border-border bg-muted text-muted-foreground",
  ready: "border-royal/30 bg-royal/10 text-royal",
  running: "border-royal/30 bg-royal/10 text-royal",
  complete: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
  needs_review: "border-amber-500/30 bg-amber-500/10 text-amber-700",
};

export function ResearchHeader({
  companyName,
  toldUs,
  permission,
  state,
  researchedAt,
  onRunResearch,
  onResolveConsent,
  busy,
}: {
  companyName: string;
  toldUs: string | null;
  permission: ResearchPermission;
  state: ResearchState;
  researchedAt: string | null;
  onRunResearch: () => void;
  onResolveConsent: (decision: "granted" | "withheld") => void;
  busy: boolean;
}) {
  return (
    <InboundWash>
      <div className="p-6">
        <div className="flex flex-wrap items-center gap-2">
          <InboundBadge />
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            TrustTai.com · Build My Roadmap
          </span>
          <span
            className={cn(
              "ml-auto inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]",
              STATE_TONE[state],
            )}
          >
            Research · {RESEARCH_STATE_LABEL[state]}
          </span>
        </div>

        <h2 className="mt-3 font-serif text-[26px] leading-tight text-foreground">
          Research workspace · {companyName}
        </h2>
        <p className="mt-2 max-w-reading text-[15px] text-muted-foreground">
          {toldUs ? (
            <>
              They told us: <span className="text-foreground">{toldUs}</span>
            </>
          ) : (
            "They completed the intake but did not state where they want to get to."
          )}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <MetaPill>{RESEARCH_PERMISSION_LABEL[permission.state]}</MetaPill>
          <MetaPill>
            {researchedAt ? `Last researched ${relativeTime(researchedAt)}` : "Never researched"}
          </MetaPill>
        </div>
        <p className="mt-2 max-w-reading text-[13px] text-muted-foreground">
          {permission.because}
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <TTButton
            className="h-10 px-4 text-[13px]"
            disabled={busy || !permission.canResearch || state === "running"}
            onClick={onRunResearch}
          >
            {state === "running" ? "Running research…" : "Run research"}
          </TTButton>
          {permission.state === "unknown" ? (
            <>
              <TTButton
                variant="secondary"
                className="h-10 px-4 text-[13px]"
                disabled={busy}
                onClick={() => onResolveConsent("granted")}
              >
                I authorise public research
              </TTButton>
              <TTButton
                variant="quiet"
                className="h-10 px-4 text-[13px]"
                disabled={busy}
                onClick={() => onResolveConsent("withheld")}
              >
                Do not research them
              </TTButton>
            </>
          ) : null}
        </div>
        {!permission.canResearch ? (
          <p className="mt-2 flex items-start gap-2 text-[13px] text-muted-foreground">
            <ShieldQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Run research is disabled.{" "}
            {permission.state === "withheld"
              ? "They said no, and that answer stands until they change it."
              : "Nobody has decided whether researching them is appropriate."}
          </p>
        ) : null}
      </div>
    </InboundWash>
  );
}

/* ------------------------------------------------------------- coverage -- */

export function CoverageStrip({
  areas,
  checkedCount,
  total,
}: {
  areas: CoverageArea[];
  checkedCount: number;
  total: number;
}) {
  return (
    <div className="tt-surface p-5">
      <SectionHeading
        eyebrow="Evidence coverage"
        title={`${checkedCount} of ${total} areas checked`}
        description="What Scout has actually looked at. Anything not checked stays unknown; absence is never reported as a finding."
      />
      <ul className="grid gap-2 sm:grid-cols-2">
        {areas.map((area) => (
          <li
            key={area.key}
            className="rounded-lg border border-border bg-card px-3.5 py-2.5"
          >
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-medium text-foreground">{area.label}</span>
              <span
                className={cn(
                  "ml-auto font-mono text-[10px] uppercase tracking-[0.12em]",
                  area.checked ? "text-emerald-700" : "text-muted-foreground",
                )}
              >
                {area.checked ? "Checked" : "Not checked"}
              </span>
            </div>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {area.checked ? (area.evidence?.statement ?? "Read from a public page.") : area.looksFor}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------ provenance trail - */

export function AuditTrail({ audit }: { audit: EvidenceAudit }) {
  return (
    <details className="mt-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2">
      <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        Audit trail
      </summary>
      <dl className="mt-2 grid gap-1.5 text-[12px] text-muted-foreground sm:grid-cols-2">
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.12em]">Source type</dt>
          <dd className="text-foreground">{EVIDENCE_KIND_LABEL[audit.kind]}</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.12em]">Read</dt>
          <dd className="text-foreground">
            {audit.observedAt ? (
              <>
                {relativeTime(audit.observedAt)}{" "}
                <span className="text-muted-foreground">({audit.observedAt})</span>
              </>
            ) : (
              "Not recorded"
            )}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.12em]">Where</dt>
          <dd className="text-foreground">
            {audit.url ? (
              <a
                href={audit.url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-royal underline-offset-4 hover:underline"
              >
                {audit.title}
                <ExternalLink aria-hidden className="size-3" />
              </a>
            ) : (
              audit.title
            )}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.12em]">Confidence</dt>
          <dd className="text-foreground">{CONFIDENCE_LEVEL_LABEL[audit.confidence]}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="font-mono text-[10px] uppercase tracking-[0.12em]">Evidence snippet</dt>
          <dd className="text-foreground">“{audit.snippet}”</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="font-mono text-[10px] uppercase tracking-[0.12em]">Recorded by</dt>
          <dd>{audit.actor}</dd>
        </div>
      </dl>
    </details>
  );
}

/* ------------------------------------------------------------ re-run ----- */

export function RerunPanel({
  plan,
  onRun,
  onForce,
  busy,
}: {
  plan: ResearchRunPlan;
  onRun: () => void;
  onForce: () => void;
  busy: boolean;
}) {
  return (
    <div className="tt-surface p-5">
      <SectionHeading
        eyebrow="Controlled re-run"
        title={plan.summary}
        description="A re-run updates only what is missing or stale. Nothing already established is discarded."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Will be re-read
          </p>
          {plan.targets.length === 0 ? (
            <p className="mt-1.5 text-[13px] text-muted-foreground">Nothing is missing or stale.</p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {plan.targets.map((target) => (
                <li key={target.key} className="text-[13px] text-foreground">
                  {target.label}{" "}
                  <span className="text-muted-foreground">
                    — {target.reason === "never_checked" ? "never checked" : "older than 30 days"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Kept untouched
          </p>
          <ul className="mt-1.5 space-y-1 text-[13px] text-muted-foreground">
            {plan.preserves.map((line) => (
              <li key={line}>{line}</li>
            ))}
            {plan.preservedAreas.length > 0 ? (
              <li className="text-foreground">Fresh areas: {plan.preservedAreas.join(", ")}</li>
            ) : null}
          </ul>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <TTButton className="h-10 px-4 text-[13px]" disabled={busy || !plan.allowed} onClick={onRun}>
          Update missing evidence
        </TTButton>
        <TTButton
          variant="quiet"
          className="h-10 px-4 text-[13px]"
          disabled={busy || plan.mode === "blocked"}
          onClick={onForce}
        >
          Refresh everything
        </TTButton>
      </div>
      {plan.blockedBecause ? (
        <p className="mt-2 text-[13px] text-muted-foreground">{plan.blockedBecause}</p>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------- four lanes --- */

function SignalLine({ signal }: { signal: ScoutSignal }) {
  return (
    <li className="text-[13px] text-muted-foreground">
      {signal.statement}
      {signal.sourceUrl ? (
        <a
          href={signal.sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="ml-1.5 inline-flex items-center gap-1 text-royal underline-offset-4 hover:underline"
        >
          source
          <ExternalLink aria-hidden className="size-3" />
        </a>
      ) : null}
      <AuditTrail audit={auditForSignal(signal)} />
    </li>
  );
}

export function EvidenceLanes({
  themes,
  observed = [],
}: {
  themes: EvidenceTheme[];
  /** Every observation on file, used to resolve each audit trail. */
  observed?: ScoutSignal[];
}) {
  if (themes.length === 0) {
    return (
      <div className="tt-surface p-5">
        <SectionHeading
          eyebrow="Evidence"
          title="Nothing to compare yet"
          description="They stated nothing and Scout has read nothing. There is no honest read to give."
        />
      </div>
    );
  }

  return (
    <div className="tt-surface p-5">
      <SectionHeading
        eyebrow="Evidence"
        title="Theme by theme"
        description="Each theme reads in one direction: what they said, what we read, what it may mean, and what could be done next."
      />
      <div className="space-y-5">
        {themes.map((theme) => (
          <section key={theme.key} className="rounded-xl border border-border bg-card p-4">
            <h3 className="font-serif text-[17px] text-foreground">{theme.label}</h3>

            <div className="mt-3 space-y-3">
              <div>
                <ProvenancePill klass="stated" />
                {theme.stated.length === 0 ? (
                  <p className="mt-1.5 text-[13px] text-muted-foreground">Not stated.</p>
                ) : (
                  <ul className="mt-1.5 space-y-1.5">
                    {theme.stated.map((statement, index) => (
                      <li key={index} className="flex items-start gap-2 text-[14px] text-foreground">
                        <Quote className="mt-1 h-3.5 w-3.5 shrink-0 text-royal" aria-hidden />
                        {statement}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <ProvenancePill klass="observed" />
                {theme.observed.length === 0 ? (
                  <p className="mt-1.5 text-[13px] text-muted-foreground">Not yet observed.</p>
                ) : (
                  <ul className="mt-1.5 space-y-1.5">
                    {theme.observed.map((signal) => (
                      <SignalLine key={signal.id} signal={signal} />
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <ProvenancePill klass="inferred" />
                {theme.inferred.length === 0 ? (
                  <p className="mt-1.5 text-[13px] text-muted-foreground">
                    No inference: there is not enough evidence to interpret.
                  </p>
                ) : (
                  <ul className="mt-1.5 space-y-1.5">
                    {theme.inferred.map((read, index) => (
                      <li key={index} className="text-[13px] text-muted-foreground">
                        <span className="text-foreground">{read.statement}</span> — {read.because}{" "}
                        <span className="font-mono text-[10px] uppercase tracking-[0.12em]">
                          {read.confidence} confidence
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <ProvenancePill klass="suggested" />
                {theme.suggested.length === 0 ? (
                  <p className="mt-1.5 text-[13px] text-muted-foreground">
                    No suggestion. Nothing here is waiting on a move.
                  </p>
                ) : (
                  <ul className="mt-1.5 space-y-1.5">
                    {theme.suggested.map((move, index) => (
                      <li key={index} className="text-[13px] text-muted-foreground">
                        <span className="text-foreground">{move.statement}</span> — {move.because}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------- contradictions - */

export function ContradictionsPanel({ conflicts }: { conflicts: Contradiction[] }) {
  if (conflicts.length === 0) return null;
  return (
    <div className="tt-surface border-l-2 border-l-amber-500/60 p-5">
      <SectionHeading
        eyebrow="Something does not line up"
        title={`${conflicts.length} mismatch${conflicts.length === 1 ? "" : "es"} between what they said and what we read`}
        description="A mismatch is a question, not a verdict. Ask before concluding anything."
      />
      <ul className="space-y-3">
        {conflicts.map((conflict) => (
          <li key={conflict.key} className="rounded-xl border border-border bg-card p-4">
            <p className="flex items-start gap-2 text-[14px] font-medium text-foreground">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
              {conflict.headline}
            </p>
            <div className="mt-3 space-y-2">
              <p className="text-[13px] text-muted-foreground">
                <ProvenancePill klass="stated" /> <span className="ml-1.5">{conflict.stated}</span>
              </p>
              <p className="text-[13px] text-muted-foreground">
                <ProvenancePill klass="observed" />{" "}
                <span className="ml-1.5">{conflict.observed}</span>
                {conflict.sourceUrl ? (
                  <a
                    href={conflict.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="ml-1.5 text-royal underline-offset-4 hover:underline"
                  >
                    source
                  </a>
                ) : null}
              </p>
            </div>
            <p className="mt-3 text-[13px] text-muted-foreground">{conflict.note}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* --------------------------------------------------------------- sources - */

export function ResearchSources({ observed }: { observed: ScoutSignal[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tt-surface p-5">
      <SectionHeading
        eyebrow="Research sources"
        title={
          observed.length === 0
            ? "No public evidence has been read"
            : `${observed.length} observation${observed.length === 1 ? "" : "s"} on file`
        }
        description="Every observation keeps what it was read from and when."
      />
      {observed.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Nothing to show. Run research once permission is settled.
        </p>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="inline-flex items-center gap-1.5 text-[13px] text-royal hover:underline"
          >
            {open ? "Hide the evidence" : "Show the evidence"}
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden />
          </button>
          {open ? (
            <ul className="mt-3 space-y-2">
              {observed.map((signal) => (
                <li key={signal.id} className="rounded-lg border border-border bg-card px-3.5 py-2.5">
                  <p className="text-[13px] text-foreground">{signal.statement}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-3 font-mono text-[11px] text-muted-foreground">
                    <span>{signal.provenance.appId}</span>
                    <span>{relativeTime(signal.provenance.observedAt)}</span>
                    {signal.sourceUrl ? (
                      <a
                        href={signal.sourceUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 text-royal underline-offset-4 hover:underline"
                      >
                        View source
                        <ExternalLink aria-hidden className="size-3" />
                      </a>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- the read ----- */

function ReadList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </p>
      {items.length === 0 ? (
        <p className="mt-1.5 text-[13px] text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {items.map((item, index) => (
            <li key={index} className="text-[13px] text-foreground">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ScoutReadPanel({ read }: { read: ScoutRead }) {
  return (
    <div className="tt-surface p-5">
      <SectionHeading
        eyebrow="Scout read"
        title="Where this stands"
        description="A summary of the four lanes above. It never prescribes a solution as fact."
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <ReadList
          title="What appears true"
          items={read.appearsTrue}
          empty="Nothing has been corroborated yet."
        />
        <ReadList
          title="What is still uncertain"
          items={read.stillUncertain}
          empty="Nothing outstanding."
        />
        <ReadList
          title="What deserves attention"
          items={read.deservesAttention}
          empty="Nothing is pulling at your attention here."
        />
        <ReadList
          title="What should not be assumed"
          items={read.doNotAssume}
          empty="Nothing to caution about."
        />
      </div>
    </div>
  );
}
