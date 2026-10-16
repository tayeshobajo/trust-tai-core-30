import { useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCheck,
  Circle,
  CircleCheck,
  FileText,
  Sparkles,
  Flag,
  LockKeyhole,
  RotateCcw,
  Search,
  Video,
} from "lucide-react";
import { TTButton, TTInput } from "@/components/tt/primitives";
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
  const [filter, setFilter] = useState<Filter>("all");
  const [person, setPerson] = useState("Everyone");
  const [query, setQuery] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [reopening, setReopening] = useState(false);
  const [owner, setOwner] = useState("");
  const [future, setFuture] = useState(false);
  const [helpId, setHelpId] = useState<string | null>(null);
  const help = work.find((item) => item.id === helpId);
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
    <div className="mx-auto w-full max-w-[1440px] text-foreground [&_h1]:tracking-normal [&_h2]:tracking-normal [&_h3]:tracking-normal">
      <AmbientSurface
        appId="steward"
        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-border pb-2"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-success/10 text-success">
            <CheckCheck aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold">Steward</h1>
            <p className="text-xs text-muted-foreground">Fictional work · resets on reload</p>
          </div>
        </div>
        <div className="flex shrink-0">
          <TTButton
            variant="quiet"
            title="Fathom — not connected"
            aria-label="Fathom — not connected"
            className="size-11 p-0"
            onClick={() => setFuture(true)}
          >
            <Video />
          </TTButton>
          <TTButton
            variant="quiet"
            title="Reset examples"
            aria-label="Reset examples"
            className="size-11 p-0"
            onClick={() => {
              setWork(PREVIEW_WORK.map((item) => ({ ...item })));
              setMessage("Examples reset. No workspace records changed.");
            }}
          >
            <RotateCcw />
          </TTButton>
        </div>
      </AmbientSurface>
      <nav
        aria-label="Example meetings"
        className="flex min-w-0 gap-1 overflow-x-auto border-b border-border py-1"
      >
        {PREVIEW_MEETINGS.map((entry) => {
          const p = meetingProgress(entry, work);
          return (
            <TTButton
              key={entry.id}
              variant="quiet"
              aria-pressed={view === "meetings" && selected === entry.id}
              onClick={() => {
                setView("meetings");
                setSelected(entry.id);
                setFilter("all");
                setQuery("");
                setPerson("Everyone");
              }}
              className={cn(
                "h-11 shrink-0 rounded-md px-3 text-[13px]",
                view === "meetings" && selected === entry.id && "bg-success/8 text-foreground",
              )}
            >
              {entry.title}
              <span
                className={cn("font-mono text-xs", p.complete ? "text-success" : "text-warning")}
              >
                {p.score === null ? "Partial" : `${p.score}/100`}
              </span>
            </TTButton>
          );
        })}
        <TTButton
          variant="quiet"
          aria-pressed={view === "work"}
          onClick={() => {
            setView("work");
            setFilter("outstanding");
            setQuery("");
            setPerson("Everyone");
          }}
          className={cn(
            "h-11 shrink-0 rounded-md px-3 text-[13px]",
            view === "work" && "bg-secondary text-royal",
          )}
        >
          All outstanding work
        </TTButton>
      </nav>
      <main className="min-w-0">
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold">
              {view === "meetings" ? meeting.title : "Across meetings"}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {view === "meetings"
                ? `${meeting.date} · ${meeting.time} · ${meeting.people.join(" / ")}`
                : "Agreed work · every owner · every meeting"}
            </p>
          </div>
          {view === "meetings" && (
            <div
              aria-label="Meeting work completion"
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-md border px-3 py-2",
                progress.complete
                  ? "border-success/25 bg-success/8 text-success"
                  : "border-warning/25 bg-warning/8 text-warning",
              )}
            >
              {progress.complete ? (
                <CheckCheck className="size-5" />
              ) : (
                <Circle className="size-5" />
              )}
              <div>
                <p className="font-mono text-xl font-medium">
                  {progress.score === null ? "—/100" : `${progress.score}/100`}
                </p>
                <p className="text-xs">
                  {progress.score === null
                    ? "Partial coverage"
                    : `${progress.verified}/${progress.agreed} verified`}
                </p>
              </div>
            </div>
          )}
        </header>
        <div className="grid min-w-0 gap-1 border-y border-border py-1 xl:grid-cols-[minmax(0,1fr)_auto]">
          <div className="flex min-w-0 gap-0.5 overflow-x-auto" aria-label="Work filters">
            {FILTERS.map((entry) => (
              <TTButton
                key={entry.id}
                variant="quiet"
                aria-pressed={filter === entry.id}
                onClick={() => setFilter(entry.id)}
                className={cn(
                  "h-11 shrink-0 rounded-md px-2 text-xs",
                  filter === entry.id && "bg-secondary text-foreground",
                )}
              >
                {entry.label}
                <span className="font-mono text-xs">
                  {scope.filter((item) => matches(item, entry.id)).length}
                </span>
              </TTButton>
            ))}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <label className="flex min-w-0 flex-1 items-center gap-1">
              <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <input
                aria-label="Search example work"
                placeholder="Find work"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-11 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground xl:w-24"
              />
            </label>
            <select
              aria-label="Filter by owner"
              value={person}
              onChange={(e) => setPerson(e.target.value)}
              className="h-11 max-w-28 shrink-0 rounded-md border border-input bg-card px-2 text-xs text-foreground"
            >
              {["Everyone", "Alex", "Morgan", "Sam"].map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </div>
        </div>
        <div aria-label="Meeting tasks">
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
              onHelp={() => setHelpId(item.id)}
            />
          ))}
          {visible.length === 0 && (
            <div className="py-6 text-center">
              <CircleCheck
                className={cn(
                  "mx-auto size-6",
                  progress.complete ? "text-success" : "text-muted-foreground",
                )}
              />
              <h3 className="mt-2 text-sm font-medium">
                {progress.complete && view === "meetings" && filter === "outstanding"
                  ? "Every agreed deliverable is verified."
                  : "No items match this view."}
              </h3>
              <TTButton
                variant="quiet"
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
        {view === "meetings" && (
          <footer
            aria-label="Requirements for complete meeting work"
            className={cn(
              "mt-2 border-l-2 px-3 py-2 text-[13px] leading-5",
              progress.complete
                ? "border-success bg-success/5 text-success"
                : "border-warning bg-warning/5 text-foreground",
            )}
          >
            <span className="font-semibold">
              {progress.complete ? "✓ All agreed work verified." : "To reach 100/100: "}
            </span>
            {meeting.coverage === "partial"
              ? "Recover the missing meeting coverage, then verify all agreed work. The full score is unknown."
              : !progress.complete &&
                `${progress.outstanding} agreed items still need evidence${scope.some((item) => item.status === "blocked") ? "; approve the copy to unblock the page build" : ""}.`}
            {work.some((item) => item.meetingId === selected && item.status === "proposed") && (
              <span> Proposals await agreement and an owner; they do not count yet.</span>
            )}
            <p className="text-xs text-muted-foreground">
              Work completion, not a grade for people. Example references only.
            </p>
          </footer>
        )}
        <p className="sr-only" role="status">
          {message}
        </p>
      </main>
      <Dialog
        open={Boolean(help)}
        onOpenChange={(open) => {
          if (!open) setHelpId(null);
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto bg-card">
          <p className="flex items-center gap-2 text-xs text-royal">
            <Sparkles className="size-4" /> Illustrative AI support · not executing
          </p>
          <DialogTitle className="pr-6 text-lg tracking-normal">{help?.title}</DialogTitle>
          <DialogDescription>
            A prepared example for human review. No model runs, sends or assignments.
          </DialogDescription>
          {help && (
            <>
              <section className="border-l-2 border-royal pl-3">
                <h3 className="text-sm font-semibold">
                  {help.status === "verified" ? "Review aid" : "Starting point"}
                </h3>
                <p className="mt-2 whitespace-pre-line text-sm leading-6">{help.aiDraft}</p>
              </section>
              <section>
                <h3 className="text-sm font-semibold">Your next move</h3>
                <p className="mt-1 text-sm">{help.nextMove}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {help.status === "blocked"
                    ? `Wait for verified evidence of: ${help.dependency}. This example cannot clear it.`
                    : help.status === "proposed"
                      ? "Confirm whether this is agreed work and name its owner before acting."
                      : help.status === "verified"
                        ? "Keep the recorded evidence. Reopen with a reason if another review finds a gap."
                        : "Check this against the source and actual result. A draft alone is not completion evidence."}
                </p>
              </section>
              <TTButton
                variant="secondary"
                onClick={() => {
                  setHelpId(null);
                  openDetail(help);
                }}
              >
                <FileText /> Review source & evidence
              </TTButton>
            </>
          )}
        </DialogContent>
      </Dialog>

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
  onHelp,
}: {
  item: PreviewDeliverable;
  meetingTitle?: string;
  onOpen: () => void;
  onReopen: () => void;
  onHelp: () => void;
}) {
  const verified = item.status === "verified";
  const blocked = item.status === "blocked";
  const proposed = item.status === "proposed";
  const label = verified
    ? "Verified"
    : blocked
      ? "Blocked"
      : proposed
        ? "Proposed"
        : item.overdue
          ? "Overdue"
          : "Agreed";
  const action = verified
    ? "Reopen"
    : blocked
      ? "View blocker"
      : proposed
        ? "Review proposal"
        : "Review & verify";
  return (
    <article
      data-task-row={item.id}
      className={cn(
        "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 border-b border-l-2 px-2 py-2 sm:grid-cols-[minmax(0,1fr)_72px_94px_90px_88px] sm:gap-x-1 sm:py-0",
        verified
          ? "border-l-success bg-success/8"
          : blocked || item.overdue
            ? "border-l-warning bg-warning/5"
            : proposed
              ? "border-l-royal bg-royal/5"
              : "border-l-transparent bg-card",
      )}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          {verified ? (
            <CircleCheck aria-hidden className="size-4 shrink-0 text-success" />
          ) : blocked ? (
            <LockKeyhole aria-hidden className="size-4 shrink-0 text-warning" />
          ) : proposed ? (
            <Flag aria-hidden className="size-4 shrink-0 text-royal" />
          ) : (
            <Circle aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          )}
          <h3
            title={item.title}
            className={cn(
              "min-w-0 text-sm font-medium leading-5 sm:truncate",
              verified && "text-success",
            )}
          >
            {item.title}
          </h3>
        </div>
        {meetingTitle && (
          <p title={meetingTitle} className="truncate pl-6 text-xs text-muted-foreground">
            {meetingTitle}
          </p>
        )}
        <p className="mt-1 pl-6 text-xs text-muted-foreground sm:hidden">
          {item.owner ?? "Owner unknown"} ·{" "}
          {item.dueKind === "spoken" ? `“${item.due}” · unconfirmed` : (item.due ?? "Date unknown")}
        </p>
      </div>
      <div className="hidden min-w-0 text-xs sm:block">
        <p className={item.owner ? "text-foreground" : "text-royal"}>{item.owner ?? "Unknown"}</p>
        <p
          className="truncate text-muted-foreground"
          title={
            item.dueKind === "spoken"
              ? `Said ${item.due}; date unconfirmed`
              : (item.due ?? "Date unknown")
          }
        >
          {item.dueKind === "spoken" ? `“${item.due}”?` : (item.due ?? "No date")}
        </p>
      </div>
      <span
        className={cn(
          "text-xs font-medium",
          verified
            ? "text-success"
            : blocked || item.overdue
              ? "text-warning"
              : proposed
                ? "text-royal"
                : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      <TTButton
        variant="quiet"
        title={`AI help: ${item.title}`}
        aria-label={`AI help: ${item.title}`}
        className="h-11 rounded-md px-1 text-xs text-royal"
        onClick={onHelp}
      >
        <Sparkles /> AI help
      </TTButton>
      <TTButton
        variant="quiet"
        title={action}
        aria-label={action}
        className="h-11 rounded-md px-1 text-xs"
        onClick={verified ? onReopen : onOpen}
      >
        {verified ? <RotateCcw /> : blocked ? <LockKeyhole /> : proposed ? <Flag /> : <Check />}
        <span>{verified ? "Reopen" : blocked ? "Blocker" : proposed ? "Review" : "Verify"}</span>
      </TTButton>
    </article>
  );
}
