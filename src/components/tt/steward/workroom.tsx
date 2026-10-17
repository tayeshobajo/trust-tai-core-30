/**
 * Steward's meeting workroom on real data.
 *
 * The approved three-column layout: a cloud rail of stored meetings, a white
 * task table in the middle, and a white detail panel on the right. Every row
 * is a person-confirmed commitment; nothing here invents an owner, a date or
 * a completion. Green means verified: status kept AND a current completion
 * receipt. Kept without a receipt says so. Confirming and completing happen
 * on the existing meeting review page, behind its gates — this room writes
 * nothing itself.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CircleDashed,
  ExternalLink,
  Flag,
  Lock,
  Search,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { TTInput } from "@/components/tt/primitives";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { syncRecentMeetings } from "@/data/steward/recent-sync";
import { stewardService } from "@/data/supabase/steward-service";
import { stewardTaskState } from "@/data/supabase/steward-task-state";
import { extractProposals } from "@/data/steward/extract";
import {
  buildWorkroom,
  receiptKey,
  type WorkroomMeeting,
  type WorkroomRow,
} from "@/domain/steward-workroom";
import type { Commitment } from "@/domain/steward";
import { cn } from "@/lib/utils";
import type { WorkspaceIdentity } from "@/lib/workspace";

const SYNC_INTERVAL_MS = 5 * 60 * 1000;

type RowFilter = "all" | "open" | "verified";

/* ---------------------------------------------------------- auto sync */

function useRecentSync(identity: WorkspaceIdentity, storedCount: number) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<{
    checkedAt: string | null;
    added: number;
    pendingTranscript: number;
    hasMore: boolean;
    failure: string | null;
    running: boolean;
  }>({
    checkedAt: null,
    added: 0,
    pendingTranscript: 0,
    hasMore: false,
    failure: null,
    running: false,
  });
  const storedRef = useRef(storedCount);
  storedRef.current = storedCount;

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setState((s) => ({ ...s, running: true, failure: null }));
      try {
        const stored = await stewardService.conversations(identity.organizationId, 100);
        const outcome = await syncRecentMeetings({
          organizationId: identity.organizationId,
          userId: identity.userId,
          stored,
        });
        if (cancelled) return;
        setState({
          checkedAt: outcome.checkedAt,
          added: outcome.added,
          pendingTranscript: outcome.pendingTranscript,
          hasMore: outcome.hasMore,
          failure: outcome.errors.length > 0 ? outcome.errors.join(" ") : null,
          running: false,
        });
        if (outcome.added > 0) {
          await queryClient.invalidateQueries({
            queryKey: ["steward", "workroom", "conversations", identity.organizationId],
          });
        }
      } catch (error) {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          running: false,
          failure: error instanceof Error ? error.message : "Could not check for recent calls.",
        }));
      }
    }

    void run();
    const onFocus = () => void run();
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(onFocus, SYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
    };
  }, [identity.organizationId, identity.userId, queryClient]);

  return state;
}

/* ---------------------------------------------------------- score card */

