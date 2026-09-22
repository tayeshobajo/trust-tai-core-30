/**
 * History: everything that has left, and everything that came back.
 *
 * One list, newest first: sent messages, replies on the record, and the
 * drafts whose review ended in a send. Each row opens the exact conversation
 * it belongs to, and can start a new piece of writing from the words already
 * there.
 *
 * Preparing a new draft never sends. It opens the same review every other
 * piece of writing has to clear, with the earlier words carried in.
 */

import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";

import { MetaPill, TTButton, TTCard, TTInput } from "@/components/tt/primitives";
import { HISTORY_PAGE, HistoryUnavailable, listHistory } from "@/data/comms-history";
import { createReview } from "@/data/supabase/comms-review-client";
import { whenLabel } from "@/domain/comms-dashboard";
import {
  HISTORY_FILTERS,
  HISTORY_FILTER_LABEL,
  HISTORY_KIND_LABEL,
  HISTORY_KIND_NOTE,
  draftSeedFrom,
  historyCounts,
  inHistoryFilter,
  matchesHistoryQuery,
  type HistoryEntry,
  type HistoryFilter,
} from "@/domain/comms-history";
import type { WorkspaceIdentity } from "@/lib/workspace";
import { cn } from "@/lib/utils";

export interface HistorySelection {
  filter?: HistoryFilter;
  relationship?: string;
  q?: string;
}

function tabClass(active: boolean) {
  return cn(
    "inline-flex h-8 items-center rounded-full border px-3 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "border-[var(--royal)] bg-secondary font-medium text-foreground"
      : "border-border text-muted-foreground hover:text-foreground",
  );
}

function HistoryRow({
  entry,
  busy,
  onPrepare,
}: {
  entry: HistoryEntry;
  busy: boolean;
  onPrepare: () => void;
}) {
  return (
    <TTCard className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-foreground">
          {entry.personName}
          {entry.companyName ? (
            <span className="text-muted-foreground"> · {entry.companyName}</span>
          ) : null}
        </p>
        <span className="font-mono text-[11px] text-muted-foreground">
          {whenLabel(entry.occurredAt)}
        </span>
      </div>

      <p className="mt-1 text-[14px] text-foreground">{entry.subject}</p>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <MetaPill>{HISTORY_KIND_LABEL[entry.kind]}</MetaPill>
        <MetaPill>{entry.channelLabel}</MetaPill>
      </div>

      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{entry.preview}</p>
      <p className="mt-1 text-[12px] text-muted-foreground">{HISTORY_KIND_NOTE[entry.kind]}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {entry.relationshipId ? (
          <TTButton asChild size="sm" variant="quiet">
            <Link
              to="/modules/comms/relationships"
              search={{
                relationship: entry.relationshipId,
                ...(entry.threadId ? { thread: entry.threadId } : {}),
                ...(entry.messageId ? { message: entry.messageId } : {}),
              }}
            >
              Open in the conversation
            </Link>
          </TTButton>
        ) : null}
        <TTButton size="sm" onClick={onPrepare} disabled={busy}>
          {busy ? "Preparing…" : "Edit or send again"}
        </TTButton>
        <span className="text-[12px] text-muted-foreground">
          This opens a new draft with these words. Nothing is sent until the usual review and
          approval.
        </span>
      </div>
    </TTCard>
  );
}

