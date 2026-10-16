import { useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  Circle,
  CircleCheck,
  FileText,
  Flag,
  LockKeyhole,
  RotateCcw,
  Search,
  Video,
} from "lucide-react";
import { TTButton, TTInput, TonePill } from "@/components/tt/primitives";
import { AmbientSurface } from "@/components/tt/ambient";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { PREVIEW_MEETINGS, PREVIEW_WORK } from "@/data/mockups/steward-preview";
import {
  confirmPreview,
  meetingProgress,
  reopenPreview,
  verifyPreview,
  type PreviewDeliverable,
} from "@/domain/steward-preview";
import { cn } from "@/lib/utils";

type Filter = "outstanding" | "all" | "blocked" | "overdue" | "proposed" | "verified";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "outstanding", label: "Outstanding" },
  { id: "all", label: "All work" },
  { id: "blocked", label: "Blocked" },
  { id: "overdue", label: "Overdue" },
  { id: "proposed", label: "Proposals" },
  { id: "verified", label: "Verified" },
];
function matches(item: PreviewDeliverable, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "outstanding") return item.status === "open" || item.status === "blocked";
  if (filter === "overdue")
    return item.overdue && item.status !== "verified" && item.status !== "proposed";
  return item.status === filter;
}

export function StewardPreview() {
  const [work, setWork] = useState(() => PREVIEW_WORK.map((item) => ({ ...item })));
  const [selected, setSelected] = useState("example-planning");
  const [view, setView] = useState<"meetings" | "work">("meetings");
  const [filter, setFilter] = useState<Filter>("outstanding");
  const [person, setPerson] = useState("Everyone");
  const [query, setQuery] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [reopening, setReopening] = useState(false);
  const [owner, setOwner] = useState("");
  const [future, setFuture] = useState(false);
  const [message, setMessage] = useState("");
  const meeting = PREVIEW_MEETINGS.find((entry) => entry.id === selected) ?? PREVIEW_MEETINGS[0];
  if (!meeting) return null;
  const progress = meetingProgress(meeting, work);
  const scope = work.filter(
    (item) =>
      (view === "work" || item.meetingId === selected) &&
      (person === "Everyone" || item.owner === person),
  );
  const visible = scope.filter(
    (item) => matches(item, filter) && item.title.toLowerCase().includes(query.toLowerCase()),
  );
  const detail = work.find((item) => item.id === detailId);
  const detailMeeting = PREVIEW_MEETINGS.find((entry) => entry.id === detail?.meetingId);
  const outstanding = work.filter((item) => matches(item, "outstanding")).length;
  const blocked = work.filter((item) => item.status === "blocked").length;
  const proposals = work.filter((item) => item.status === "proposed").length;
  function update(id: string, change: (item: PreviewDeliverable) => PreviewDeliverable) {
    setWork((current) => current.map((item) => (item.id === id ? change(item) : item)));
  }
  function openDetail(item: PreviewDeliverable, reopen = false) {
    setDetailId(item.id);
    setReference("");
    setReopenReason("");
    setReopening(reopen);
    setOwner(item.owner ?? "");
  }
  function illustrativeMetadata() {
    const receiptCount = work.reduce((count, item) => count + (item.history?.length ?? 0), 0);
    return {
      actor: "Alex (fictional)",
      at: new Date(Date.UTC(2026, 9, 16, 16, receiptCount)).toISOString(),
    };
  }
  const dependencyDone = detail?.dependency
    ? work.some(
        (item) => item.title === detail.dependency && item.status === "verified" && item.proof,
      )
    : true;

  return (
    <div className="mx-auto w-full max-w-[1440px] pb-12 text-foreground [&_h1]:tracking-normal [&_h2]:tracking-normal [&_h3]:tracking-normal">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-border px-1 py-1 text-xs text-muted-foreground sm:py-3">
        <span className="flex min-w-0 items-center gap-2">
          <Flag className="size-3.5 shrink-0" aria-hidden /> Fictional design preview
        </span>
        <TTButton
          variant="quiet"
          onClick={() => {
            setWork(PREVIEW_WORK.map((item) => ({ ...item })));
            setMessage("Illustrative work reset. No workspace records changed.");
          }}
          className="h-11 px-2 text-xs"
        >
          <RotateCcw /> Reset examples
        </TTButton>
      </div>
      <AmbientSurface appId="steward" className="border-b border-border px-1 py-3 sm:px-3 sm:py-7">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="hidden font-mono text-[11px] text-muted-foreground sm:block">
              CMD / STEWARD
            </p>
            <h1 className="font-display text-3xl font-semibold sm:mt-2 sm:text-4xl">Steward</h1>
            <p className="mt-3 hidden text-sm text-muted-foreground sm:block">
              The conversation ended. The work carries on.
            </p>
          </div>
          <TTButton
            variant="secondary"
            className="shrink-0 px-2 text-xs sm:px-4"
            onClick={() => setFuture(true)}
          >
            <Video /> Fathom{" "}
            <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline">
              NOT CONNECTED
            </span>
          </TTButton>
        </div>
        <div className="mt-7 hidden flex-wrap gap-x-9 gap-y-4 sm:flex">
          {[
            { n: outstanding, label: "agreed items outstanding", filter: "outstanding" as Filter },
            { n: blocked, label: "waiting on something", filter: "blocked" as Filter },
            { n: proposals, label: "needs a decision", filter: "proposed" as Filter },
          ].map((stat) => (
            <TTButton
              key={stat.filter}
              variant="quiet"
              onClick={() => {
                setView("work");
                setFilter(stat.filter);
              }}
              className="h-auto min-h-11 gap-3 rounded-none px-0 text-left hover:bg-transparent"
            >
              <span
                className={cn(
                  "font-display text-3xl font-medium",
                  stat.filter === "blocked" ? "text-warning" : "text-foreground",
                )}
              >
                {stat.n}
              </span>
              <span className="max-w-28 text-xs font-normal leading-5 text-muted-foreground">
                {stat.label}
              </span>
            </TTButton>
          ))}
        </div>
      </AmbientSurface>
      <div className="flex items-center gap-5 border-b border-border px-1 sm:px-3">
        {(["meetings", "work"] as const).map((tab) => (
          <TTButton
            key={tab}
            variant="quiet"
            aria-pressed={view === tab}
            onClick={() => {
              setView(tab);
              setFilter("outstanding");
            }}
            className={cn(
              "h-11 rounded-none border-b-2 px-0 sm:h-14",
              view === tab ? "border-foreground text-foreground" : "border-transparent",
            )}
          >
            {tab === "meetings" ? "Meetings" : "All outstanding work"}
          </TTButton>
        ))}
      </div>
      <div
        className={cn(
          "mt-3 grid gap-4 sm:mt-6 sm:gap-7",
          view === "meetings" && "lg:grid-cols-[260px_minmax(0,1fr)]",
        )}
      >
        {view === "meetings" && (
          <aside aria-label="Example meetings" className="hidden min-w-0 lg:block">
            <p className="mb-3 px-1 font-mono text-[11px] text-muted-foreground">
              RECENT MEETINGS · 3
            </p>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
              {PREVIEW_MEETINGS.map((entry) => {
                const p = meetingProgress(entry, work);
                return (
                  <TTButton
                    key={entry.id}
                    variant="quiet"
                    aria-pressed={selected === entry.id}
                    onClick={() => {
                      setSelected(entry.id);
                      setFilter("outstanding");
                    }}
                    className={cn(
                      "h-auto min-h-36 w-full items-start justify-start rounded-lg border p-4 text-left",
                      selected === entry.id
                        ? "border-royal/25 bg-card text-foreground"
                        : "border-transparent",
                    )}
                  >
                    <span className="block w-full">
                      <span className="flex items-center justify-between gap-2 text-[11px] font-normal text-muted-foreground">
                        <span>
                          {entry.date} · {entry.time}
                        </span>
                        <Video className="size-3.5" />
                      </span>
                      <span className="mt-3 block text-sm font-semibold leading-6">
                        {entry.title}
                      </span>
                      <span className="mt-3 flex items-center justify-between gap-2 text-xs font-normal">
                        <span className={p.complete ? "text-success" : "text-muted-foreground"}>
                          {p.complete ? (
                            <>
                              <CheckCheck className="mr-1 inline size-3.5" />
                              Verified complete
                            </>
                          ) : (
                            p.outstanding + " outstanding"
                          )}
                        </span>
                        <span
                          className={cn(
                            "font-mono text-[11px]",
                            p.complete ? "text-success" : "text-muted-foreground",
                          )}
                        >
                          {p.score === null ? "Partial" : `${p.score}/100`}
                        </span>
                      </span>
                    </span>
                  </TTButton>
                );
              })}
            </div>
          </aside>
        )}
        <main className="min-w-0">
          {view === "meetings" && (
            <label className="mb-3 block text-xs text-muted-foreground lg:hidden">
              Meeting
              <select
                aria-label="Select example meeting"
                value={selected}
                onChange={(event) => {
                  setSelected(event.target.value);
                  setFilter("outstanding");
                }}
                className="mt-1 h-11 w-full min-w-0 rounded-md border border-input bg-card px-2 text-sm text-foreground"
              >
                {PREVIEW_MEETINGS.map((entry) => {
                  const p = meetingProgress(entry, work);
                  return (
                    <option key={entry.id} value={entry.id}>
                      {entry.title} · {p.score === null ? "Partial" : `${p.score}/100`}
                    </option>
                  );
                })}
              </select>
            </label>
          )}
          <header className="border-b border-border pb-2 sm:pb-5">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:flex sm:justify-between">
              <div className="min-w-0">
                <p className="font-mono text-[11px] text-muted-foreground">
                  {view === "meetings"
                    ? `${meeting.date.toUpperCase()} · ${meeting.time} · ${meeting.duration}`
                    : "ACROSS ALL EXAMPLE MEETINGS"}
                </p>
                <h2 className="mt-1 font-display text-lg font-semibold sm:mt-2 sm:text-2xl">
                  {view === "meetings" ? meeting.title : "What still needs to move"}
                </h2>
                <p className="mt-2 hidden text-xs text-muted-foreground sm:block">
                  {view === "meetings"
                    ? meeting.people.join(" · ")
                    : "Agreed work, one next move at a time."}
                </p>
              </div>
              {view === "meetings" && (
                <div
                  className={cn(
                    "text-right",
                    progress.complete ? "text-success" : "text-foreground",
                  )}
                >
                  <p className="font-mono text-2xl">
                    {progress.score === null ? "—/100" : `${progress.score}/100`}
                  </p>
                  <p className="mt-1 max-w-24 text-[11px] text-muted-foreground sm:max-w-none">
                    {progress.verified}/{progress.agreed} agreed items verified
                  </p>
                </div>
              )}
            </div>
            {view === "meetings" && (
              <p
                className={cn(
                  "mt-4 hidden border-l-2 pl-3 text-[13px] leading-6 sm:block",
                  meeting.coverage === "partial"
                    ? "border-warning text-warning"
                    : progress.complete
                      ? "border-success text-success"
                      : "border-border text-muted-foreground",
                )}
              >
                {meeting.read}
              </p>
            )}
            {view === "meetings" && meeting.coverage === "partial" && (
              <p className="mt-2 text-xs text-warning sm:hidden">
                Incomplete coverage · more work may be missing.
              </p>
            )}
          </header>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-2 sm:py-4">
            <div
              className="flex w-full min-w-0 gap-1 overflow-x-auto sm:w-auto sm:flex-wrap"
              aria-label="Work filters"
            >
              {FILTERS.map((entry) => (
                <TTButton
                  key={entry.id}
                  variant="quiet"
                  aria-pressed={filter === entry.id}
                  onClick={() => setFilter(entry.id)}
                  className={cn(
                    "min-h-11 shrink-0 px-3 text-xs",
                    filter === entry.id && "bg-secondary text-foreground",
                  )}
                >
                  {entry.label}
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {scope.filter((item) => matches(item, entry.id)).length}
                  </span>
                </TTButton>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Owner
              <select
                aria-label="Filter by owner"
                value={person}
                onChange={(event) => setPerson(event.target.value)}
                className="h-11 max-w-36 rounded-md border border-input bg-card px-3 text-xs text-foreground"
              >
                {["Everyone", "Alex", "Morgan", "Sam"].map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="mb-3 flex items-center gap-2 border-b border-border pb-1 sm:mb-4 sm:pb-2">
            <Search className="size-4 text-muted-foreground" aria-hidden />
            <input
              aria-label="Search example work"
              placeholder="Find a deliverable"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </label>
          <div className="space-y-3">
            {visible.map((item) => (
              <WorkRow
                key={item.id}
                item={item}
                meetingTitle={
                  view === "work"
                    ? PREVIEW_MEETINGS.find((m) => m.id === item.meetingId)?.title
                    : undefined
                }
                onOpen={() => openDetail(item)}
                onReopen={() => openDetail(item, true)}
              />
            ))}
            {visible.length === 0 && (
              <div className="py-12 text-center">
                <CircleCheck
                  className={cn(
                    "mx-auto size-8",
                    progress.complete && view === "meetings"
                      ? "text-success"
                      : "text-muted-foreground",
                  )}
                />
                <h3 className="mt-3 text-base font-medium">
                  {progress.complete && view === "meetings" && filter === "outstanding"
                    ? "Every agreed deliverable is verified."
                    : "No items match this view."}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {meeting.coverage === "partial" && view === "meetings"
                    ? "Coverage is incomplete. This meeting cannot be called complete."
                    : "The original context and completion references stay with the work."}
                </p>
                <TTButton
                  variant="quiet"
                  className="mt-3"
                  onClick={() => {
                    setFilter("all");
                    setQuery("");
                    setPerson("Everyone");
                  }}
                >
                  View all work <ArrowRight />
                </TTButton>
              </div>
            )}
          </div>
          {filter === "outstanding" && proposals > 0 && (
            <TTButton
              variant="quiet"
              onClick={() => setFilter("proposed")}
              className="mt-4 w-full justify-between rounded-md border-t border-border px-1"
            >
              <span className="text-xs">Proposals are not agreed work.</span>
              <span className="flex items-center gap-2 text-xs">
                Review proposals <ArrowRight />
              </span>
            </TTButton>
          )}
          <p className="mt-6 text-xs leading-5 text-muted-foreground">
            Illustrative completion references only. No assignments, messages or workspace changes.
          </p>
          <p className="sr-only" role="status">
            {message}
          </p>
        </main>
      </div>

      <Dialog
        open={Boolean(detail)}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto bg-card">
          <p className="font-mono text-[10px] text-muted-foreground">ILLUSTRATIVE DELIVERABLE</p>
          <DialogTitle className="pr-6 font-display text-xl leading-7 tracking-normal">
            {detail?.title}
          </DialogTitle>
          <DialogDescription>
            {detailMeeting?.title} · source at {detail?.at}
          </DialogDescription>
          {detail && (
            <>
              <dl className="grid grid-cols-2 gap-4 border-y border-border py-4 text-sm">
                <div>
                  <dt className="mb-1 text-xs text-muted-foreground">Who carries it</dt>
                  <dd>{detail.owner ?? "Owner not confirmed"}</dd>
                </div>
                <div>
                  <dt className="mb-1 text-xs text-muted-foreground">Timing</dt>
                  <dd>
                    {detail.dueKind === "spoken"
                      ? `Said “${detail.due}” · date unconfirmed`
                      : (detail.due ?? "Not agreed")}
                  </dd>
                </div>
              </dl>
              <div>
                <h3 className="text-xs font-medium text-muted-foreground">
                  What was said · invented example
                </h3>
                <blockquote className="mt-2 border-l-2 border-border pl-3 text-sm leading-6">
                  “{detail.quote}”
                </blockquote>
              </div>
              <div>
                <h3 className="text-xs font-medium text-muted-foreground">Next move</h3>
                <p className="mt-1 text-sm leading-6">{detail.nextMove}</p>
                {detail.dependency && (
                  <p className="mt-2 flex items-start gap-2 text-xs text-warning">
                    <LockKeyhole className="size-4 shrink-0" />
                    Depends on: {detail.dependency}
                  </p>
                )}
              </div>
              {detail.status === "verified" ? (
                <>
                  <div className="rounded-md border border-success/25 bg-success/5 p-4 text-sm text-success">
                    <p className="mb-2 flex items-center gap-2 font-medium">
                      <CheckCheck className="size-4" />
                      Verified · example only
                    </p>
                    {detail.proof}
                  </div>
                  {reopening ? (
                    <>
                      <label className="text-sm">
                        Reopen reason
                        <TTInput
                          className="mt-2"
                          aria-label="Reopen reason"
                          value={reopenReason}
                          onChange={(event) => setReopenReason(event.target.value)}
                          placeholder="What needs further work?"
                        />
                      </label>
                      <TTButton
                        variant="secondary"
                        disabled={!reopenReason.trim()}
                        onClick={() => {
                          update(detail.id, (item) =>
                            reopenPreview(item, reopenReason, illustrativeMetadata()),
                          );
                          setReopening(false);
                          setMessage(
                            "Example deliverable reopened. Prior completion receipts preserved.",
                          );
                        }}
                      >
                        <RotateCcw />
                        Record example reopening
                      </TTButton>
                    </>
                  ) : (
                    <TTButton variant="secondary" onClick={() => setReopening(true)}>
                      <RotateCcw />
                      Reopen deliverable
                    </TTButton>
                  )}
                </>
              ) : detail.status === "proposed" ? (
                <>
                  <label className="text-sm">
                    Confirm example owner
                    <select
                      aria-label="Confirm example owner"
                      value={owner}
                      onChange={(e) => setOwner(e.target.value)}
                      className="mt-2 h-11 w-full rounded-md border border-input bg-card px-3"
                    >
                      <option value="">Choose an owner</option>
                      {["Alex", "Morgan", "Sam"].map((name) => (
                        <option key={name}>{name}</option>
                      ))}
                    </select>
                  </label>
                  <TTButton
                    disabled={!owner}
                    onClick={() => {
                      update(detail.id, (item) => confirmPreview(item, owner));
                      setDetailId(null);
                      setMessage("Proposal confirmed in this example only.");
                    }}
                  >
                    <Check />
                    Confirm example work
                  </TTButton>
                </>
              ) : detail.status === "blocked" ? (
                <>
                  <p className="text-xs text-warning">
                    {dependencyDone
                      ? "The dependency has a verified example reference. This work can now be reopened."
                      : "The dependency is still outstanding. Completion stays blocked."}
                  </p>
                  <TTButton
                    variant="secondary"
                    disabled={!dependencyDone}
                    onClick={() => update(detail.id, (item) => ({ ...item, status: "open" }))}
                  >
                    <LockKeyhole />
                    Clear example blocker
                  </TTButton>
                </>
              ) : (
                <>
                  <label className="text-sm">
                    Completion reference
                    <TTInput
                      className="mt-2"
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder="An illustrative review or evidence reference"
                    />
                  </label>
                  <TTButton
                    disabled={!reference.trim()}
                    className="bg-success text-primary-foreground hover:bg-success/90"
                    onClick={() => {
                      update(detail.id, (item) =>
                        verifyPreview(item, reference, illustrativeMetadata()),
                      );
                      setDetailId(null);
                      setMessage("Example completion reference recorded.");
                    }}
                  >
                    <CheckCheck />
                    Verify example completion
                  </TTButton>
                </>
              )}
              {Boolean(detail.history?.length) && (
                <section
                  aria-label="Illustrative receipt history"
                  className="border-t border-border pt-4"
                >
                  <h3 className="text-sm font-medium">Completion & reopen history</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Fictional actors and simulated times · resets on reload.
                  </p>
                  <ol className="mt-3 space-y-3">
                    {detail.history?.map((receipt, index) => (
                      <li
                        key={`${receipt.at}-${index}`}
                        className="border-l-2 border-border pl-3 text-sm"
                      >
                        <p
                          className={
                            receipt.kind === "completed" ? "text-success" : "text-foreground"
                          }
                        >
                          {receipt.kind === "completed" ? (
                            <CheckCheck className="mr-1 inline size-4" />
                          ) : (
                            <RotateCcw className="mr-1 inline size-4" />
                          )}
                          {receipt.kind === "completed" ? "Completed" : "Reopened"} · illustrative
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {receipt.actor} ·{" "}
                          {receipt.at
                            .replace("T", " ")
                            .replace(".000Z", " UTC")
                            .replace("Z", " UTC")}
                        </p>
                        {receipt.reason && <p className="mt-1">Reason: {receipt.reason}</p>}
                        <p className="mt-1 break-words text-xs text-muted-foreground">
                          Completion reference: {receipt.proof}
                        </p>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={future} onOpenChange={setFuture}>
        <DialogContent className="bg-card">
          <Video className="size-6 text-muted-foreground" />
          <DialogTitle className="tracking-normal">Conversations into completed work</DialogTitle>
          <DialogDescription className="leading-6">
            Future behavior, not running in this preview: read full Fathom meetings, surface agreed
            deliverables and confirmed owners, link existing authorized tasks, and prepare the next
            move for human review.
          </DialogDescription>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <LockKeyhole className="size-4" />
            No integration connected. Nothing is sent or assigned.
          </p>
          <TTButton variant="secondary" onClick={() => setFuture(false)}>
            Return to meetings
          </TTButton>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WorkRow({
  item,
  meetingTitle,
  onOpen,
  onReopen,
}: {
  item: PreviewDeliverable;
  meetingTitle?: string | undefined;
  onOpen: () => void;
  onReopen: () => void;
}) {
  const verified = item.status === "verified";
  const blocked = item.status === "blocked";
  return (
    <article
      className={cn(
        "rounded-lg border bg-card p-4 sm:p-5",
        verified ? "border-success/25" : blocked ? "border-warning/30" : "border-border",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-1 shrink-0",
            verified ? "text-success" : blocked ? "text-warning" : "text-muted-foreground",
          )}
        >
          {verified ? (
            <CircleCheck className="size-5" />
          ) : blocked ? (
            <LockKeyhole className="size-5" />
          ) : (
            <Circle className="size-5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className={cn("text-sm font-semibold leading-6", verified && "text-success")}>
              {item.title}
            </h3>
            <TonePill tone={verified ? "good" : blocked || item.overdue ? "caution" : "neutral"}>
              {verified
                ? "Verified"
                : blocked
                  ? "Blocked"
                  : item.status === "proposed"
                    ? "Proposed"
                    : item.overdue
                      ? "Overdue"
                      : "Agreed"}
            </TonePill>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {item.owner ?? "Owner not confirmed"}
            <span aria-hidden> · </span>
            {item.due
              ? item.dueKind === "spoken"
                ? `“${item.due}” · date unconfirmed`
                : item.due
              : "No date agreed"}
            {meetingTitle && <> · {meetingTitle}</>}
          </p>
          <p
            className={cn(
              "mt-3 flex items-start gap-2 text-[13px] leading-6",
              blocked ? "text-warning" : "text-muted-foreground",
            )}
          >
            {verified ? (
              <Check className="mt-1 size-4 shrink-0" />
            ) : (
              <ArrowRight className="mt-1 size-4 shrink-0" />
            )}
            {verified ? item.proof : item.nextMove}
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <TTButton variant="quiet" onClick={onOpen} className="min-h-11 px-0 text-xs">
              <FileText />
              Source · {item.at}
              <ChevronDown />
            </TTButton>
            {verified ? (
              <TTButton variant="quiet" onClick={onReopen} className="min-h-11 px-2 text-xs">
                <RotateCcw />
                Reopen
              </TTButton>
            ) : (
              <TTButton variant="secondary" onClick={onOpen} className="min-h-11 px-4 text-xs">
                {blocked
                  ? "View blocker"
                  : item.status === "proposed"
                    ? "Review proposal"
                    : "Review & verify"}
                <ArrowRight />
              </TTButton>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