function ScoreCard({ meeting }: { meeting: WorkroomMeeting }) {
  const value = meeting.score;
  const pct = value ?? (meeting.agreed > 0 ? Math.round((meeting.done / meeting.agreed) * 100) : 0);
  const full = value === 100;
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border px-4 py-3",
        full ? "border-success/40 bg-success/10" : "border-warning/40 bg-warning/10",
      )}
    >
      <svg viewBox="0 0 36 36" className="size-10" aria-hidden>
        <circle cx="18" cy="18" r="15.5" fill="none" className="stroke-border" strokeWidth="4" />
        <circle
          cx="18"
          cy="18"
          r="15.5"
          fill="none"
          className={full ? "stroke-success" : "stroke-warning"}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * 97.4} 97.4`}
          transform="rotate(-90 18 18)"
        />
      </svg>
      <div>
        <p className={cn("text-xl font-semibold", full ? "text-success" : "text-foreground")}>
          {value === null ? `${meeting.done}/${meeting.agreed}` : `${value}/100`}
        </p>
        <p className="text-xs text-muted-foreground">
          {value === null
            ? "Coverage not confirmed — no score"
            : `${meeting.done} of ${meeting.agreed} agreed tasks verified`}
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- status pill */

function StatusPill({ row }: { row: WorkroomRow }) {
  if (row.verified) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-medium text-success">
        <Check aria-hidden className="size-3" /> Verified
      </span>
    );
  }
  if (row.kept) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-medium text-warning">
        <AlertTriangle aria-hidden className="size-3" /> Needs verification
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs text-muted-foreground">
      <CircleDashed aria-hidden className="size-3" /> {row.status}
    </span>
  );
}

/* ---------------------------------------------------------- detail panel */

function TaskDetail({
  meeting,
  row,
  commitment,
}: {
  meeting: WorkroomMeeting;
  row: WorkroomRow;
  commitment: Commitment | undefined;
}) {
  return (
    <div className="space-y-5 text-sm">
      <div>
        <h2 className="text-base font-semibold text-foreground">{row.what}</h2>
        <p className="mt-2 text-muted-foreground">
          Owner: {row.owner.label}
          {row.owner.verified ? "" : " · not linked to a teammate"}
        </p>
        <p className="text-muted-foreground">
          Due: {row.due.label}
          {row.due.exact ? "" : " · not an exact date"}
        </p>
      </div>

      <div className="border-t border-border pt-4">
        <p className="flex items-center gap-1.5 font-medium text-foreground">
          <Flag aria-hidden className="size-3.5" /> Source evidence
        </p>
        {commitment && commitment.evidence.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {commitment.evidence.map((ref, index) => (
              <li
                key={index}
                className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-[13px] text-muted-foreground"
              >
                “{ref.label}”
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[13px] text-muted-foreground">
            No source quotation was stored with this promise.
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Source quotations are what was said, not proof of completion. Completion receipts live
          with the task record.
        </p>
      </div>

      <div className="border-t border-border pt-4">
        <p className="flex items-center gap-1.5 font-medium text-foreground">
          <Sparkles aria-hidden className="size-3.5" /> AI help
        </p>
        <p className="mt-2 text-[13px] text-muted-foreground">
          Steward can read this meeting for meaning and prepare a review. It never completes,
          assigns or sends anything on its own.
        </p>
        <Link
          to="/modules/steward/meetings/$conversationId"
          params={{ conversationId: meeting.id }}
          className="mt-2 inline-block text-primary underline underline-offset-4"
        >
          Read this meeting for meaning
        </Link>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <Link
          to="/modules/steward/meetings/$conversationId"
          params={{ conversationId: meeting.id }}
          className="text-primary underline underline-offset-4"
        >
          Review, confirm and record completion in the meeting page
        </Link>
        {meeting.sourceUrl ? (
          <a
            href={meeting.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary underline underline-offset-4"
          >
            Open in Fathom <ExternalLink aria-hidden className="size-3.5" />
          </a>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- workroom */

export function StewardWorkroom({ identity }: { identity: WorkspaceIdentity }) {
  const org = identity.organizationId;
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

  const sync = useRecentSync(identity, conversations.data?.length ?? 0);

  const [selectedMeeting, setSelectedMeeting] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<string | null>(null);
  const [meetingQuery, setMeetingQuery] = useState("");
  const [taskQuery, setTaskQuery] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("everyone");
  const [rowFilter, setRowFilter] = useState<RowFilter>("all");
  const [drawerOpen, setDrawerOpen] = useState(false);

  const receiptKeys = useMemo(
    () => new Set((receipts.data ?? []).filter((r) => r.completedAt).map((r) => r.taskKey)),
    [receipts.data],
  );

  const meetings = useMemo<WorkroomMeeting[]>(() => {
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
          };
        }),
      commitments.data,
      receiptKeys,
    );
  }, [conversations.data, commitments.data, receiptKeys]);

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

  const filteredMeetings = meetings.filter((m) =>
    m.title.toLowerCase().includes(meetingQuery.trim().toLowerCase()),
  );
  const meeting = meetings.find((m) => m.id === selectedMeeting) ?? meetings[0] ?? null;

  const owners = meeting ? Array.from(new Set(meeting.rows.map((r) => r.owner.label))).sort() : [];
  const visibleRows = meeting
    ? meeting.rows.filter((r) => {
        if (rowFilter === "open" && r.verified) return false;
        if (rowFilter === "verified" && !r.verified) return false;
        if (ownerFilter !== "everyone" && r.owner.label !== ownerFilter) return false;
        if (taskQuery.trim() && !r.what.toLowerCase().includes(taskQuery.trim().toLowerCase()))
          return false;
        return true;
      })
    : [];

  const row = meeting?.rows.find((r) => r.id === selectedRow) ?? null;
  const rowCommitment = (commitments.data ?? []).find((c) => c.id === row?.id);
  const proposalCount = meeting ? (proposalCounts.get(meeting.id) ?? 0) : 0;

  function pickRow(id: string) {
    setSelectedRow(id);
    setDrawerOpen(true);
  }

  const rail = (
    <nav
      aria-label="Meetings"
      className="flex h-full flex-col rounded-lg border border-border bg-secondary/40 p-2"
    >
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <TTInput
          value={meetingQuery}
          onChange={(e) => setMeetingQuery(e.target.value)}
          placeholder="Search meetings…"
          aria-label="Search meetings"
          className="h-9 pl-8 text-sm"
        />
      </div>
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {filteredMeetings.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => {
                setSelectedMeeting(m.id);
                setSelectedRow(null);
              }}
              aria-current={meeting?.id === m.id}
              className={cn(
                "w-full rounded-md px-3 py-2 text-left text-sm transition-colors",
                meeting?.id === m.id ? "bg-card font-semibold shadow-sm" : "hover:bg-card/60",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate">{m.title}</span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[10px]",
                    m.score === 100
                      ? "bg-success/15 text-success"
                      : m.coverage === "complete"
                        ? "bg-warning/15 text-warning"
                        : "bg-secondary text-muted-foreground",
                  )}
                >
                  {m.score === null ? `${m.done}/${m.agreed}` : `${m.score}/100`}
                </span>
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {m.occurredAt.slice(0, 10)} · {m.done} of {m.agreed} verified
                {m.coverage !== "complete" ? " · coverage unconfirmed" : ""}
              </span>
            </button>
          </li>
        ))}
        {filteredMeetings.length === 0 ? (
          <li className="px-3 py-4 text-xs text-muted-foreground">No meeting matches.</li>
        ) : null}
      </ul>
    </nav>
  );

  const main = meeting ? (
    <section className="flex min-w-0 flex-col rounded-lg border border-border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl text-foreground">{meeting.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span>{meeting.occurredAt.slice(0, 10)}</span>
            <span aria-hidden>·</span>
            <span>{meeting.participantCount} participants</span>
            <span aria-hidden>·</span>
            <span>
              {meeting.segmentCount} transcript segments
              {meeting.lastSegmentAt ? ` to ${meeting.lastSegmentAt}` : ""}
            </span>
            {meeting.sourceUrl ? (
              <>
                <span aria-hidden>·</span>
                <a
                  href={meeting.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary underline underline-offset-4"
                >
                  <CalendarDays aria-hidden className="size-3" /> View meeting
                </a>
              </>
            ) : null}
          </p>
        </div>
        <ScoreCard meeting={meeting} />
      </header>

      {proposalCount > 0 ? (
        <Link
          to="/modules/steward/meetings/$conversationId"
          params={{ conversationId: meeting.id }}
          className="flex items-center gap-2 border-b border-border bg-warning/10 px-4 py-2.5 text-sm text-foreground hover:bg-warning/15"
        >
          <AlertTriangle aria-hidden className="size-4 text-warning" />
          <span className="font-medium">
            {proposalCount} proposed task{proposalCount === 1 ? "" : "s"} need
            {proposalCount === 1 ? "s" : ""} review
          </span>
          <span className="ml-auto text-xs text-muted-foreground">
            Proposals are not counted until a person confirms them →
          </span>
        </Link>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="flex gap-1">
          {(
            [
              ["all", `All tasks ${meeting.rows.length}`],
              ["open", `Open ${meeting.rows.filter((r) => !r.verified).length}`],
              ["verified", `Verified ${meeting.done}`],
            ] as [RowFilter, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setRowFilter(value)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs transition-colors",
                rowFilter === value
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto min-w-[160px] flex-1 sm:max-w-[220px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <TTInput
            value={taskQuery}
            onChange={(e) => setTaskQuery(e.target.value)}
            placeholder="Search tasks…"
            aria-label="Search tasks"
            className="h-8 pl-8 text-sm"
          />
        </div>
        <select
          aria-label="Filter by owner"
          value={ownerFilter}
          onChange={(e) => setOwnerFilter(e.target.value)}
          className="h-8 rounded-md border border-border bg-card px-2 text-sm text-foreground"
        >
          <option value="everyone">Everyone</option>
          {owners.map((owner) => (
            <option key={owner} value={owner}>
              {owner}
            </option>
          ))}
        </select>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card text-left text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Task</th>
              <th className="px-2 py-2 font-medium">Owner</th>
              <th className="px-2 py-2 font-medium">Due</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r) => (
              <tr
                key={r.id}
                onClick={() => pickRow(r.id)}
                aria-selected={row?.id === r.id}
                className={cn(
                  "h-11 cursor-pointer border-t border-border",
                  r.verified
                    ? "bg-success/10"
                    : row?.id === r.id
                      ? "bg-primary/5"
                      : "hover:bg-secondary/40",
                )}
              >
                <td className="max-w-0 truncate px-4 py-2">
                  <span className="mr-2 inline-flex align-middle">
                    {r.verified ? (
                      <Check aria-hidden className="size-4 text-success" />
                    ) : (
                      <CircleDashed aria-hidden className="size-4 text-muted-foreground" />
                    )}
                  </span>
                  <span className={r.verified ? "text-muted-foreground" : "text-foreground"}>
                    {r.what}
                  </span>
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-[13px]">{r.owner.label}</td>
                <td className="whitespace-nowrap px-2 py-2 text-[13px]">{r.due.label}</td>
                <td className="px-4 py-2">
                  <StatusPill row={r} />
                </td>
              </tr>
            ))}
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {meeting.rows.length === 0
                    ? "No promises confirmed from this meeting yet."
                    : "Nothing matches that view."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <footer className="flex items-start gap-2 border-t border-border bg-warning/5 px-4 py-3 text-sm text-muted-foreground">
        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
        <span>{meeting.remark}</span>
      </footer>
    </section>
  ) : (
    <section className="flex min-w-0 flex-col items-start gap-3 rounded-lg border border-border bg-card p-6">
      <h1 className="font-display text-2xl text-foreground">No meeting stored yet</h1>
      <p className="max-w-reading text-sm text-muted-foreground">
        {sync.running
          ? "Steward is checking the connected Fathom source for recent calls…"
          : sync.failure
            ? `Steward could not pull recent calls. ${sync.failure}`
            : "Steward checks for recent Fathom calls while this page is open. Nothing has been stored yet."}
      </p>
      <Link
        to="/modules/steward/meetings"
        className="text-sm text-primary underline underline-offset-4"
      >
        Read a call by link
      </Link>
    </section>
  );

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <p
        aria-live="polite"
        className="border-b border-border px-4 py-1.5 text-xs text-muted-foreground"
      >
        {sync.running
          ? "Checking Fathom for recent calls…"
          : sync.failure
            ? `Not refreshed. ${sync.failure}`
            : sync.checkedAt
              ? `Checked ${sync.checkedAt.slice(11, 16)} · ${sync.added} new stored${
                  sync.pendingTranscript > 0
                    ? ` · ${sync.pendingTranscript} waiting for a transcript`
                    : ""
                }${sync.hasMore ? " · older calls exist beyond this pull" : ""}`
              : "Steward pulls recent Fathom calls while this page is open."}
      </p>

      {/* Mobile meeting picker */}
      <div className="border-b border-border p-2 lg:hidden">
        <select
          aria-label="Choose meeting"
          value={meeting?.id ?? ""}
          onChange={(e) => {
            setSelectedMeeting(e.target.value);
            setSelectedRow(null);
          }}
          className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm"
        >
          {meetings.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title} · {m.occurredAt.slice(0, 10)}
            </option>
          ))}
        </select>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-[260px_minmax(0,1fr)_320px]">
        <div className="hidden min-h-0 lg:block">{rail}</div>
        <div className="min-h-0">{main}</div>
        <aside className="hidden min-h-0 overflow-y-auto rounded-lg border border-border bg-card p-4 lg:block">
          {row && meeting ? (
            <TaskDetail meeting={meeting} row={row} commitment={rowCommitment} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Select a task to see its source evidence and next step.
            </p>
          )}
        </aside>
      </div>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto lg:hidden">
          <SheetHeader>
            <SheetTitle className="sr-only">Task detail</SheetTitle>
          </SheetHeader>
          {row && meeting ? (
            <TaskDetail meeting={meeting} row={row} commitment={rowCommitment} />
          ) : null}
        </SheetContent>
      </Sheet>

      <span className="sr-only">
        <Lock aria-hidden /> Completion is recorded only on the meeting review page.
      </span>
    </div>
  );
}
