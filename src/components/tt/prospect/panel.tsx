/**
 * Shared surfaces for the prospect workspace.
 *
 * Every panel states one idea. Nothing here decides what to show, that is the
 * composition's job, so these stay purely presentational.
 */

import {
  CONFIDENCE_LEVEL_LABEL,
  type ConfidenceLevel,
  type ConfidenceRead,
  type EvidenceRef,
} from "@/domain/confidence";
import type { ModuleEmphasis } from "@/domain/prospect-modules";
import type { FitCriterion, FitCriterionState } from "@/domain/scout-fit";
import { cn } from "@/lib/utils";

export const STATE_LABEL: Record<FitCriterionState, string> = {
  met: "Met",
  partial: "Partial",
  missing: "Unknown",
  mismatch: "Mismatch",
};

export const STATE_TONE: Record<FitCriterionState, string> = {
  met: "text-success",
  partial: "text-warning",
  mismatch: "text-destructive",
  missing: "text-muted-foreground",
};

export function Panel({
  eyebrow,
  title,
  description,
  aside,
  children,
  className,
  emphasis = "supporting",
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Set by the composer, never by the panel itself. */
  emphasis?: ModuleEmphasis;
}) {
  return (
    <section
      className={cn(
        "tt-rise rounded-xl border bg-card",
        emphasis === "primary"
          ? "border-royal/30 p-6 shadow-[0_1px_0_0_hsl(var(--royal)/0.08)]"
          : emphasis === "quiet"
            ? "border-dashed border-border/70 p-5 opacity-80 transition-opacity hover:opacity-100"
            : "border-border p-6",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {eyebrow ? <p className="tt-eyebrow">{eyebrow}</p> : null}
          <h2 className="mt-1.5 text-base font-semibold tracking-tight text-foreground">{title}</h2>
          {description ? (
            <p className="mt-1 max-w-reading text-[13px] text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {aside}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** Compact rail surface. Quieter than a panel, never a widget. */
export function RailCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <p className="tt-eyebrow">{title}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 truncate text-[13px] text-foreground">{value}</dd>
    </div>
  );
}

export function SourceLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      source
    </a>
  );
}

const LEVEL_TONE: Record<ConfidenceLevel, string> = {
  high: "border-success/30 text-success",
  moderate: "border-warning/30 text-warning",
  low: "border-destructive/30 text-destructive",
  unknown: "border-border text-muted-foreground",
};

/** How sure the system is. Always paired with the reason, never on its own. */
export function ConfidenceChip({ level }: { level: ConfidenceLevel }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]",
        LEVEL_TONE[level],
      )}
    >
      {CONFIDENCE_LEVEL_LABEL[level]}
    </span>
  );
}

/** What a claim rests on. Pages link out; computed and human reads do not. */
export function EvidenceLinks({ evidence }: { evidence: EvidenceRef[] }) {
  if (evidence.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
      {evidence.map((item, index) =>
        item.url ? (
          <a
            key={`${item.label}-${index}`}
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {item.label}
          </a>
        ) : (
          <span
            key={`${item.label}-${index}`}
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
          >
            {item.label}
          </span>
        ),
      )}
    </div>
  );
}

/** The full "why we think this" line: confidence, reason, and evidence. */
export function WhyWeThink({ confidence }: { confidence: ConfidenceRead }) {
  return (
    <div className="rounded-lg border border-border bg-background px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="tt-eyebrow">Why we think this</p>
        <ConfidenceChip level={confidence.level} />
      </div>
      <p className="mt-1.5 text-[13px] text-muted-foreground">{confidence.because}</p>
      <EvidenceLinks evidence={confidence.evidence} />
    </div>
  );
}

export function CriterionRow({
  criterion,
  confidence,
}: {
  criterion: FitCriterion;
  confidence?: ConfidenceRead | undefined;
}) {
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
      {confidence ? (
        <>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-2">
            <ConfidenceChip level={confidence.level} />
            <span className="text-[13px] text-muted-foreground">{confidence.because}</span>
          </div>
          <EvidenceLinks evidence={confidence.evidence} />
        </>
      ) : criterion.sourceUrls?.length ? (
        <div className="mt-1.5 flex flex-wrap gap-3">
          {criterion.sourceUrls.map((url) => (
            <SourceLink key={url} url={url} />
          ))}
        </div>
      ) : null}
    </li>
  );
}

export function Disclosure({ summary, children }: { summary: string; children: React.ReactNode }) {
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

/** How much to trust what is on screen. Fact, inference, and decision differ. */
export function TierTag({ tier }: { tier: "fact" | "inference" | "decision" }) {
  const label = tier === "fact" ? "Observed" : tier === "inference" ? "Inferred" : "Decided";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]",
        tier === "fact" && "border-border text-muted-foreground",
        tier === "inference" && "border-warning/30 text-warning",
        tier === "decision" && "border-royal/30 text-royal",
      )}
    >
      {label}
    </span>
  );
}
