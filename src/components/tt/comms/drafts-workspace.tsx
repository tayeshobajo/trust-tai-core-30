/**
 * Drafts & Reviews, as one workspace.
 *
 * A single list of unsent writing on the left — drafts held at the human
 * boundary and the review records that govern them — and one focused surface
 * on the right: the draft itself, its review, or a new piece of writing.
 *
 * Selection lives in the address, so a reload resumes on the same record.
 * Nothing here sends on its own: a send still goes through the one governed
 * endpoint, which refuses anything without a current approval of exactly
 * these words.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  fetchQueue,
  openReview,
  rejectDraft,
  reopenDraft,
  sendDraft,
  type QueueItem,
} from "@/components/tt/comms/draft-queue";
import { NewReview, ReviewDetail } from "@/components/tt/comms/review-workspace";
import { TTButton } from "@/components/tt/primitives";
import { listReviews } from "@/data/supabase/comms-review-client";
import { DRAFT_KIND_LABEL, DRAFT_KINDS, type DraftKind } from "@/domain/comms-draft-kind";
import type { ReviewSession } from "@/domain/comms-review";
import { cn } from "@/lib/utils";
import type { WorkspaceIdentity } from "@/lib/workspace";

export type DraftsFilter = "all" | "waiting" | "review" | "approved";

export const DRAFTS_FILTERS: DraftsFilter[] = ["all", "waiting", "review", "approved"];

export const DRAFTS_FILTER_LABEL: Record<DraftsFilter, string> = {
  all: "All",
  waiting: "Waiting on you",
  review: "In review",
  approved: "Approved",
};

export interface DraftsSelection {
  session?: string;
  draft?: string;
  filter?: DraftsFilter;
  new?: DraftKind;
}

interface Row {
  key: string;
  kind: "draft" | "session";
  title: string;
  detail: string;
  state: DraftsFilter;
  stateLabel: string;
  draftId?: string;
  sessionId?: string;
  at: string;
}

function rowsFrom(queue: QueueItem[], sessions: ReviewSession[]): Row[] {
  const boundDrafts = new Set(sessions.map((session) => session.draftId).filter(Boolean));
  const fromSessions: Row[] = sessions.map((session) => ({
    key: `session:${session.id}`,
    kind: "session",
    title: session.title,
    detail:
      session.recipientName ??
      session.recipientEmail ??
      (session.kind ? DRAFT_KIND_LABEL[session.kind] : "No recipient named"),
    state: session.status === "approved" ? "approved" : "review",
    stateLabel: session.status === "approved" ? "Approved" : "In review",
    ...(session.draftId ? { draftId: session.draftId } : {}),
    sessionId: session.id,
    at: session.updatedAt,
  }));

  /* A draft that already has a review is that review's row. Showing it twice
     would be two records where there is one. */
  const fromDrafts: Row[] = queue
    .filter((item) => !boundDrafts.has(item.draft.id))
    .map((item) => ({
      key: `draft:${item.draft.id}`,
      kind: "draft",
      title: item.draft.subject ?? "(no subject)",
      detail: item.relationship?.full_name ?? "Unknown contact",
      state: "waiting",
      stateLabel: "Waiting on you",
      draftId: item.draft.id,
      at: item.draft.created_at,
    }));

  return [...fromDrafts, ...fromSessions].sort((a, b) => b.at.localeCompare(a.at));
}

