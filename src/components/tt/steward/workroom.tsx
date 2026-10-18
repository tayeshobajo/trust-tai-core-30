/**
 * Steward's meeting workroom on real data — the data wiring.
 *
 * Reads stored conversations, person-confirmed commitments and completion
 * receipts and canonical business work, then passes them to WorkroomView.
 * Explicit Add task uses the authenticated canonical task service; bounded
 * open-page sync may store meeting imports. Proposal confirmation stays on
 * the meeting review page. Verify/reopen remain blocked pending atomic persistence.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { syncRecentMeetings } from "@/data/steward/recent-sync";
import { stewardService } from "@/data/supabase/steward-service";
import { stewardTaskState } from "@/data/supabase/steward-task-state";
import { extractProposals } from "@/data/steward/extract";
import { buildWorkroom, receiptMapFrom } from "@/domain/steward-workroom";
import type { WorkspaceIdentity } from "@/lib/workspace";

import { WorkroomMoreMenu, WorkroomView } from "./workroom-view";
import { TaskHistory } from "./task-history";
import { TaskEditor } from "./business-task-board";
import { AppShell } from "@/components/tt/app-shell";
import { businessWorkQuery, cmdTasks } from "@/data/supabase/cmd-tasks";
import { mayAddRequiredWork } from "@/domain/steward-required-work";
import { appendLinkedBusinessWork } from "@/domain/steward-meeting-links";
import { mayEditBoardTask, type BoardEdit, type BoardTask } from "@/domain/cmd-tasks";
import { useTaskChoices } from "@/data/steward/task-choices";

const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const FOCUS_THROTTLE_MS = 60 * 1000;

/* ---------------------------------------------------------- auto sync */

function useRecentSync(identity: WorkspaceIdentity) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<{
    lastSuccessAt: string | null;
    added: number;
    refreshed: number;
    unchanged: number;
    preserved: number;
    warnings: string[];
    pendingTranscript: number;
    hasMore: boolean;
    failure: string | null;
    running: boolean;
  }>({
    lastSuccessAt: null,
    added: 0,
    refreshed: 0,
    unchanged: 0,
    preserved: 0,
    warnings: [],
    pendingTranscript: 0,
    hasMore: false,
    failure: null,
    running: false,
  });
  /* Concurrent runs are deduped inside syncRecentMeetings per org+user; this
     ref additionally prevents overlapping effect invocations. */
  const runningRef = useRef(false);
  /* Focus events can fire in bursts; throttle so a run starts at most once
     per window. */
  const lastStartRef = useRef(0);
  /* Set when the identity changes or the component unmounts, so a late
     result from the previous identity never lands in the new state. */
  const staleRef = useRef(false);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    const now = Date.now();
    if (now - lastStartRef.current < FOCUS_THROTTLE_MS) return;
    lastStartRef.current = now;
    runningRef.current = true;
    setState((s) => ({ ...s, running: true, failure: null }));
    try {
      /* Each incoming call is matched by an authoritative per-call lookup
         inside syncRecentMeetings — exact org+provider identity queries
         against the conversations table, no capped listing — so an older
         match is never treated as missing and duplicated. */
      const outcome = await syncRecentMeetings({
        organizationId: identity.organizationId,
        userId: identity.userId,
      });
      if (staleRef.current) return;
      setState((s) => ({
        /* A failed or partially written check never erases the last time a
           pull fully succeeded. */
        lastSuccessAt: outcome.checkedAt ?? s.lastSuccessAt,
        added: outcome.added,
        refreshed: outcome.refreshed,
        unchanged: outcome.unchanged,
        preserved: outcome.preserved,
        warnings: outcome.warnings,
        pendingTranscript: outcome.pendingTranscript,
        hasMore: outcome.hasMore,
        failure:
          outcome.errors.length > 0
            ? `${outcome.errors.length} call check${outcome.errors.length === 1 ? "" : "s"} failed. ${outcome.errors[0] ?? ""}`
            : null,
        running: false,
      }));
      if (outcome.added > 0 || outcome.refreshed > 0) {
        await queryClient.invalidateQueries({
          queryKey: ["steward", "workroom", "conversations", identity.organizationId],
        });
      }
    } catch (error) {
      if (staleRef.current) return;
      setState((s) => ({
        ...s,
        running: false,
        failure: error instanceof Error ? error.message : "Could not check for recent calls.",
      }));
    } finally {
      runningRef.current = false;
    }
  }, [identity.organizationId, identity.userId, queryClient]);

  useEffect(() => {
    staleRef.current = false;
    void run();
    const onFocus = () => void run();
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(onFocus, SYNC_INTERVAL_MS);
    return () => {
      staleRef.current = true;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
    };
  }, [run]);

  return { ...state, onRetry: () => void run() };
}