export function HistoryWorkspace({
  identity,
  selection,
  onSelect,
}: {
  identity: WorkspaceIdentity;
  selection: HistorySelection;
  onSelect: (next: HistorySelection) => void;
}) {
  const [limit, setLimit] = useState(HISTORY_PAGE);
  const [problem, setProblem] = useState<string | null>(null);
  const navigate = useNavigate();

  const history = useQuery({
    queryKey: ["comms", "history", identity.organizationId, limit],
    queryFn: () => listHistory(identity.organizationId, { limit }),
    retry: false,
  });

  const filter = selection.filter ?? "all";
  const query = selection.q ?? "";

  const all = history.data?.entries ?? [];
  const scoped = useMemo(
    () =>
      selection.relationship
        ? all.filter((entry) => entry.relationshipId === selection.relationship)
        : all,
    [all, selection.relationship],
  );
  const counts = useMemo(() => historyCounts(scoped), [scoped]);
  const shown = useMemo(
    () =>
      scoped.filter((entry) => inHistoryFilter(entry, filter) && matchesHistoryQuery(entry, query)),
    [scoped, filter, query],
  );

  const prepare = useMutation({
    mutationFn: async (entry: HistoryEntry) => {
      const seed = draftSeedFrom(entry);
      if (!seed.recipientEmail) {
        throw new Error(
          "No email address is on record for this person, so a new draft cannot be addressed yet.",
        );
      }
      const created = await createReview({
        organizationId: identity.organizationId,
        title: seed.title,
        situation: seed.situation,
        goal: seed.goal,
        recipientName: seed.recipientName,
        recipientEmail: seed.recipientEmail,
        subject: seed.subject,
        body: seed.body,
        kind: "email",
        sources: [{ label: "The earlier message", text: seed.body }],
      });
      return created.sessionId;
    },
    onSuccess: (sessionId) => {
      setProblem(null);
      void navigate({ to: "/modules/comms/drafts", search: { session: sessionId } });
    },
    onError: (error: unknown) => {
      setProblem(error instanceof Error ? error.message : "That draft could not be prepared.");
    },
  });

  if (history.isLoading) {
    return <p className="text-[13px] text-muted-foreground">Reading the record…</p>;
  }

  if (history.isError) {
    const error = history.error;
    return (
      <TTCard className="p-4">
        <p className="text-sm font-medium text-foreground">History is unavailable right now</p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {error instanceof HistoryUnavailable
            ? error.message
            : "The record could not be read just now. This is a failed read, not an empty history."}
        </p>
        <TTButton size="sm" className="mt-3" onClick={() => void history.refetch()}>
          Try reading again
        </TTButton>
      </TTCard>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {HISTORY_FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={filter === option}
            className={tabClass(filter === option)}
            onClick={() => onSelect({ ...selection, filter: option })}
          >
            {HISTORY_FILTER_LABEL[option]} · {counts[option]}
          </button>
        ))}
        <div className="ml-auto min-w-[14rem] flex-1">
          <label className="sr-only" htmlFor="history-search">
            Search history
          </label>
          <TTInput
            id="history-search"
            value={query}
            placeholder="Search by person, company or subject"
            onChange={(event) => onSelect({ ...selection, q: event.target.value })}
          />
        </div>
      </div>

      {selection.relationship ? (
        <p className="text-[13px] text-muted-foreground">
          Showing one person&apos;s record.{" "}
          <button
            type="button"
            className="font-medium text-royal underline-offset-2 hover:underline"
            onClick={() => {
              const { relationship: _drop, ...rest } = selection;
              onSelect(rest);
            }}
          >
            Show the whole workspace
          </button>
        </p>
      ) : null}

      <p className="text-[12px] text-muted-foreground">
        The last {history.data?.windowDays ?? 0} days, newest first. A record here means a message
        or a draft exists. It never claims something was delivered, read or agreed.
      </p>

      {problem ? (
        <p role="alert" className="text-[13px] font-medium text-destructive">
          {problem}
        </p>
      ) : null}

      {shown.length === 0 ? (
        <TTCard className="p-4">
          <p className="text-sm font-medium text-foreground">Nothing on the record here yet</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Sent messages, replies that arrived, and drafts whose review ended in a send all appear
            here. Nothing matches this view in the window shown.
          </p>
        </TTCard>
      ) : (
        <ul className="space-y-3">
          {shown.map((entry) => (
            <li key={entry.id}>
              <HistoryRow
                entry={entry}
                busy={prepare.isPending && prepare.variables?.id === entry.id}
                onPrepare={() => prepare.mutate(entry)}
              />
            </li>
          ))}
        </ul>
      )}

      {history.data?.more ? (
        <TTButton
          size="sm"
          variant="quiet"
          onClick={() => setLimit((value) => value + HISTORY_PAGE)}
        >
          Show more
        </TTButton>
      ) : null}
    </div>
  );
}
