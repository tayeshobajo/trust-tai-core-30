import { EditableTrackerTable } from "./editable-table";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { TTButton, TTInput } from "@/components/tt/primitives";
import { supabase } from "@/integrations/trust-tai/supabase";
import type { Roadmap } from "@/domain/roadmap";
import {
  ELEVATE_EVIDENCE,
  TRACKER_COLUMNS,
  isStaleElevate,
  previewTracker,
  trackerSummary,
  type TrackerField,
  type TrackerSnapshot,
} from "@/domain/roadmap-tracker";

interface Props {
  roadmaps: Roadmap[];
  organizationId: string;
  userId: string;
  loading: boolean;
  readError: boolean;
  canWork?: boolean;
}
export function RoadmapTracker(props: Props) {
  return (
    <div className="space-y-10">
      <EditableTrackerTable {...props} canWork={props.canWork ?? false} />
      <div className="border-t border-border pt-8">
        <SourceTracker {...props} />
      </div>
    </div>
  );
}
function SourceTracker({ roadmaps, organizationId, userId, loading, readError }: Props) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const source = useQuery({
    queryKey: ["roadmap", "tracker-preview", organizationId, userId],
    retry: false,
    queryFn: async (): Promise<TrackerSnapshot> => {
      const session = await supabase.auth.getSession();
      if (session.error || session.data.session?.user.id !== userId)
        throw new Error("Your session changed. Sign in again to review this source.");
      const response = await fetch(
        `/api/public/roadmap/tracker-preview?organizationId=${encodeURIComponent(organizationId)}`,
        {
          headers: { Authorization: `Bearer ${session.data.session.access_token}` },
          cache: "no-store",
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The source could not be read.");
      const after = await supabase.auth.getSession();
      if (after.data.session?.user.id !== userId)
        throw new Error("Your session changed. Reopen the tracker.");
      return result as TrackerSnapshot;
    },
  });
  if (source.isPending || loading)
    return <p role="status">Reading the tracker and existing roadmaps…</p>;
  if (source.isError || readError || !source.data)
    return (
      <div role="alert" className="space-y-3">
        <p>
          {source.error instanceof Error
            ? source.error.message
            : "Existing roadmaps could not be read. Identity review is unavailable."}
        </p>
        <TTButton onClick={() => void source.refetch()}>Read source again</TTButton>
      </div>
    );
  const snapshot = source.data;
  const preview = previewTracker(snapshot, roadmaps, organizationId);
  const summary = trackerSummary(snapshot.rows);
  const visible = preview.filter((row) =>
    (row.source.cells.project ?? "").toLowerCase().includes(query.toLowerCase()),
  );
  const selected = preview.find((row) => row.source.sourceKey === expanded);
  return (
    <section aria-labelledby="tracker-title" className="min-w-0 space-y-6">
      <div className="space-y-2">
        <p className="tt-eyebrow text-royal">Import review · Read only</p>
        <h2 id="tracker-title" className="font-display text-3xl">
          Review the workbook identities.
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Review the team's tracker alongside existing roadmaps. Confirm identities and reconcile
          old actions before a separate reviewed apply.
        </p>
      </div>
      <div className="rounded-xl border border-border bg-card p-4 text-sm space-y-2">
        <p className="font-medium">
          {preview.filter((row) => !row.roadmap).length} source rows need a canonical roadmap
          binding.
        </p>
        <p>
          No companies or roadmaps have been created. Source “Approved” does not grant approval.
          Sent previews and priced proposals stay separate.
        </p>
        <p className="text-muted-foreground">
          {summary.total} source roadmaps ·{" "}
          {summary.winRate === null
            ? "No recorded closed outcomes"
            : `${Math.round(summary.winRate * 100)}% recorded win rate`}{" "}
          ·{" "}
          {summary.averageDays === null
            ? "Conversion turnaround unknown"
            : `${summary.averageDays} days average turnaround`}
        </p>
        <p className="text-muted-foreground">
          Payment is unknown here. Signed value, invoices and Closed - Won are not receipts.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="text-sm">
          Find a source roadmap
          <TTInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mt-1 min-h-11"
            placeholder="Search tracker"
          />
        </label>
        <p className="text-xs text-muted-foreground">
          {visible.length} of {summary.total} rows · No live import applied
        </p>
      </div>
      <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">
            Source tracker preview. Open a row for all original columns and reconciliation evidence.
          </caption>
          <thead className="bg-secondary">
            <tr>
              {["Project / Roadmap", "Priority", "Roadmap Stage", "Next action", "Review"].map(
                (label) => (
                  <th key={label} scope="col" className="p-3 font-medium">
                    {label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.source.sourceKey} className="border-t border-border align-top">
                <th scope="row" className="p-3 font-medium">
                  {row.source.cells.project}
                </th>
                <td className="p-3">{row.source.cells.priority ?? "Unknown"}</td>
                <td className="p-3 whitespace-nowrap">
                  {row.source.cells.pipelineStage ?? "Unknown"}
                </td>
                <td className="p-3 max-w-xs">
                  {isStaleElevate(row.source)
                    ? "Old send action held for reconciliation"
                    : (row.roadmap?.nextMove?.action ?? "Unknown")}
                </td>
                <td className="p-3">
                  <TTButton
                    variant="secondary"
                    aria-expanded={expanded === row.source.sourceKey}
                    onClick={() =>
                      setExpanded(expanded === row.source.sourceKey ? null : row.source.sourceKey)
                    }
                  >
                    Review {row.source.cells.project}
                  </TTButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-3 md:hidden">
        {visible.map((row) => (
          <li
            key={row.source.sourceKey}
            className="rounded-xl border border-border bg-card p-4 space-y-2"
          >
            <h3 className="font-medium">{row.source.cells.project}</h3>
            <p className="text-sm">
              {row.source.cells.pipelineStage} · Priority {row.source.cells.priority ?? "unknown"}
            </p>
            <p className="text-sm text-muted-foreground">
              {isStaleElevate(row.source)
                ? "Old send action held for reconciliation"
                : "Canonical roadmap needs review"}
            </p>
            <TTButton
              variant="secondary"
              aria-expanded={expanded === row.source.sourceKey}
              onClick={() =>
                setExpanded(expanded === row.source.sourceKey ? null : row.source.sourceKey)
              }
            >
              Review {row.source.cells.project}
            </TTButton>
          </li>
        ))}
      </ul>
      {visible.length === 0 ? <p>No source roadmap matches this search.</p> : null}
      {selected ? (
        <section
          aria-label={`${selected.source.cells.project} source review`}
          className="rounded-xl border border-border bg-card p-5 space-y-4"
        >
          <h3 className="font-display text-2xl">{selected.source.cells.project} · source review</h3>
          <ul className="list-disc pl-5 text-sm space-y-2">
            {selected.holds.map((hold) => (
              <li key={hold}>{hold}</li>
            ))}
          </ul>
          {isStaleElevate(selected.source) ? (
            <a
              className="inline-flex min-h-11 items-center text-royal underline text-sm"
              href={ELEVATE_EVIDENCE.url}
              target="_blank"
              rel="noreferrer"
            >
              Read the October 2 sent quote evidence
            </a>
          ) : null}
          <dl className="grid gap-4 sm:grid-cols-2">
            {(Object.keys(TRACKER_COLUMNS) as TrackerField[]).map((field) => (
              <div key={field}>
                <dt className="text-xs text-muted-foreground">{TRACKER_COLUMNS[field]}</dt>
                <dd className="mt-1 break-words text-sm">
                  {selected.source.cells[field] ?? "Unknown · blank in source"}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground break-all">
            Evidence: {snapshot.sheet}!A{selected.source.row}:M{selected.source.row} · Source key{" "}
            {selected.source.sourceKey}. Last meaningful source update:{" "}
            {selected.source.cells.lastMeaningfulUpdate ?? "unknown"}. Workbook modification time is
            not a client update.
          </p>
          {selected.candidates.length ? (
            <p className="text-sm">
              Possible existing roadmaps:{" "}
              {selected.candidates.map((r) => r.subjectLabel).join(", ")}. Name similarity alone
              does not establish identity.
            </p>
          ) : null}
        </section>
      ) : null}
      <details className="rounded-xl border border-border bg-card p-4 text-sm">
        <summary className="min-h-11 cursor-pointer font-medium">
          Source evidence and apply boundary
        </summary>
        <div className="space-y-2 break-words">
          <a
            href={`https://drive.google.com/file/d/${snapshot.fileId}/view`}
            target="_blank"
            rel="noreferrer"
            className="text-royal underline"
          >
            {snapshot.fileName}
          </a>
          <p>
            {snapshot.sheet} · Modified {snapshot.modifiedAt}
          </p>
          <p className="break-all font-mono text-xs">SHA-256 {snapshot.sha256}</p>
          <p>
            All 13 source columns are preserved. Blank cells cannot erase current facts. A later
            apply needs reviewed stable identity bindings, a fresh read of each roadmap and conflict
            checks. This preview cannot apply changes.
          </p>
        </div>
      </details>
      <section className="space-y-3">
        <h3 className="text-base font-medium">Existing canonical roadmaps</h3>
        <p className="text-sm text-muted-foreground">
          Ownership, next moves, evidence and frozen exports remain in the existing roadmap
          workspace.
        </p>
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {roadmaps.map((roadmap) => (
            <li key={roadmap.id} className="p-4 space-y-2">
              <Link
                to="/modules/roadmap/$roadmapId"
                params={{ roadmapId: roadmap.id }}
                search={{ view: "overview" }}
                className="text-royal underline font-medium"
              >
                {roadmap.subjectLabel}
              </Link>
              <p className="text-sm">{roadmap.nextMove?.action ?? "Next move unknown"}</p>
              <p className="text-xs text-muted-foreground">
                Owner: {roadmap.ownerUserId ?? "Unassigned"} · Lifecycle: {roadmap.status}
              </p>
              <div className="flex flex-wrap gap-4 text-sm">
                {(["evidence", "exports", "decisions"] as const).map((view) => (
                  <Link
                    key={view}
                    className="inline-flex min-h-11 items-center text-royal underline capitalize"
                    to="/modules/roadmap/$roadmapId"
                    params={{ roadmapId: roadmap.id }}
                    search={{ view }}
                  >
                    {view}
                  </Link>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="border-t border-border pt-5 space-y-2">
        <h3 className="font-medium">First outreach batch</h3>
        <p className="text-sm text-muted-foreground">
          Blocked until each row has a verified recipient, an exact Comms draft and frozen roadmap
          export version, and a bounded human approval. Elevate's old send action remains excluded.
          Existing delivery receipts must be checked before another attempt.
        </p>
        <div className="flex gap-4">
          <Link
            className="inline-flex min-h-11 items-center text-sm text-royal underline"
            to="/modules/comms/drafts"
          >
            Review Comms drafts
          </Link>
          <Link
            className="inline-flex min-h-11 items-center text-sm text-royal underline"
            to="/modules/approvals"
          >
            Review approvals
          </Link>
        </div>
      </section>
    </section>
  );
}
