import { useEffect, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronRight,
  Circle,
  Flag,
  LayoutGrid,
  List,
  LockKeyhole,
  MoreHorizontal,
  RotateCcw,
  Search,
  X,
  AlertCircle,
} from "lucide-react";
import { BrandLogo } from "@/components/tt/brand-logo";
import { TTButton } from "@/components/tt/primitives";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PREVIEW_MEETINGS, PREVIEW_WORK } from "@/data/mockups/steward-preview";
import { meetingProgress, previewDependencyState, type PreviewDeliverable } from "@/domain/steward-preview";
import { TaskDetails } from "./task-details";
import { cn } from "@/lib/utils";

type Filter = "all" | "open" | "verified" | "proposed" | "blocked" | "overdue";
function matches(item: PreviewDeliverable, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "open") return item.status === "open" || item.status === "blocked";
  if (filter === "overdue") return item.overdue && item.status === "open";
  return item.status === filter;
}
const FILTERS = [
  { id: "all", label: "All tasks" },
  { id: "open", label: "Open" },
  { id: "verified", label: "Completed" },
  { id: "proposed", label: "Proposed" },
] as const;

export function StewardPreview() {
  const [work, setWork] = useState(() => PREVIEW_WORK.map((i) => ({ ...i })));
  const [selected, setSelected] = useState("example-planning");
  const [view, setView] = useState<"meetings" | "work">("meetings");
  const [filter, setFilter] = useState<Filter>("all");
  const [person, setPerson] = useState("Everyone");
  const [query, setQuery] = useState("");
  const [meetingQuery, setMeetingQuery] = useState("");
  const [detailId, setDetailId] = useState<string | null>("example-copy");
  const [drawer, setDrawer] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1279px)");
    const sync = () => setCompact(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const meeting = PREVIEW_MEETINGS.find((m) => m.id === selected);
  if (!meeting) return null;
  const progress = meetingProgress(meeting, work);
  const scope = work.filter((i) => view === "work" || i.meetingId === selected);
  const proposals = scope.filter((i) => i.status === "proposed").length;
  const buildDependency = previewDependencyState(scope.find((i) => i.id === "example-build"), work);
  const dependencyGuidance = buildDependency === "outstanding"
    ? " Start by approving the copy to unblock the page build."
    : buildDependency === "ready"
      ? " Review and clear the page-build blocker; the copy is verified."
      : "";
  const visible = scope.filter(
    (i) =>
      matches(i, filter) &&
      (person === "Everyone" || (person === "Unassigned" ? !i.owner : i.owner === person)) &&
      i.title.toLowerCase().includes(query.toLowerCase()),
  );
  const detail = work.find((i) => i.id === detailId);
  function update(id: string, change: (i: PreviewDeliverable) => PreviewDeliverable) {
    setWork((current) => current.map((i) => (i.id === id ? change(i) : i)));
  }
  function metadata() {
    return {
      actor: "Alex (fictional)",
      at: new Date(
        Date.UTC(
          2026,
          9,
          17,
          16,
          work.reduce((n, i) => n + (i.history?.length ?? 0), 0),
        ),
      ).toISOString(),
    };
  }
  function selectMeeting(id: string) {
    setSelected(id);
    setView("meetings");
    setFilter("all");
    setPerson("Everyone");
    setQuery("");
    setDetailId(work.find((i) => i.meetingId === id)?.id ?? null);
    setNavOpen(false);
  }
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
      <nav aria-label="Example meetings" className="mt-3">
        {PREVIEW_MEETINGS.filter((m) =>
          m.title.toLowerCase().includes(meetingQuery.toLowerCase()),
        ).map((m) => {
          const p = meetingProgress(m, work);
          return (
            <TTButton
              key={m.id}
              variant="quiet"
              aria-pressed={view === "meetings" && selected === m.id}
              onClick={() => selectMeeting(m.id)}
              className={cn(
                "grid h-auto min-h-[72px] w-full grid-cols-[20px_minmax(0,1fr)] items-start gap-3 rounded-none border-l-2 px-4 py-3 text-left",
                view === "meetings" && selected === m.id
                  ? "border-l-royal bg-secondary text-foreground"
                  : "border-l-transparent",
              )}
            >
              <CalendarDays
                className={cn("mt-1", selected === m.id && view === "meetings" && "text-royal")}
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-5">{m.title}</span>
                <span className="mt-1 flex items-center justify-between gap-1 text-xs text-muted-foreground">
                  <span>
                    {p.complete
                      ? "All work completed"
                      : p.score === null
                        ? "Needs review"
                        : `${m.date} · ${p.verified} of ${p.agreed} completed`}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 font-semibold",
                      p.complete ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
                    )}
                  >
                    {p.score === null ? "Partial" : `${p.score}/100`}
                  </span>
                </span>
              </span>
            </TTButton>
          );
        })}
        {!PREVIEW_MEETINGS.some((m) =>
          m.title.toLowerCase().includes(meetingQuery.toLowerCase()),
        ) && (
          <p role="status" className="px-4 py-5 text-sm text-muted-foreground">
            No meetings match.
          </p>
        )}
        <TTButton
          variant="quiet"
          className={cn(
            "mt-2 h-auto min-h-12 w-full justify-start rounded-none px-4 text-sm",
            view === "work" && "bg-secondary text-royal",
          )}
          onClick={() => {
            setView("work");
            setFilter("open");
            setPerson("Everyone");
            setQuery("");
            setNavOpen(false);
          }}
        >
          <List />
          All outstanding work
        </TTButton>
      </nav>
      <div className="mx-4 mt-auto border-t border-border py-4 text-xs text-muted-foreground">
        <p className="flex items-center gap-3">
          <LayoutGrid className="size-4" />
          Demo workspace
        </p>
        <p className="mt-2">Fictional work · resets on reload</p>
      </div>
    </div>
  );
  return (
    <div className="min-h-screen bg-card text-foreground [&_h1]:tracking-normal [&_h2]:tracking-normal [&_h3]:tracking-normal">
      <header className="grid h-14 grid-cols-[minmax(0,1fr)_auto] items-center border-b border-border bg-cloud px-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-4">
          <BrandLogo height={22} />
          <span className="hidden text-xs font-semibold text-muted-foreground sm:block">OS</span>
          <span className="hidden h-14 border-r border-border sm:block" />
          <span className="hidden text-sm text-muted-foreground sm:block">Suite</span>
          <ChevronRight className="hidden size-4 text-muted-foreground sm:block" />
          <h1 className="hidden text-sm font-semibold sm:block">Steward</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground sm:text-xs">
            Design draft · Sample data
          </span>
          <TTButton
            variant="quiet"
            title="Reset examples"
            aria-label="Reset examples"
            className="size-11 rounded-md p-0"
            onClick={() => {
              setWork(PREVIEW_WORK.map((i) => ({ ...i })));
              setDetailId("example-copy");
            }}
          >
            <RotateCcw />
          </TTButton>
          <span className="hidden size-8 items-center justify-center rounded-full bg-secondary text-xs text-muted-foreground sm:flex">
            JD
          </span>
        </div>
      </header>
      <div
        className={cn(
          "grid min-h-[calc(100vh-56px)] min-w-0 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[18%_56%_26%]",
          !detail && "xl:grid-cols-[18%_82%]",
        )}
      >
        <aside className="hidden border-r border-border bg-cloud lg:block">{navigation}</aside>
        <main className="min-w-0 px-4 pb-5 pt-4 sm:px-6 sm:pt-5">
          <TTButton
            variant="quiet"
            className="mb-2 h-11 rounded-md px-0 text-royal lg:hidden"
            onClick={() => setNavOpen(true)}
          >
            <List />
            Meetings
            <ChevronRight />
          </TTButton>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold leading-8 sm:text-2xl">
                {view === "meetings" ? meeting.title : "All outstanding work"}
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>
                  {view === "meetings"
                    ? `${meeting.date} · ${meeting.time} · ${meeting.people.join(", ")}`
                    : "Agreed work across every meeting"}
                </span>
                {view === "meetings" && (
                  <TTButton
                    variant="quiet"
                    className="h-8 rounded-md px-0 text-xs text-royal"
                    onClick={() => setSourceOpen(true)}
                  >
                    <CalendarDays />
                    View meeting
                  </TTButton>
                )}
              </div>
            </div>
            {view === "meetings" && (
              <div
                aria-label="Meeting work completion"
                className={cn(
                  "w-[108px] rounded-lg border border-border bg-cloud p-2 sm:w-[280px] sm:p-3",
                  progress.complete ? "text-success" : "text-warning",
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
                      strokeDasharray={`${progress.score ?? 0} 100`}
                    />
                  </svg>
                  <div>
                    <p className="text-xl font-semibold sm:text-2xl">
                      {progress.score === null ? "—/100" : `${progress.score}/100`}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground sm:text-xs">
                      {progress.score === null
                        ? "Partial coverage"
                        : `${progress.verified} of ${progress.agreed} agreed tasks verified`}
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
                    <rect
                      width="100"
                      height="8"
                      rx="4"
                      fill="currentColor"
                      className="text-border"
                    />
                    <rect width={progress.score ?? 0} height="8" rx="4" fill="currentColor" />
                  </svg>
                  <span className="text-[10px] text-muted-foreground">
                    {progress.score === null ? "Unknown" : `${progress.score}%`}
                  </span>
                </div>
              </div>
            )}
          </div>
          {proposals > 0 && (
            <TTButton
              variant="quiet"
              className="mt-3 h-11 w-full justify-between rounded-md border border-warning/15 bg-warning/5 px-3 text-xs text-warning"
              onClick={() => setFilter("proposed")}
            >
              <span className="flex items-center gap-2">
                <AlertCircle />
                {proposals} proposed task{proposals === 1 ? " needs" : "s need"} review
              </span>
              <ChevronRight />
            </TTButton>
          )}
          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2 border-b border-border pb-2">
            <div
              className="flex w-full min-w-0 max-w-full overflow-x-auto xl:w-auto"
              aria-label="Task filters"
            >
              {FILTERS.map((f) => (
                <TTButton
                  key={f.id}
                  variant="quiet"
                  aria-pressed={filter === f.id}
                  className={cn(
                    "h-9 shrink-0 rounded-md px-2.5 text-xs",
                    filter === f.id && "bg-secondary text-royal",
                  )}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                  <span>{scope.filter((i) => matches(i, f.id)).length}</span>
                </TTButton>
              ))}
            </div>
            <div className="flex w-full min-w-0 gap-2 xl:w-auto xl:flex-1">
              <label className="flex h-9 min-w-[110px] flex-1 items-center gap-2 rounded-md border border-input px-2">
                <Search className="size-4 shrink-0 text-muted-foreground" />
                <input
                  aria-label="Search tasks"
                  placeholder="Search tasks…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full min-w-0 bg-transparent text-xs outline-none"
                />
              </label>
              <select
                aria-label="Filter by owner"
                value={person}
                onChange={(e) => setPerson(e.target.value)}
                className="h-9 w-[104px] shrink-0 rounded-md border border-input bg-card px-2 text-xs"
              >
                {["Everyone", "Alex", "Morgan", "Sam", "Unassigned"].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
              <select
                aria-label="Additional status filter"
                value={filter === "blocked" || filter === "overdue" ? filter : "all"}
                onChange={(e) => setFilter(e.target.value as Filter)}
                className="w-9 rounded-md border border-input bg-card text-xs"
                title="Additional status filter"
              >
                <option value="all">All</option>
                <option value="blocked">Blocked</option>
                <option value="overdue">Overdue</option>
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
            {visible.map((i) => (
              <WorkRow
                key={i.id}
                item={i}
                selected={detailId === i.id}
                meetingTitle={
                  view === "work"
                    ? PREVIEW_MEETINGS.find((m) => m.id === i.meetingId)?.title
                    : undefined
                }
                onOpen={() => {
                  setDetailId(i.id);
                  setDrawer(true);
                }}
              />
            ))}
            {!visible.length && (
              <div role="status" className="py-10 text-center">
                <p className="font-medium">
                  {progress.complete && filter === "open" && view === "meetings"
                    ? "Every agreed deliverable is verified."
                    : "No tasks match this view."}
                </p>
                <TTButton
                  variant="quiet"
                  className="mt-2 text-royal"
                  onClick={() => {
                    setQuery("");
                    setPerson("Everyone");
                    setFilter("all");
                  }}
                >
                  View all tasks
                </TTButton>
              </div>
            )}
          </div>
          {view === "meetings" && (
            <footer
              aria-label="Requirements for complete meeting work"
              className={cn(
                "mt-4 flex items-start gap-3 rounded-lg border border-l-2 p-3 text-xs leading-5",
                progress.complete
                  ? "border-success/20 border-l-success bg-success/5"
                  : "border-warning/15 border-l-warning bg-warning/5",
              )}
            >
              <AlertCircle
                className={cn(
                  "mt-0.5 size-5 shrink-0",
                  progress.complete ? "text-success" : "text-warning",
                )}
              />
              <div>
                <p className="text-sm font-semibold">
                  {progress.complete ? "All agreed work verified" : "To reach 100/100"}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {meeting.coverage === "partial"
                    ? "Recover the missing meeting coverage, then verify all agreed work. The full score is unknown."
                    : progress.complete
                      ? "Every agreed task has a completion reference."
                      : `Verify the ${progress.outstanding} remaining agreed tasks.${dependencyGuidance}`}
                </p>
                {proposals > 0 && (
                  <p className="text-muted-foreground">
                    Review the proposed task before closing this meeting. It does not count until
                    agreed.
                  </p>
                )}
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Sample only. Work completion, not a grade for people.
                </p>
              </div>
            </footer>
          )}
        </main>
        {detail && (
          <aside
            aria-label="Selected task details"
            className="hidden min-w-0 border-l border-border p-6 xl:block"
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="min-w-0 text-lg font-semibold leading-7">{detail.title}</h2>
              <TTButton
                variant="quiet"
                aria-label="Close task details"
                title="Close task details"
                className="size-11 shrink-0 rounded-md p-0"
                onClick={() => setDetailId(null)}
              >
                <X />
              </TTButton>
            </div>
            <TaskDetails
              key={detail.id}
              item={detail}
              work={work}
              update={update}
              metadata={metadata}
            />
          </aside>
        )}
      </div>
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="w-[min(320px,90vw)] overflow-y-auto bg-cloud p-0">
          <SheetTitle className="sr-only">Example meeting navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Choose an invented meeting or all outstanding work.
          </SheetDescription>
          {navigation}
        </SheetContent>
      </Sheet>
      <Sheet open={drawer && Boolean(detail) && compact} onOpenChange={setDrawer}>
        <SheetContent className="w-full max-w-lg overflow-y-auto bg-card sm:max-w-lg xl:hidden">
          <SheetTitle className="pr-7 leading-7">{detail?.title}</SheetTitle>
          <SheetDescription className="sr-only">
            Illustrative task details. Changes reset on reload.
          </SheetDescription>
          {detail && (
            <TaskDetails
              key={detail.id}
              item={detail}
              work={work}
              update={update}
              metadata={metadata}
            />
          )}
        </SheetContent>
      </Sheet>
      <Dialog open={sourceOpen} onOpenChange={setSourceOpen}>
        <DialogContent className="bg-card">
          <DialogTitle>{meeting.title}</DialogTitle>
          <DialogDescription>
            Illustrative meeting source · {meeting.date} · {meeting.time} · {meeting.duration}
          </DialogDescription>
          <p>{meeting.people.join(", ")}</p>
          <p className="leading-6">{meeting.read}</p>
          <p className="text-xs text-muted-foreground">
            Invented transcript only. Fathom is not connected. No private meeting or task data is
            read.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WorkRow({
  item,
  selected,
  meetingTitle,
  onOpen,
}: {
  item: PreviewDeliverable;
  selected: boolean;
  meetingTitle?: string | undefined;
  onOpen: () => void;
}) {
  const done = item.status === "verified";
  const proposed = item.status === "proposed";
  const blocked = item.status === "blocked";
  const label = done
    ? "Completed"
    : proposed
      ? "Proposed"
      : blocked
        ? "Blocked"
        : item.overdue
          ? "Overdue"
          : "To do";
  const icon = done ? (
    <span className="grid size-4 place-items-center rounded-full bg-success text-primary-foreground">
      <Check className="size-3" />
    </span>
  ) : blocked ? (
    <LockKeyhole className="size-4 text-warning" />
  ) : proposed ? (
    <Flag className="size-4 text-royal" />
  ) : (
    <Circle className="size-4 text-muted-foreground" />
  );
  return (
    <TTButton
      variant="quiet"
      aria-label={`Select task: ${item.title}`}
      aria-pressed={selected}
      data-task-row={item.id}
      onClick={onOpen}
      className={cn(
        "grid h-auto min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] gap-x-2 rounded-none border-b border-l-2 px-3 py-2 text-left text-sm font-normal sm:grid-cols-[minmax(0,1fr)_116px_104px_92px] sm:py-0",
        selected ? "border-l-royal bg-secondary text-foreground" : "border-l-transparent",
        done && "bg-success/8 text-success",
        proposed && !selected && "bg-royal/5",
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="shrink-0">{icon}</span>
        <span className="min-w-0">
          <span className="block leading-5 sm:truncate" title={item.title}>
            {item.title}
          </span>
          {meetingTitle && (
            <span className="block truncate text-xs text-muted-foreground">{meetingTitle}</span>
          )}
          <span className="mt-1 block text-xs text-muted-foreground sm:hidden">
            {item.owner ?? "Unassigned"} ·{" "}
            {item.dueKind === "spoken" ? "Confirm date" : (item.due ?? "Not set")}
          </span>
        </span>
      </span>
      <span className="hidden min-w-0 items-center gap-2 text-xs text-foreground sm:flex">
        <span
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-full",
            item.owner === "Morgan" || item.owner === "Alex"
              ? "bg-plum/15 text-plum"
              : item.owner === "Sam"
                ? "bg-warning/20 text-warning"
                : "bg-muted text-muted-foreground",
          )}
        >
          {item.owner?.[0] ?? "U"}
        </span>
        <span>{item.owner ?? "Unassigned"}</span>
      </span>
      <span
        title={
          item.dueKind === "spoken"
            ? `Said “${item.due}”; date unconfirmed`
            : (item.due ?? "Date unknown")
        }
        className={cn(
          "hidden text-xs sm:block",
          item.overdue && !done
            ? "text-danger"
            : item.dueKind === "exact" && !done
              ? "text-royal"
              : "text-muted-foreground",
        )}
      >
        {item.dueKind === "spoken" ? "Confirm date" : (item.due ?? "Not set")}
      </span>
      <span className="flex items-center justify-between gap-1">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-semibold",
            done
              ? "bg-success/15 text-success"
              : proposed
                ? "border border-royal/40 bg-card text-royal"
                : blocked
                  ? "bg-warning/15 text-warning"
                  : item.overdue
                    ? "bg-danger/10 text-danger"
                    : "bg-muted text-muted-foreground",
          )}
        >
          {label}
        </span>
        <MoreHorizontal className="hidden size-4 text-muted-foreground sm:block" />
      </span>
    </TTButton>
  );
}
