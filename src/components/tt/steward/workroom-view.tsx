/**
 * Presentational Steward meeting workroom — the approved three-column
 * layout. Pure rendering and local UI state only: every row, receipt and
 * sync status arrives as props, so the same view serves the real route and
 * an isolated test harness with fictional data.
 *
 * Green means verified: status kept AND a valid completion receipt. The
 * score is verified agreed work against confirmed promises; it never claims
 * transcript extraction is complete, and never reaches 100 while coverage
 * is unconfirmed or proposals await review.
 */

import { Link } from "@tanstack/react-router";
import {
  AlertCircle,
  CalendarDays,
  Check,
  ChevronRight,
  Circle,
  CircleDashed,
  ExternalLink,
  Flag,
  History,
  List,
  LockKeyhole,
  MoreHorizontal,
  RotateCw,
  Search,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { BrandLogo } from "@/components/tt/brand-logo";
import { TTButton } from "@/components/tt/primitives";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Commitment } from "@/domain/steward";
import type { WorkroomMeeting, WorkroomRow } from "@/domain/steward-workroom";
import { cn } from "@/lib/utils";

type RowFilter = "all" | "open" | "verified";

export interface WorkroomSyncState {
  running: boolean;
  failure: string | null;
  /** Last fully successful check; retained across later failures. */
  lastSuccessAt: string | null;
  added: number;
  refreshed: number;
  pendingTranscript: number;
  hasMore: boolean;
  onRetry: () => void;
}

export interface WorkroomViewProps {
  meetings: WorkroomMeeting[];
  commitmentFor: (id: string) => Commitment | undefined;
  /** Receipts could not be read — verified counts would be a guess. */
  receiptsFailed: boolean;
  sync: WorkroomSyncState;
  /** Compact header navigation (suite rooms, account). */
  headerMenu: ReactNode;
  accountSlot: ReactNode;
}

function useCompact(): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1279px)");
    const sync = () => setCompact(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return compact;
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
        <AlertCircle aria-hidden className="size-3" /> Needs verification
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs text-muted-foreground">
      <CircleDashed aria-hidden className="size-3" /> {row.status}
    </span>
  );
}

/* ---------------------------------------------------------- score card */