/* ---------------------------------------------------------- wiring */

export interface WorkroomSelection {
  meetingId: string | null;
  rowKey: string | null;
}

export function StewardWorkroom({
  identity,
  selection,
  onSelect,
}: {
  identity: WorkspaceIdentity;
  /** Validated URL selection from the route; reload/back restore it. */
  selection?: WorkroomSelection | undefined;
  onSelect?: ((meetingId: string | null, rowKey: string | null) => void) | undefined;
}) {
  return (
    <AppShell identity={identity} canvas="workroom">
      <StewardWorkroomContent identity={identity} selection={selection} onSelect={onSelect} />
    </AppShell>
  );
}

function StewardWorkroomContent({
  identity,
  selection,
  onSelect,
}: {
  identity: WorkspaceIdentity;
  selection?: WorkroomSelection | undefined;
  onSelect?: ((meetingId: string | null, rowKey: string | null) => void) | undefined;
}) {
  const queryClient = useQueryClient();
  const org = identity.organizationId;
  const business = useQuery(businessWorkQuery(org, identity.userId));
  const conversations = useQuery({
    queryKey: ["steward", "workroom", "conversations", org],
    queryFn: () => stewardService.conversations(org, 60),
  });
  const commitments = useQuery({
    queryKey: ["steward", "commitments", org],
    queryFn: () => stewardService.commitments(org),
  });
  const receipts = useQuery({
    queryKey: ["steward", "task-state", org],
    queryFn: () => stewardTaskState.list(org),
  });

  const sync = useRecentSync(identity);

  /* Canonical task editing from the workroom cells: the same TaskEditor and
     revision-checked service as the business board, never a parallel path. */
  const [editing, setEditing] = useState<{
    task: BoardTask;
    field: "owner" | "due" | "status";
  } | null>(null);
  const choices = useTaskChoices(org, { userId: identity.userId, name: identity.name });
  const meetingRead = useQuery({
    queryKey: ["steward", "meeting-options", org, identity.userId],
    queryFn: () => cmdTasks.meetingOptions(org),
    enabled: !!editing,
  });
  const taskById = useMemo(() => {
    const map = new Map((business.data?.tasks ?? []).map((task) => [task.id, task]));
    return (id: string) => map.get(id);
  }, [business.data]);
  const actor = { userId: identity.userId, role: identity.role };
  async function saveEdit(input: BoardEdit) {
    if (!editing) return;
    await cmdTasks.update(editing.task, input);
    await queryClient.invalidateQueries({
      queryKey: businessWorkQuery(org, identity.userId).queryKey,
    });
    setEditing(null);
  }

  const receiptMap = useMemo(
    () => receiptMapFrom(receipts.data, receipts.isError),
    [receipts.data, receipts.isError],
  );

  const proposalCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of conversations.data ?? []) {
      const confirmed = new Set(
        (commitments.data ?? []).filter((k) => k.conversationId === c.id).map((k) => k.sourceKey),
      );
      const proposals = extractProposals(c.conversation).filter((p) => !confirmed.has(p.id));
      map.set(c.id, proposals.length);
    }
    return map;
  }, [conversations.data, commitments.data]);

  const meetings = useMemo(() => {
    if (!conversations.data || !commitments.data) return [];
    return buildWorkroom(
      conversations.data
        .filter((c) => c.provider === "fathom")
        .map((c) => {
          const segments = Array.isArray(c.conversation?.segments) ? c.conversation.segments : [];
          return {
            id: c.id,
            title: c.title || "Untitled meeting",
            occurredAt: c.occurredAt,
            provider: c.provider,
            sourceUrl: c.sourceUrl,
            participantCount: c.participants.length,
            segmentCount: segments.length,
            lastSegmentAt: segments.length ? (segments[segments.length - 1]?.at ?? null) : null,
            /* No stored Fathom record carries a trustworthy completeness
               contract today, so coverage stays unknown. */
            coverageConfirmed: false,
          };
        }),
      commitments.data,
      receiptMap,
      proposalCounts,
    );
  }, [conversations.data, commitments.data, receiptMap, proposalCounts]);

  const commitmentById = useMemo(() => {
    const map = new Map((commitments.data ?? []).map((c) => [c.id, c]));
    return (id: string) => map.get(id);
  }, [commitments.data]);
  const linkedMeetings = useMemo(
    () =>
      appendLinkedBusinessWork(
        meetings,
        business.isError || business.isPending ? [] : (business.data?.tasks ?? []),
        org,
        typeof window === "undefined" ? undefined : window.location.origin,
      ),
    [meetings, business.data, business.isError, business.isPending, org],
  );

  if (conversations.isPending || commitments.isPending || receipts.isPending) {
    return <p className="p-6 text-sm text-muted-foreground">Reading stored meetings…</p>;
  }
  if (conversations.isError || commitments.isError) {
    return (
      <p className="p-6 text-sm text-destructive">
        Couldn’t read stored meetings. Nothing is shown rather than a guess.
      </p>
    );
  }

  return (
    <>
      <WorkroomView
        embedded
        meetings={linkedMeetings}
        {...(selection ? { selection } : {})}
        {...(onSelect ? { onSelect } : {})}
        taskById={taskById}
        mayEditTask={(task) => mayEditBoardTask(task, actor)}
        onEditTaskField={(row, field) => {
          const task = row.boardTask;
          if (!task || !mayEditBoardTask(task, actor)) return;
          setEditing({ task, field });
        }}
        onAddRequiredTask={
          mayAddRequiredWork(identity)
            ? async (draft) => {
                await cmdTasks.createRequired(identity, draft);
                await queryClient.invalidateQueries({
                  queryKey: businessWorkQuery(org, identity.userId).queryKey,
                });
              }
            : undefined
        }
        linkedRead={{
          state: business.isPending ? "loading" : business.isError ? "error" : "ready",
          truncated: business.data?.truncated ?? false,
          onRetry: () => void business.refetch(),
        }}
        commitmentFor={commitmentById}
        receiptsFailed={receipts.isError}
        sync={sync}
        historyFor={(commitmentId) => (
          <TaskHistory
            key={`${org}:${identity.userId}:${commitmentId}`}
            organizationId={org}
            userId={identity.userId}
            commitmentId={commitmentId}
          />
        )}
        headerMenu={
          <WorkroomMoreMenu>
            {(
              [
                ["/", "Suite home"],
                ["/modules/steward/team", "Team"],
                ["/modules/steward/tasks", "All outstanding work"],
                ["/modules/steward/board", "Business task board"],
                ["/modules/steward/agents", "Agents"],
                ["/modules/steward/scouts", "Scouts"],
                ["/modules/steward/ai", "Trust Tai AI"],
                ["/modules/steward/timeline", "Timeline"],
                ["/modules/steward/memory", "Memory"],
              ] as const
            ).map(([to, label]) => (
              <Link
                key={to}
                to={to}
                className="block rounded px-3 py-2 text-sm text-foreground hover:bg-secondary"
              >
                {label}
              </Link>
            ))}
          </WorkroomMoreMenu>
        }
        accountSlot={null}
      />
      {editing ? (
        <TaskEditor
          key={`${editing.task.id}:${editing.task.revision}`}
          task={editing.task}
          scope="business"
          identity={identity}
          tasks={business.data?.tasks ?? []}
          people={choices.data?.people ?? []}
          meetingOptions={meetingRead.data?.meetings ?? []}
          meetingsLoading={meetingRead.isPending}
          meetingsError={meetingRead.isError}
          meetingsTruncated={meetingRead.data?.truncated ?? false}
          focusField={editing.field}
          onClose={() => setEditing(null)}
          onSave={saveEdit}
        />
      ) : null}
    </>
  );
}
