/**
 * Prepared work, where the person doing the work already is.
 *
 * It shows one of four honest things and never a fifth: what was prepared,
 * that it is still being prepared, that it could not be prepared and what to
 * do about it, or that the record could not be read at all. An unreadable
 * record is never drawn as "nothing prepared".
 *
 * Nothing here accepts, sends or changes anything. Acceptance stays with the
 * room that owns the subject and the authority it already has.
 */

import { useQuery } from "@tanstack/react-query";

import { PreparationResult, PreparationStateBadge } from "@/components/tt/preparation-state";
import { latestPreparationFor, PreparationUnavailable } from "@/data/preparation-outputs";
import type { ID } from "@/domain/entities";
import { outputIsCurrent, type PreparationJobId } from "@/domain/preparation-jobs";

export interface PreparationPanelProps {
  organizationId: ID;
  jobId: PreparationJobId;
  subjectRef: string;
  /** What the subject stands at now, so stale work says so rather than lying. */
  currentRevision?: string;
  /** Where the original lives, so a person can always read the source. */
  sourceHref?: string;
  sourceLabel?: string;
}

export function PreparationPanel({
  organizationId,
  jobId,
  subjectRef,
  currentRevision,
  sourceHref,
  sourceLabel = "Open the original",
}: PreparationPanelProps) {
  const query = useQuery({
    queryKey: ["preparation", organizationId, jobId, subjectRef],
    queryFn: () => latestPreparationFor({ organizationId, jobId, subjectRef }),
    retry: false,
  });

  if (query.isLoading) {
    return (
      <section className="comms-card p-5" aria-busy="true">
        <p className="text-sm text-muted-foreground">Reading prepared work.</p>
      </section>
    );
  }

  if (query.isError) {
    const error = query.error;
    return (
      <section className="comms-card p-5" role="alert">
        <h3 className="text-[18px] font-medium text-foreground">Prepared work is unavailable</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {error instanceof PreparationUnavailable
            ? error.message
            : "Prepared work could not be read, so nothing is shown here."}
        </p>
        <button
          type="button"
          onClick={() => void query.refetch()}
          className="mt-4 rounded-full border border-border px-4 py-2 text-sm text-foreground"
        >
          Read again
        </button>
      </section>
    );
  }

  const output = query.data ?? null;
  if (!output) {
    return (
      <section className="comms-card p-5">
        <h3 className="text-[18px] font-medium text-foreground">Nothing prepared yet</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Nothing has been prepared for this. Preparation runs only where someone with authority has
          switched it on for this workspace.
        </p>
        {sourceHref ? (
          <a className="mt-4 inline-block text-sm text-royal underline" href={sourceHref}>
            {sourceLabel}
          </a>
        ) : null}
      </section>
    );
  }

  const freshness = currentRevision ? outputIsCurrent(output, currentRevision) : null;

  return (
    <section className="grid gap-3">
      <PreparationResult output={output} showDetail />
      <div className="comms-card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="grid gap-1">
          <p className="text-sm text-foreground">
            Owner: <span className="font-medium">{output.ownerLabel}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {output.finishedAt
              ? `Prepared ${new Date(output.finishedAt).toLocaleString()}`
              : output.startedAt
                ? `Started ${new Date(output.startedAt).toLocaleString()}`
                : "No time recorded"}
            {" · "}
            {output.status === "prepared" || output.status === "needs_decision"
              ? "Prepared, not accepted"
              : "Not prepared"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <PreparationStateBadge status={output.status} />
          {sourceHref ? (
            <a className="text-sm text-royal underline" href={sourceHref}>
              {sourceLabel}
            </a>
          ) : null}
        </div>
      </div>
      {freshness && !freshness.current ? (
        <p className="comms-card p-4 text-sm text-muted-foreground" role="status">
          Out of date: {freshness.because}
        </p>
      ) : null}
      {output.status === "could_not_finish" || output.status === "uncertain" ? (
        <p className="comms-card p-4 text-sm text-muted-foreground" role="status">
          {output.status === "uncertain"
            ? "We cannot tell whether this finished. Check the source before it runs again."
            : "This did not finish. It will be prepared again the next time the source moves, or someone with authority can run it again."}
        </p>
      ) : null}
    </section>
  );
}