function ScoreCard({
  meeting,
  receiptsFailed,
}: {
  meeting: WorkroomMeeting;
  receiptsFailed: boolean;
}) {
  /* When receipts could not be read, a numeric score would be computed from
     an empty map — a definitive-looking lie. Show it as unavailable. */
  const value = receiptsFailed ? null : meeting.score;
  const full = value === 100;
  return (
    <div
      aria-label="Verified agreed work"
      className={cn(
        "w-[108px] rounded-lg border border-border bg-cloud p-2 sm:w-[280px] sm:p-3",
        full ? "text-success" : "text-warning",
      )}
    >
      <div className="flex items-center gap-3">
        <svg
          className="hidden size-11 shrink-0 -rotate-90 sm:block"
          viewBox="0 0 48 48"
          aria-hidden="true"
        >
          <circle
            cx="24"
            cy="24"
            r="19"
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            className="text-border"
          />
          <circle
            cx="24"
            cy="24"
            r="19"
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            strokeLinecap="round"
            pathLength="100"
            strokeDasharray={`${value ?? 0} 100`}
          />
        </svg>
        <div>
          <p className="text-xl font-semibold sm:text-2xl">
            {value === null ? "—/100" : `${value}/100`}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground sm:text-xs">
            {receiptsFailed
              ? "Verification unavailable — receipts could not be read"
              : value === null
                ? "Nothing confirmed yet"
                : `${meeting.done} of ${meeting.agreed} agreed tasks verified`}
          </p>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <svg
          viewBox="0 0 100 8"
          preserveAspectRatio="none"
          className="h-2 w-full rounded-full"
          aria-hidden="true"
        >
          <rect width="100" height="8" rx="4" fill="currentColor" className="text-border" />
          <rect width={value ?? 0} height="8" rx="4" fill="currentColor" />
        </svg>
        <span className="text-[10px] text-muted-foreground">
          {value === null ? "Unknown" : `${value}%`}
        </span>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Verified agreed work. Transcript coverage:{" "}
        {meeting.coverage === "complete" ? "confirmed" : "not confirmed"}.
      </p>
    </div>
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

      {/* AI help comes first: it prepares the person's review, and never
          completes, assigns or sends anything itself. */}
      <div className="rounded-lg border border-royal/25 bg-royal/5 p-3">
        <p className="flex items-center gap-1.5 font-medium text-foreground">
          <Sparkles aria-hidden className="size-3.5 text-royal" /> AI help
        </p>
        <p className="mt-2 text-[13px] text-muted-foreground">
          Steward can read this meeting for meaning and prepare a review. It never completes,
          assigns or sends anything on its own.
        </p>
        <TTButton asChild variant="secondary" className="mt-3">
          <Link to="/modules/steward/meetings/$conversationId" params={{ conversationId: meeting.id }}>
            Prepare review
          </Link>
        </TTButton>
      </div>

      <div className="border-t border-border pt-4">
        <p className="flex items-center gap-1.5 font-medium text-foreground">
          <Check aria-hidden className="size-3.5" /> Completion evidence
        </p>
        {row.receipt ? (
          <div className="mt-2 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-[13px]">
            <p className="text-foreground">“{row.receipt.completionNote}”</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Recorded by {row.receipt.completedBy ?? "a teammate"} ·{" "}
              {row.receipt.completedAt?.slice(0, 16).replace("T", " ")}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-[13px] text-muted-foreground">
            {row.kept
              ? "Marked kept, but no completion receipt with a note is recorded — it does not count as verified yet."
              : "No completion recorded."}
          </p>
        )}
      </div>

      <details className="border-t border-border pt-4">
        <summary className="flex cursor-pointer items-center gap-1.5 font-medium text-foreground">
          <Flag aria-hidden className="size-3.5" /> Meeting source
        </summary>
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
          Source quotations are what was said, not proof of completion.
        </p>
      </details>

      <details className="border-t border-border pt-4">
        <summary className="flex cursor-pointer items-center gap-1.5 font-medium text-foreground">
          <History aria-hidden className="size-3.5" /> History
        </summary>
        <p className="mt-2 text-[13px] text-muted-foreground">
          {row.receipt
            ? "The completion receipt above is the recorded event. Earlier history is unavailable in this view."
            : "History unavailable in this view."}
        </p>
      </details>

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

/* ---------------------------------------------------------- view */

export function WorkroomView({
  meetings,
  commitmentFor,
  receiptsFailed,
  sync,
  headerMenu,
  accountSlot,
}: WorkroomViewProps) {
  const compact = useCompact();
  const [selectedMeeting, setSelectedMeeting] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<string | null>(null);
  const [meetingQuery, setMeetingQuery] = useState("");
  const [taskQuery, setTaskQuery] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("everyone");
  const [rowFilter, setRowFilter] = useState<RowFilter>("all");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

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

  /* Default to the first available task so the detail panel is never blank. */
  const row =
    meeting?.rows.find((r) => r.id === selectedRow) ?? visibleRows[0] ?? meeting?.rows[0] ?? null;
  const rowCommitment = row ? commitmentFor(row.id) : undefined;

  function selectMeeting(id: string) {
    setSelectedMeeting(id);
    /* Filters belong to a meeting; a stale owner or search must never hide
       the next meeting's tasks. */
    setSelectedRow(null);
    setOwnerFilter("everyone");
    setTaskQuery("");
    setRowFilter("all");
    setNavOpen(false);
  }

  function pickRow(id: string) {
    setSelectedRow(id);
    if (compact) setDrawerOpen(true);
  }

  const syncLine = sync.running
    ? "Checking Fathom for recent calls…"
    : sync.failure
      ? `Not refreshed. ${sync.failure}`
      : sync.lastSuccessAt
        ? `Checked ${sync.lastSuccessAt.slice(11, 16)} · ${sync.added} new stored${
            sync.refreshed > 0 ? ` · ${sync.refreshed} transcript updated` : ""
          }${
            sync.pendingTranscript > 0
              ? ` · ${sync.pendingTranscript} waiting for a transcript`
              : ""
          }${sync.hasMore ? " · recent window only — older calls exist beyond this pull" : ""}`
        : "Steward pulls recent Fathom calls while this page is open. A closed browser syncs nothing.";

  const navigation = (
    <div className="flex h-full flex-col">
      <h2 className="px-4 pt-5 text-lg font-semibold">Meetings</h2>
      <label className="mx-4 mt-3 flex h-11 items-center gap-2 rounded-md border border-border bg-card/50 px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          aria-label="Search meetings"
          placeholder="Search meetings…"
          value={meetingQuery}
          onChange={(e) => setMeetingQuery(e.target.value)}
          className="w-full min-w-0 bg-transparent text-sm outline-none"
        />
      </label>
      <nav aria-label="Stored meetings" className="mt-3 min-h-0 flex-1 overflow-y-auto">
        {filteredMeetings.map((m) => (
          <TTButton
            key={m.id}
            variant="quiet"
            aria-pressed={meeting?.id === m.id}
            onClick={() => selectMeeting(m.id)}
            className={cn(
              "grid h-auto min-h-[72px] w-full grid-cols-[20px_minmax(0,1fr)] items-start gap-3 rounded-none border-l-2 px-4 py-3 text-left",
              meeting?.id === m.id
                ? "border-l-royal bg-secondary text-foreground"
                : "border-l-transparent",
            )}
          >
            <CalendarDays className={cn("mt-1", meeting?.id === m.id && "text-royal")} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold leading-5">{m.title}</span>
              <span className="mt-1 flex items-center justify-between gap-1 text-xs text-muted-foreground">
                <span>
                  {m.occurredAt.slice(0, 10)} ·{" "}
                  {receiptsFailed ? "verification unavailable" : `${m.done} of ${m.agreed} verified`}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded px-1.5 py-0.5 font-semibold",
                    m.score === 100 && !receiptsFailed
                      ? "bg-success/15 text-success"
                      : "bg-warning/15 text-warning",
                  )}
                >
                  {receiptsFailed ? "—" : m.score === null ? "Partial" : `${m.score}/100`}
                </span>
              </span>
            </span>
          </TTButton>
        ))}
        {filteredMeetings.length === 0 ? (
          <p role="status" className="px-4 py-5 text-sm text-muted-foreground">
            No meetings match.
          </p>
        ) : null}
        <Link
          to="/modules/steward/tasks"
          className="mt-2 flex min-h-12 items-center gap-3 px-4 text-sm text-foreground hover:bg-card/60"
        >
          <List aria-hidden className="size-4" />
          All outstanding work
        </Link>
      </nav>
      <div className="mx-4 border-t border-border py-4 text-xs text-muted-foreground">
        <p className="flex items-center gap-2">
          <LockKeyhole aria-hidden className="size-4" />
          Completion is recorded only on the meeting review page.
        </p>
      </div>
    </div>
  );

  const main = meeting ? (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold leading-8 sm:text-2xl">{meeting.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              {meeting.occurredAt.slice(0, 10)} · {meeting.participantCount} participants ·{" "}
              {meeting.segmentCount} transcript segments
              {meeting.lastSegmentAt ? ` to ${meeting.lastSegmentAt}` : ""}
            </span>
            {meeting.sourceUrl ? (
              <a
                href={meeting.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-royal"
              >
                <CalendarDays aria-hidden className="size-3.5" /> View meeting
              </a>
            ) : null}
          </div>
        </div>
        <ScoreCard meeting={meeting} receiptsFailed={receiptsFailed} />
      </div>

      {meeting.openProposals > 0 ? (
        <Link
          to="/modules/steward/meetings/$conversationId"
          params={{ conversationId: meeting.id }}
          className="mt-3 flex h-11 w-full items-center justify-between rounded-md border border-warning/15 bg-warning/5 px-3 text-xs text-warning"
        >
          <span className="flex items-center gap-2">
            <AlertCircle aria-hidden className="size-4" />
            {meeting.openProposals} unreviewed extracted passage
            {meeting.openProposals === 1 ? "" : "s"} — not counted until a person confirms
          </span>
          <ChevronRight aria-hidden className="size-4" />
        </Link>
      ) : null}

      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2 border-b border-border pb-2">
        <div
          className="flex w-full min-w-0 max-w-full overflow-x-auto xl:w-auto"
          aria-label="Task filters"
        >
          {(
            [
              ["all", `All tasks ${meeting.rows.length}`],
              ["open", `Open ${meeting.rows.filter((r) => !r.verified).length}`],
              ["verified", `Verified ${meeting.done}`],
            ] as [RowFilter, string][]
          ).map(([value, label]) => (
            <TTButton
              key={value}
              variant="quiet"
              aria-pressed={rowFilter === value}
              className={cn(
                "h-9 shrink-0 rounded-md px-2.5 text-xs",
                rowFilter === value && "bg-secondary text-royal",
              )}
              onClick={() => setRowFilter(value)}
            >
              {label}
            </TTButton>
          ))}
        </div>
        <div className="flex w-full min-w-0 gap-2 xl:w-auto xl:flex-1">
          <label className="flex h-9 min-w-[110px] flex-1 items-center gap-2 rounded-md border border-input px-2">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              aria-label="Search tasks"
              placeholder="Search tasks…"
              value={taskQuery}
              onChange={(e) => setTaskQuery(e.target.value)}
              className="w-full min-w-0 bg-transparent text-xs outline-none"
            />
          </label>
          <select
            aria-label="Filter by owner"
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            className="h-9 w-[104px] shrink-0 rounded-md border border-input bg-card px-2 text-xs"
          >
            <option value="everyone">Everyone</option>
            {owners.map((owner) => (
              <option key={owner} value={owner}>
                {owner}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="hidden grid-cols-[minmax(0,1fr)_116px_104px_92px] gap-2 border-b border-border px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground sm:grid">
        <span>Task</span>
        <span>Owner</span>
        <span>Due</span>
        <span>Status</span>
      </div>
      <div aria-label="Meeting tasks">
        {visibleRows.map((r) => (
          <button
            key={r.id}
            type="button"
            aria-pressed={row?.id === r.id}
            onClick={() => pickRow(r.id)}
            className={cn(
              "grid min-h-11 w-full grid-cols-[20px_minmax(0,1fr)] items-center gap-2 border-b border-border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal sm:grid-cols-[20px_minmax(0,1fr)_116px_104px_92px]",
              r.verified
                ? "bg-success/10"
                : row?.id === r.id
                  ? "bg-secondary"
                  : "hover:bg-secondary/40",
            )}
          >
            <span className="inline-flex">
              {r.verified ? (
                <Check aria-hidden className="size-4 text-success" />
              ) : (
                <Circle aria-hidden className="size-4 text-muted-foreground" />
              )}
            </span>
            <span className="min-w-0">
              <span
                className={cn(
                  "block truncate",
                  r.verified ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {r.what}
              </span>
              <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground sm:hidden">
                <span className="truncate">{r.owner.label}</span>
                <span aria-hidden>·</span>
                <span className="shrink-0">{r.due.label}</span>
              </span>
            </span>
            <span className="hidden truncate text-[13px] sm:block">{r.owner.label}</span>
            <span className="hidden truncate text-[13px] sm:block">{r.due.label}</span>
            <span className="col-start-2 sm:col-start-auto">
              <StatusPill row={r} />
            </span>
          </button>
        ))}
        {visibleRows.length === 0 ? (
          <div role="status" className="py-10 text-center">
            <p className="font-medium">
              {meeting.rows.length === 0
                ? "No promises confirmed from this meeting yet."
                : "No tasks match this view."}
            </p>
            {meeting.rows.length > 0 ? (
              <TTButton
                variant="quiet"
                className="mt-2 text-royal"
                onClick={() => {
                  setTaskQuery("");
                  setOwnerFilter("everyone");
                  setRowFilter("all");
                }}
              >
                View all tasks
              </TTButton>
            ) : null}
          </div>
        ) : null}
      </div>

      <footer
        aria-label="Requirements for complete meeting work"
        className={cn(
          "mt-4 flex items-start gap-3 rounded-lg border border-l-2 p-3 text-xs leading-5",
          meeting.score === 100
            ? "border-success/20 border-l-success bg-success/5"
            : "border-warning/15 border-l-warning bg-warning/5",
        )}
      >
        <AlertCircle
          className={cn(
            "mt-0.5 size-5 shrink-0",
            meeting.score === 100 ? "text-success" : "text-warning",
          )}
        />
        <div>
          <p className="text-sm font-semibold">
            {meeting.score === 100 ? "All agreed work verified" : "To reach 100/100"}
          </p>
          <p className="mt-1 text-muted-foreground">{meeting.remark}</p>
          {meeting.score !== 100 ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              100 requires every confirmed promise verified, transcript coverage confirmed, and no
              unreviewed proposals. Work completion, not a grade for people.
            </p>
          ) : null}
        </div>
      </footer>
    </>
  ) : (
    <div className="flex flex-col items-start gap-3 p-2">
      <h2 className="text-xl font-semibold sm:text-2xl">No meeting stored yet</h2>
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
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-card text-foreground [&_h1]:tracking-normal [&_h2]:tracking-normal [&_h3]:tracking-normal">
      <header className="grid h-14 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center border-b border-border bg-cloud px-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-4">
          <Link to="/" aria-label="Trust Tai OS home" className="flex items-center gap-4">
            <BrandLogo height={22} />
          </Link>
          <span className="hidden text-xs font-semibold text-muted-foreground sm:block">OS</span>
          <span className="hidden h-14 border-r border-border sm:block" />
          <span className="hidden text-sm text-muted-foreground sm:block">Suite</span>
          <ChevronRight aria-hidden className="hidden size-4 text-muted-foreground sm:block" />
          <h1 className="hidden text-sm font-semibold sm:block">Steward</h1>
        </div>
        <div className="flex items-center gap-2">
          {headerMenu}
          {accountSlot}
        </div>
      </header>

      <p
        aria-live="polite"
        className="flex items-center gap-2 border-b border-border px-4 py-1.5 text-xs text-muted-foreground"
      >
        <span className="min-w-0 flex-1 truncate">{syncLine}</span>
        {sync.failure ? (
          <TTButton
            variant="quiet"
            className="h-7 shrink-0 rounded-md px-2 text-xs text-royal"
            onClick={sync.onRetry}
          >
            <RotateCw aria-hidden className="size-3.5" /> Retry
          </TTButton>
        ) : null}
      </p>

      {receiptsFailed ? (
        <p
          role="alert"
          className="border-b border-border bg-destructive/10 px-4 py-1.5 text-xs text-destructive"
        >
          Completion receipts could not be read, so nothing is shown as verified rather than
          guessing.
        </p>
      ) : null}

      <div
        className={cn(
          "grid min-h-0 flex-1 min-w-0 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[18%_56%_26%]",
          !row && "xl:grid-cols-[18%_82%]",
        )}
      >
        <aside className="hidden border-r border-border bg-cloud lg:block">{navigation}</aside>
        <main className="min-w-0 px-4 pb-5 pt-4 sm:px-6 sm:pt-5">
          <TTButton
            variant="quiet"
            className="mb-2 h-11 rounded-md px-0 text-royal lg:hidden"
            onClick={() => setNavOpen(true)}
          >
            <List aria-hidden />
            Meetings
            <ChevronRight aria-hidden />
          </TTButton>
          {main}
        </main>
        {row && meeting ? (
          <aside
            aria-label="Selected task details"
            className="hidden min-w-0 overflow-y-auto border-l border-border p-6 xl:block"
          >
            <TaskDetail meeting={meeting} row={row} commitment={rowCommitment} />
          </aside>
        ) : null}
      </div>

      {/* Compact breakpoints only: meetings and task detail open as drawers.
          The desktop never mounts these, so focus is never trapped. */}
      {compact ? (
        <>
          <Sheet open={navOpen} onOpenChange={setNavOpen}>
            <SheetContent side="left" className="w-[300px] bg-cloud p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>Meetings</SheetTitle>
                <SheetDescription>Choose a stored meeting to see its agreed work.</SheetDescription>
              </SheetHeader>
              {navigation}
            </SheetContent>
          </Sheet>
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
              <SheetHeader className="sr-only">
                <SheetTitle>Task detail</SheetTitle>
                <SheetDescription>
                  Source evidence, completion evidence and next step for the selected task.
                </SheetDescription>
              </SheetHeader>
              {row && meeting ? (
                <TaskDetail meeting={meeting} row={row} commitment={rowCommitment} />
              ) : null}
            </SheetContent>
          </Sheet>
        </>
      ) : null}
    </div>
  );
}

/** Compact header overflow menu for the live route. */
export function WorkroomMoreMenu({ children }: { children: ReactNode }) {
  return (
    <details className="relative">
      <summary
        aria-label="More Steward pages"
        className="flex size-11 cursor-pointer list-none items-center justify-center rounded-md text-muted-foreground hover:bg-secondary [&::-webkit-details-marker]:hidden"
      >
        <MoreHorizontal aria-hidden className="size-5" />
      </summary>
      <div className="absolute right-0 top-12 z-50 w-56 rounded-md border border-border bg-card p-1 shadow-md">
        {children}
      </div>
    </details>
  );
}
