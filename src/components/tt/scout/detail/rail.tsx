/**
 * Scout company detail — right rail.
 *
 * Quick context and bounded action, never a second copy of the main column.
 */

import type { ActivityEvent } from "@/domain/activity";
import type { ProspectCandidate } from "@/domain/scout";
import type { ScoutNextStep } from "@/data/scout/next-steps";
import { cn } from "@/lib/utils";

import { DetailSection, Empty, SectionLink, relativeTime } from "./parts";

type Row = Record<string, unknown>;

function text(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    const parts = value.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean);
    return parts.length > 0 ? parts.slice(0, 4).join(", ") : undefined;
  }
  return undefined;
}

function fact(facts: Row, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = text(facts[key]);
    if (value) return value;
  }
  return undefined;
}

export function AtAGlanceCard({ candidate }: { candidate: ProspectCandidate }) {
  const facts = (candidate.facts ?? {}) as Row;
  const rows: { label: string; value: string | undefined }[] = [
    {
      label: "Employees",
      value:
        fact(facts, ["employees", "employee_count", "headcount", "company_size"]) ??
        candidate.profile?.size,
    },
    { label: "Founded", value: fact(facts, ["founded", "founded_year", "year_founded"]) },
    { label: "Revenue", value: fact(facts, ["revenue", "annual_revenue"]) },
    {
      label: "Headquarters",
      value: candidate.profile?.location ?? fact(facts, ["headquarters", "location", "city"]),
    },
    {
      label: "Industries",
      value: candidate.profile?.industry ?? fact(facts, ["industry", "industries", "sector"]),
    },
    { label: "Keywords", value: fact(facts, ["keywords", "tags", "services"]) },
  ];

  const known = rows.filter((row) => row.value);


  return (
    <DetailSection title="At a glance" emphasis="quiet">
      {known.length === 0 ? (
        <Empty>Nothing has been recorded about this company yet.</Empty>
      ) : (
        <dl className="space-y-2.5">
          {known.map((row) => (
            <div key={row.label} className="grid grid-cols-[110px_minmax(0,1fr)] gap-3">
              <dt className="text-[12px] text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 text-[13px] text-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </DetailSection>
  );
}

export function TopReasonsCard({ reasons }: { reasons: string[] }) {
  return (
    <DetailSection title="Top reasons to pursue" emphasis="quiet">
      {reasons.length === 0 ? (
        <Empty>Scout has no evidence-backed reasons for this company yet.</Empty>
      ) : (
        <ul className="space-y-2.5">
          {reasons.map((reason) => (
            <li key={reason} className="flex gap-2.5 text-[13px] text-muted-foreground">
              <span
                aria-hidden
                className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-success/25 bg-success/10 text-[9px] text-success"
              >
                ✓
              </span>
              <span className="min-w-0">{reason}</span>
            </li>
          ))}
        </ul>
      )}
    </DetailSection>
  );
}

export function NextStepsCard({
  steps,
  onSelect,
  busy,
}: {
  steps: ScoutNextStep[];
  onSelect: (step: ScoutNextStep) => void;
  busy: boolean;
}) {
  return (
    <DetailSection title="Potential next steps" emphasis="quiet">
      <ul className="space-y-1">
        {steps.map((step) => (
          <li key={step.key}>
            <button
              type="button"
              disabled={!step.available || busy}
              onClick={() => onSelect(step)}
              className={cn(
                "w-full rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                step.available && !busy
                  ? "hover:bg-cloud"
                  : "cursor-not-allowed opacity-60",
              )}
            >
              <span className="block text-[13px] font-medium text-foreground">{step.label}</span>
              <span className="block text-[12px] text-muted-foreground">
                {step.available ? step.description : step.unavailableReason ?? "Not available yet."}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </DetailSection>
  );
}

export function NotesPreviewCard({
  notes,
  onAdd,
  onViewAll,
}: {
  notes: ActivityEvent[];
  onAdd: () => void;
  onViewAll: () => void;
}) {
  const latest = notes[0];
  return (
    <DetailSection title="Notes" emphasis="quiet">
      {latest ? (
        <div>
          <p className="text-[13px] leading-relaxed text-muted-foreground">{latest.summary}</p>
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">
            {relativeTime(latest.occurredAt)}
          </p>
        </div>
      ) : (
        <Empty>No notes yet.</Empty>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <SectionLink onClick={onAdd}>Add note</SectionLink>
        {notes.length > 0 ? <SectionLink onClick={onViewAll}>View all notes</SectionLink> : null}
      </div>
    </DetailSection>
  );
}
