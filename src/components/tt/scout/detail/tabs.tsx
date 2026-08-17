/**
 * Scout company detail — tab bar and the deeper tab views.
 *
 * Overview stays curated; everything exhaustive lives here. Each view is
 * mounted only when its tab is active.
 */

import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";

import { TTButton } from "@/components/tt/primitives";
import type { ICPFactorView } from "@/data/scout/icp-factors";
import { ICP_STATUS_LABEL } from "@/data/scout/icp-factors";
import { signalTypeLabel, type RankedSignal, type SignalStrength } from "@/data/scout/top-signals";
import type { ActivityEvent } from "@/domain/activity";
import { cn } from "@/lib/utils";

import { DetailSection, Empty, FactorIcon, StrengthPill, relativeTime } from "./parts";

export const DETAIL_TABS = ["overview", "signals", "icp", "people", "notes", "activity"] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];

export function parseDetailTab(value: unknown): DetailTab {
  return DETAIL_TABS.includes(value as DetailTab) ? (value as DetailTab) : "overview";
}

export function DetailTabs({
  active,
  counts,
  onChange,
}: {
  active: DetailTab;
  counts: { signals: number; notes: number; people: number };
  onChange: (tab: DetailTab) => void;
}) {
  const items: { key: DetailTab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "signals", label: counts.signals > 0 ? `Signals (${counts.signals})` : "Signals" },
    { key: "icp", label: "ICP Analysis" },
    { key: "people", label: counts.people > 0 ? `People (${counts.people})` : "People" },
    { key: "notes", label: counts.notes > 0 ? `Notes (${counts.notes})` : "Notes" },
    { key: "activity", label: "Activity" },
  ];

  return (
    <div role="tablist" aria-label="Company detail sections" className="flex gap-1 overflow-x-auto border-b border-border">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={active === item.key}
          onClick={() => onChange(item.key)}
          className={cn(
            "shrink-0 border-b-2 px-3 py-3 text-[14px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            active === item.key
              ? "border-royal font-medium text-royal"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------- Signals -------------------------------- */

const STRENGTHS: (SignalStrength | "all")[] = ["all", "strong", "medium", "weak"];

export function SignalsTab({ signals }: { signals: RankedSignal[] }) {
  const [strength, setStrength] = useState<SignalStrength | "all">("all");
  const [type, setType] = useState<string>("all");
  const [recent, setRecent] = useState(false);

  const types = useMemo(
    () => Array.from(new Set(signals.map((s) => s.type))).sort(),
    [signals],
  );

  const filtered = signals.filter((signal) => {
    if (strength !== "all" && signal.strength !== strength) return false;
    if (type !== "all" && signal.type !== type) return false;
    if (recent) {
      const at = signal.observedAt ? Date.parse(signal.observedAt) : NaN;
      if (Number.isNaN(at) || Date.now() - at > 90 * 24 * 60 * 60 * 1000) return false;
    }
    return true;
  });

  return (
    <DetailSection title="All signals" meta={`${filtered.length} of ${signals.length}`}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          aria-label="Filter by strength"
          value={strength}
          onChange={(e) => setStrength(e.target.value as SignalStrength | "all")}
          className="h-9 rounded-lg border border-border bg-card px-2.5 text-[13px] text-foreground"
        >
          {STRENGTHS.map((value) => (
            <option key={value} value={value}>
              {value === "all" ? "All strengths" : value}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by signal type"
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="h-9 rounded-lg border border-border bg-card px-2.5 text-[13px] text-foreground"
        >
          <option value="all">All types</option>
          {types.map((value) => (
            <option key={value} value={value}>
              {signalTypeLabel(value)}
            </option>
          ))}
        </select>
        <TTButton
          variant="secondary"
          className={cn("h-9 px-3 text-[13px]", recent && "border-royal/40 text-royal")}
          onClick={() => setRecent((r) => !r)}
          aria-pressed={recent}
        >
          Last 90 days
        </TTButton>
      </div>

      {filtered.length === 0 ? (
        <Empty>No signals match these filters yet.</Empty>
      ) : (
        <ul className="space-y-2">
          {filtered.map((signal) => (
            <li key={signal.id} className="rounded-lg border border-border bg-cloud/60 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-medium text-foreground">{signal.title}</span>
                <StrengthPill strength={signal.strength} />
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                  {signal.confidence}
                </span>
              </div>
              <p className="mt-1 text-[13px] text-muted-foreground">{signal.explanation}</p>
              <p className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[11px] text-muted-foreground">
                <span>{signal.source}</span>
                <span>{relativeTime(signal.observedAt)}</span>
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
      )}
    </DetailSection>
  );
}

/* ------------------------------- ICP analysis ------------------------------ */

export function IcpAnalysisTab({
  view,
  explanation,
  icpVersion,
}: {
  view: ICPFactorView;
  explanation: string;
  icpVersion: number | null;
}) {
  return (
    <DetailSection
      title="ICP analysis"
      meta={icpVersion === null ? "No active ICP version" : `ICP v${icpVersion}`}
    >
      <p className="max-w-reading text-[14px] leading-relaxed text-muted-foreground">
        {explanation}
      </p>

      {view.factors.length === 0 ? (
        <div className="mt-4">
          <Empty>No factors have been evaluated. Research this company to score it.</Empty>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {view.factors.map((factor) => (
            <li key={factor.factorKey} className="rounded-lg border border-border px-4 py-3">
              <div className="flex items-start gap-3">
                <FactorIcon status={factor.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-medium text-foreground">{factor.label}</span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                      {ICP_STATUS_LABEL[factor.status]}
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] text-muted-foreground">{factor.reason}</p>
                  <p className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[11px] text-muted-foreground">
                    <span>
                      Contributes {factor.scoreContribution} of {factor.maxContribution}
                    </span>
                    <span>{factor.confidence}</span>
                    {factor.evidence.slice(0, 2).map((url) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 text-royal underline-offset-4 hover:underline"
                      >
                        View evidence
                        <ExternalLink aria-hidden className="size-3" />
                      </a>
                    ))}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </DetailSection>
  );
}

/* ----------------------------------- Notes --------------------------------- */

export function NotesTab({
  notes,
  onAdd,
  busy,
}: {
  notes: ActivityEvent[];
  onAdd: (body: string) => void;
  busy: boolean;
}) {
  const [body, setBody] = useState("");

  return (
    <DetailSection title="Notes">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!body.trim()) return;
          onAdd(body.trim());
          setBody("");
        }}
        className="mb-5"
      >
        <label htmlFor="scout-note" className="text-[13px] font-medium text-foreground">
          Add a note
        </label>
        <textarea
          id="scout-note"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={3}
          placeholder="What do you know that Scout cannot read from a public page?"
          className="mt-2 w-full rounded-lg border border-border bg-card px-3 py-2.5 text-[14px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="mt-2 flex justify-end">
          <TTButton type="submit" disabled={busy || !body.trim()} className="h-10 px-4 text-[13px]">
            {busy ? "Saving…" : "Save note"}
          </TTButton>
        </div>
      </form>

      {notes.length === 0 ? (
        <Empty>No notes yet.</Empty>
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => (
            <li key={note.id} className="rounded-lg border border-border px-4 py-3">
              <p className="text-[14px] leading-relaxed text-foreground">{note.summary}</p>
              <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                {note.provenance.actor.label ?? "Team member"} · {relativeTime(note.occurredAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </DetailSection>
  );
}

/* --------------------------------- Activity -------------------------------- */

export function ActivityTab({ events }: { events: ActivityEvent[] }) {
  return (
    <DetailSection title="Company activity" meta={`${events.length} recorded`}>
      {events.length === 0 ? (
        <Empty>No recent Scout activity.</Empty>
      ) : (
        <ol className="space-y-3">
          {events.map((event) => (
            <li
              key={event.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border pb-3 last:border-b-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-foreground">
                  {event.name.replace(/^[a-z]+\./, "").replace(/_/g, " ")}
                </p>
                <p className="text-[13px] text-muted-foreground">{event.summary}</p>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {event.provenance.appId} · {event.provenance.actor.type}
                </p>
              </div>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {relativeTime(event.occurredAt)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </DetailSection>
  );
}