export function DraftsWorkspace({
  identity,
  selection,
  onSelect,
}: {
  identity: WorkspaceIdentity;
  selection: DraftsSelection;
  /** Selection is written to the address so a reload lands in the same place. */
  onSelect: (next: DraftsSelection) => void;
}) {
  const queryClient = useQueryClient();
  const filter = selection.filter ?? "all";
  const [intakeDirty, setIntakeDirty] = useState(false);

  const queue = useQuery({
    queryKey: ["comms", "queue", identity.organizationId],
    queryFn: () => fetchQueue(identity.organizationId),
  });
  const reviews = useQuery({
    queryKey: ["comms", "reviews", identity.organizationId],
    queryFn: () => listReviews(identity.organizationId),
  });

  const rows = rowsFrom(queue.data ?? [], reviews.data ?? []);
  const shown = filter === "all" ? rows : rows.filter((row) => row.state === filter);

  /* Arriving with ?draft=… from the dashboard: if that draft already has a
     review, go straight to it. The server validates the workspace on the
     bind; nothing here trusts the address. */
  const selectedRow =
    (selection.session
      ? rows.find((row) => row.sessionId === selection.session)
      : selection.draft
        ? rows.find((row) => row.draftId === selection.draft)
        : undefined) ?? null;

  const bind = useMutation({
    mutationFn: (draftId: string) => openReview(draftId, identity.organizationId),
    onSuccess: (sessionId) => {
      void queryClient.invalidateQueries({ queryKey: ["comms", "reviews"] });
      move({ session: sessionId });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const reject = useMutation({
    mutationFn: rejectDraft,
    onSuccess: () => {
      toast.success("Draft rejected");
      void queryClient.invalidateQueries({ queryKey: ["comms", "queue"] });
      move({});
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const send = useMutation({
    mutationFn: (draftId: string) => sendDraft(draftId, identity.organizationId),
    onSuccess: () => {
      toast.success("Sent");
      void queryClient.invalidateQueries({ queryKey: ["comms", "queue"] });
    },
    onError: async (error: Error, draftId: string) => {
      toast.error(error.message);
      await reopenDraft(draftId, identity);
    },
  });

  /** Moving away from unsaved typing always asks first. */
  function move(next: DraftsSelection) {
    if (
      intakeDirty &&
      selection.new &&
      !window.confirm("You have unsaved writing here. Leave it behind?")
    ) {
      return;
    }
    setIntakeDirty(false);
    onSelect({ ...(selection.filter ? { filter: selection.filter } : {}), ...next });
  }

  /* Browser-level protection for the same unsaved typing. */
  useEffect(() => {
    if (!intakeDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [intakeDirty]);

  const failed = queue.error ?? reviews.error;

  return (
    <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="max-h-[78vh] space-y-3 overflow-auto rounded-xl border border-border p-3 lg:sticky lg:top-20">
        <div className="flex flex-wrap items-center gap-1.5">
          {DRAFTS_FILTERS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={filter === option}
              onClick={() => onSelect({ ...selection, filter: option })}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                filter === option
                  ? "border-[var(--royal)] text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {DRAFTS_FILTER_LABEL[option]}
              <span className="ml-1 text-muted-foreground">
                {option === "all" ? rows.length : rows.filter((row) => row.state === option).length}
              </span>
            </button>
          ))}
        </div>

        {failed ? (
          <div className="space-y-2">
            <p className="text-[13px] text-destructive">This list could not be read just now.</p>
            <TTButton
              size="sm"
              variant="quiet"
              onClick={() => {
                void queue.refetch();
                void reviews.refetch();
              }}
            >
              Try again
            </TTButton>
          </div>
        ) : queue.isPending || reviews.isPending ? (
          <p className="text-[13px] text-muted-foreground">Reading…</p>
        ) : shown.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Nothing in this filter.</p>
        ) : (
          <ul className="space-y-1.5">
            {shown.map((row) => {
              const active =
                (row.sessionId && row.sessionId === selection.session) ||
                (row.draftId && row.draftId === selection.draft && !selection.session);
              return (
                <li key={row.key}>
                  <button
                    type="button"
                    onClick={() =>
                      move(
                        row.sessionId ? { session: row.sessionId } : { draft: row.draftId ?? "" },
                      )
                    }
                    className={cn(
                      "w-full rounded-lg border px-3 py-2 text-left",
                      active ? "border-[var(--royal)] bg-secondary/50" : "border-transparent hover:bg-secondary/40",
                    )}
                  >
                    <span className="block text-[13px] text-foreground">{row.title}</span>
                    <span className="block text-[12px] text-muted-foreground">
                      {row.detail} · {row.stateLabel}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <section className="min-w-0">
        {selection.new ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-muted-foreground">New</span>
              {DRAFT_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={selection.new === kind}
                  onClick={() => onSelect({ ...selection, new: kind })}
                  className={cn(
                    "rounded-full border px-3 py-1 text-[12px]",
                    selection.new === kind
                      ? "border-[var(--royal)] text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {DRAFT_KIND_LABEL[kind]}
                </button>
              ))}
            </div>
            <NewReview
              identity={identity}
              kind={selection.new}
              onDirty={setIntakeDirty}
              onOpened={(sessionId) => onSelect({ session: sessionId })}
            />
          </div>
        ) : selection.session ? (
          <ReviewDetail
            identity={identity}
            sessionId={selection.session}
            onBack={() => move({})}
          />
        ) : selectedRow?.draftId ? (
          <DraftPane
            item={(queue.data ?? []).find((entry) => entry.draft.id === selectedRow.draftId)}
            busy={bind.isPending || reject.isPending || send.isPending}
            onReview={() => bind.mutate(selectedRow.draftId ?? "")}
            onReject={() => reject.mutate(selectedRow.draftId ?? "")}
            onSend={() => send.mutate(selectedRow.draftId ?? "")}
          />
        ) : (
          <div className="rounded-xl border border-border p-8">
            <p className="text-[13px] text-muted-foreground">
              Choose something on the left, or start a new draft. Nothing is sent from this page
              without an approval of those exact words.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function DraftPane({
  item,
  busy,
  onReview,
  onReject,
  onSend,
}: {
  item: QueueItem | undefined;
  busy: boolean;
  onReview: () => void;
  onReject: () => void;
  onSend: () => void;
}) {
  if (!item) {
    return (
      <div className="rounded-xl border border-border p-8">
        <p className="text-[13px] text-muted-foreground">
          That draft is not in the waiting list any more. It may have been reviewed, rejected or
          sent.
        </p>
      </div>
    );
  }
  const email = item.relationship?.email ?? null;
  return (
    <article className="space-y-4 rounded-xl border border-border p-5">
      <header className="space-y-1">
        <h2 className="text-[17px] text-foreground">{item.draft.subject ?? "(no subject)"}</h2>
        <p className="text-[12px] text-muted-foreground">
          To {item.relationship?.full_name ?? "unknown contact"} · {email ?? "no email set"}
        </p>
      </header>
      <pre className="whitespace-pre-wrap rounded-lg bg-secondary/40 p-4 text-[13px] leading-relaxed text-foreground">
        {item.draft.body}
      </pre>
      <div className="flex flex-wrap items-center gap-2">
        <TTButton size="sm" disabled={busy} onClick={onReview}>
          Open its review
        </TTButton>
        <TTButton size="sm" variant="quiet" disabled={busy} onClick={onReject}>
          Reject
        </TTButton>
        <TTButton
          size="sm"
          variant="quiet"
          disabled={busy || !email}
          onClick={onSend}
          title={email ? undefined : "No email address on this relationship"}
        >
          Send
        </TTButton>
      </div>
      <p className="text-[12px] text-muted-foreground">
        Send asks the one governed endpoint. It refuses unless a current, approved review covers
        exactly these words.
      </p>
    </article>
  );
}
