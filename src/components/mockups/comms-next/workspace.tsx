/**
 * MOCKUP ONLY — Comms Next workspace.
 *
 * A connected, clickable prototype of the proposed Comms experience:
 * Conversations, Review, Follow-ups. Every value comes from sample fixtures.
 * No service is called, no record is written, nothing is ever sent.
 */

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CircleHelp,
  FileText,
  Lightbulb,
  Pencil,
  Settings,
  Sparkles,
} from "lucide-react";

import { TTButton, TTInput } from "@/components/tt/primitives";
import {
  COVERAGE_LABEL,
  DEMO_COVERAGE,
  DEMO_FINDINGS,
  DEMO_FOLLOWUPS,
  DEMO_OPPORTUNITY,
  DEMO_PEOPLE,
  DEMO_SOURCES,
  DEMO_THREADS,
  FINDING_GROUP_LABEL,
  SOURCE_STATE_LABEL,
  type CoverageStatus,
  type DemoFinding,
  type DemoThread,
  type FindingGroup,
  type SourceState,
  type ThreadState,
} from "@/data/mockups/comms-next";
import { cn } from "@/lib/utils";

/* --------------------------------- shared --------------------------------- */

type View = "conversations" | "review" | "followups";

function Chip({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "risk" | "warn" | "good" | "royal";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] leading-5",
        tone === "neutral" && "border-border bg-secondary text-muted-foreground",
        tone === "risk" && "border-destructive/30 bg-destructive/8 text-destructive",
        tone === "warn" && "border-warning/30 bg-warning/10 text-warning",
        tone === "good" && "border-success/30 bg-success/10 text-success",
        tone === "royal" && "border-royal/30 bg-royal-wash text-royal",
      )}
    >
      {children}
    </span>
  );
}

function Panel({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      className={cn("rounded-xl border border-border bg-card p-4 sm:p-5", className)}
      {...props}
    />
  );
}

const STATE_LABEL: Record<ThreadState, string> = {
  needs_reply: "Needs reply",
  waiting: "Waiting on them",
  draft: "Draft",
  closed: "Closed",
};

const FILTERS: { id: ThreadState | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs_reply", label: "Needs reply" },
  { id: "waiting", label: "Waiting on them" },
  { id: "draft", label: "Drafts" },
  { id: "closed", label: "Closed" },
];

/* ------------------------------ conversations ------------------------------ */

function ThreadList({
  mode,
  setMode,
  filter,
  setFilter,
  threads,
  selectedId,
  onSelect,
}: {
  mode: "threads" | "people";
  setMode: (mode: "threads" | "people") => void;
  filter: ThreadState | "all";
  setFilter: (filter: ThreadState | "all") => void;
  threads: DemoThread[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1 text-[13px]">
        {(["threads", "people"] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setMode(entry)}
            aria-pressed={mode === entry}
            className={cn(
              "h-8 flex-1 rounded-full capitalize transition-colors",
              mode === entry
                ? "bg-royal text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {entry}
          </button>
        ))}
      </div>

      {mode === "threads" ? (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {FILTERS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setFilter(entry.id)}
                aria-pressed={filter === entry.id}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                  filter === entry.id
                    ? "border-royal/40 bg-royal-wash text-royal"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <ul className="mt-3 space-y-2">
            {threads.map((thread) => (
              <li key={thread.id}>
                <button
                  type="button"
                  onClick={() => onSelect(thread.id)}
                  aria-current={thread.id === selectedId ? "true" : undefined}
                  className={cn(
                    "w-full rounded-lg border p-3 text-left transition-colors",
                    thread.id === selectedId
                      ? "border-royal/40 bg-royal-wash"
                      : "border-border bg-card hover:border-royal/25",
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-[14px] font-medium text-foreground">
                      {thread.person}
                    </p>
                    <span className="shrink-0 text-[12px] text-muted-foreground">
                      {thread.activity}
                    </span>
                  </div>
                  <p className="truncate text-[13px] text-muted-foreground">{thread.company}</p>
                  <p className="mt-1.5 truncate text-[13px] text-foreground">{thread.subject}</p>
                  <p className="truncate text-[13px] text-muted-foreground">{thread.preview}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Chip tone={thread.state === "needs_reply" ? "risk" : "neutral"}>
                      {STATE_LABEL[thread.state]}
                    </Chip>
                    <Chip>{thread.owner}</Chip>
                  </div>
                </button>
              </li>
            ))}
            {threads.length === 0 ? (
              <li className="rounded-lg border border-dashed border-border p-4 text-[13px] text-muted-foreground">
                Nothing in this filter.
              </li>
            ) : null}
          </ul>
        </>
      ) : (
        <ul className="mt-3 space-y-2">
          {DEMO_PEOPLE.map((person) => (
            <li key={person.id} className="rounded-lg border border-border bg-card p-3">
              <p className="text-[14px] font-medium text-foreground">{person.name}</p>
              <p className="text-[13px] text-muted-foreground">{person.company}</p>
              <p className="mt-1 text-[13px] text-muted-foreground">{person.note}</p>
              <p className="mt-1.5 text-[12px] text-muted-foreground">
                {person.threads === 0
                  ? "No threads. The relationship is still kept."
                  : `${person.threads} threads`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MyRead({ thread }: { thread: DemoThread }) {
  const [editing, setEditing] = useState(false);
  const [achieve, setAchieve] = useState(thread.read.achieve);

  return (
    <Panel className="border-royal/25 bg-royal-wash/40">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-foreground">My read</p>
        <button
          type="button"
          onClick={() => setEditing((current) => !current)}
          className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
        >
          <Pencil aria-hidden className="size-3.5" />
          {editing ? "Done" : "Correct this"}
        </button>
      </div>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-[12px] text-muted-foreground">What they need</dt>
          <dd className="text-[14px] leading-6 text-foreground">{thread.read.need}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-muted-foreground">What this response should achieve</dt>
          <dd className="text-[14px] leading-6 text-foreground">
            {editing ? (
              <TTInput
                value={achieve}
                onChange={(event) => setAchieve(event.target.value)}
                aria-label="What this response should achieve"
                className="mt-1"
              />
            ) : (
              achieve
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[12px] text-muted-foreground">Still open</dt>
          <dd className="text-[14px] leading-6 text-foreground">{thread.read.open}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-muted-foreground">Recommended next move</dt>
          <dd className="text-[14px] leading-6 text-foreground">
            {thread.read.move}{" "}
            <span className="text-muted-foreground">Why: {thread.read.because}</span>
          </dd>
        </div>
      </dl>
      {editing ? (
        <p className="mt-3 text-[12px] text-muted-foreground">
          Your correction wins over the read. In the built version this reruns the review without
          touching your draft.
        </p>
      ) : null}
    </Panel>
  );
}

function ThreadWorkspace({
  thread,
  onReview,
  onBack,
}: {
  thread: DemoThread;
  onReview: () => void;
  onBack: () => void;
}) {
  const [draft, setDraft] = useState(
    thread.messages.find((message) => message.role === "us")?.body ?? "",
  );

  return (
    <div className="min-w-0 space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground lg:hidden"
      >
        <ArrowLeft aria-hidden className="size-4" /> Back to list
      </button>

      <div>
        <h2 className="text-[20px] font-semibold text-foreground">{thread.subject}</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {thread.person}, {thread.title} at {thread.company} · {thread.channel} ·{" "}
          {thread.messageCount} messages, newest loaded first
        </p>
      </div>

      {thread.priority ? (
        <Panel className="border-warning/30 bg-warning/8">
          <p className="text-[12px] text-warning">Why now</p>
          <p className="mt-1 text-[14px] leading-6 text-foreground">{thread.priority}</p>
          <TTButton size="sm" variant="secondary" className="mt-3" onClick={onReview}>
            Open review
          </TTButton>
        </Panel>
      ) : null}

      <MyRead thread={thread} />

      <div className="space-y-3">
        {thread.messages.map((message) => (
          <article
            key={message.id}
            className={cn(
              "rounded-xl border p-4",
              message.role === "us" ? "border-royal/25 bg-royal-wash/30" : "border-border bg-card",
            )}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[13px] font-medium text-foreground">{message.author}</p>
              <p className="text-[12px] text-muted-foreground">{message.at}</p>
            </div>
            <p className="mt-2 whitespace-pre-line text-[15px] leading-6 text-foreground">
              {message.body}
            </p>
            {message.late ? (
              <p className="mt-2 text-[12px] text-muted-foreground">
                Contains a question past character 900. It is counted in coverage.
              </p>
            ) : null}
          </article>
        ))}
      </div>

      <Panel>
        <p className="text-[13px] font-medium text-foreground">Your draft</p>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={5}
          aria-label="Your draft"
          className="mt-2 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[15px] leading-6 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <TTButton size="sm" onClick={onReview}>
            Review my draft
          </TTButton>
          <TTButton size="sm" variant="secondary" onClick={onReview}>
            Help me draft
          </TTButton>
          <span className="text-[12px] text-muted-foreground">
            Review never sends. A person approves, a person sends.
          </span>
        </div>
      </Panel>
    </div>
  );
}

/* --------------------------------- review --------------------------------- */

const STAGES = ["Reading context", "Checking coverage", "Reviewing draft", "Checking revision"];

function SourceRow({
  name,
  kind,
  state,
  note,
}: {
  name: string;
  kind: string;
  state: SourceState;
  note: string;
}) {
  const tone =
    state === "ready" ? "good" : state === "failed" || state === "unsupported" ? "risk" : "warn";
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 border-t border-border py-2.5 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <p className="truncate text-[14px] text-foreground">{name}</p>
        <p className="text-[13px] text-muted-foreground">{note}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Chip tone={kind === "File to send" ? "royal" : "neutral"}>{kind}</Chip>
        <Chip tone={tone}>{SOURCE_STATE_LABEL[state]}</Chip>
      </div>
    </li>
  );
}

function Finding({ finding }: { finding: DemoFinding }) {
  const [decision, setDecision] = useState<"open" | "accepted" | "kept">("open");
  const [reason, setReason] = useState("");

  return (
    <li className="rounded-lg border border-border bg-card p-3.5">
      <p className="text-[13px] italic text-muted-foreground">“{finding.excerpt}”</p>
      <p className="mt-1.5 text-[14px] leading-6 text-foreground">{finding.issue}</p>
      <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
        Why it matters: {finding.why}
      </p>
      {finding.replacement ? (
        <p className="mt-2 rounded-md border border-royal/25 bg-royal-wash px-3 py-2 text-[14px] leading-6 text-foreground">
          {finding.replacement}
          {finding.optional ? (
            <span className="ml-1 text-[12px] text-muted-foreground">
              Optional. Remove it freely.
            </span>
          ) : null}
        </p>
      ) : (
        <p className="mt-2 text-[13px] text-muted-foreground">
          No replacement proposed. Nothing in the record supports one.
        </p>
      )}
      <p className="mt-2 text-[12px] text-muted-foreground">Evidence: {finding.evidence}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <TTButton
          size="sm"
          variant={decision === "accepted" ? "primary" : "secondary"}
          onClick={() => setDecision("accepted")}
        >
          Accept
        </TTButton>
        <TTButton size="sm" variant="secondary" onClick={() => setDecision("open")}>
          Edit
        </TTButton>
        <TTButton
          size="sm"
          variant={decision === "kept" ? "primary" : "secondary"}
          onClick={() => setDecision("kept")}
        >
          Keep original
        </TTButton>
        {decision === "accepted" ? <Chip tone="good">Accepted</Chip> : null}
      </div>

      {decision === "kept" ? (
        <div className="mt-2.5">
          <TTInput
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why are you keeping the original?"
            aria-label="Reason for keeping the original"
          />
          <p className="mt-1 text-[12px] text-muted-foreground">
            The concern stays on record. Keeping the original does not clear it.
          </p>
        </div>
      ) : null}
    </li>
  );
}

function CoverageList() {
  const tone: Record<CoverageStatus, "good" | "warn" | "risk" | "neutral"> = {
    answered: "good",
    partly: "warn",
    missing: "risk",
    pending: "neutral",
  };
  return (
    <ul className="space-y-2">
      {DEMO_COVERAGE.map((entry) => (
        <li
          key={entry.id}
          className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border bg-card p-3"
        >
          <div className="min-w-0">
            <p className="text-[14px] leading-6 text-foreground">{entry.question}</p>
            <p className="text-[12px] text-muted-foreground">{entry.where}</p>
          </div>
          <Chip tone={tone[entry.status]}>{COVERAGE_LABEL[entry.status]}</Chip>
        </li>
      ))}
    </ul>
  );
}

function ReviewIntake({ onRun }: { onRun: () => void }) {
  const [recipient, setRecipient] = useState("Adaeze Obi, Northlight Care");
  const [sender, setSender] = useState("Sam (sales)");
  const [goal, setGoal] = useState("Answer her four questions so she can approve the launch date.");
  const [draft, setDraft] = useState("");

  return (
    <Panel>
      <p className="text-[13px] font-medium text-foreground">New review</p>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Four short steps. No CRM record is required to review a message.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-[13px] text-muted-foreground">
          Who is this for?
          <TTInput
            className="mt-1"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
          />
        </label>
        <label className="block text-[13px] text-muted-foreground">
          Who is sending it?
          <TTInput className="mt-1" value={sender} onChange={(e) => setSender(e.target.value)} />
        </label>
      </div>
      <label className="mt-3 block text-[13px] text-muted-foreground">
        What should this achieve?
        <TTInput className="mt-1" value={goal} onChange={(e) => setGoal(e.target.value)} />
      </label>
      <label className="mt-3 block text-[13px] text-muted-foreground">
        Your draft
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={4}
          placeholder="Paste your message, or attach the proposal to review."
          className="mt-1 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[15px] leading-6 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <TTButton size="sm" onClick={onRun}>
          Run review
        </TTButton>
        <span className="text-[12px] text-muted-foreground">
          Context files are never attached to the outgoing message.
        </span>
      </div>
    </Panel>
  );
}

function ReviewPanel() {
  const [stage, setStage] = useState(STAGES.length - 1);
  const [lineByLine, setLineByLine] = useState(false);
  const [intake, setIntake] = useState(false);

  const grouped = useMemo(() => {
    const order: FindingGroup[] = ["must_fix", "confirm", "suggestion"];
    return order.map((group) => ({
      group,
      findings: DEMO_FINDINGS.filter((finding) => finding.group === group),
    }));
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold text-foreground">Review</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Northlight Care, launch scope. Draft version 3, written by Sam.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TTButton size="sm" variant="secondary" onClick={() => setIntake((current) => !current)}>
            {intake ? "Close intake" : "New review"}
          </TTButton>
          <TTButton
            size="sm"
            variant="secondary"
            onClick={() => setLineByLine((current) => !current)}
            aria-pressed={lineByLine}
          >
            {lineByLine ? "Clean draft" : "Line by line"}
          </TTButton>
        </div>
      </div>

      {intake ? <ReviewIntake onRun={() => setIntake(false)} /> : null}

      <Panel className="border-destructive/30 bg-destructive/6">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="risk">
            <AlertTriangle aria-hidden className="size-3.5" /> Needs revision
          </Chip>
          <Chip tone="warn">Coverage incomplete</Chip>
          <Chip>Awaiting approval</Chip>
        </div>
        <p className="mt-3 text-[15px] leading-6 text-foreground">
          Three of her four questions are addressed. Ownership after go live is unanswered, the
          Friday promise has nothing behind it, and the proposal total does not match its line
          items. Two pages of the scanned PDF could not be read, so this review is not complete.
        </p>
        <p className="mt-2 text-[13px] text-muted-foreground">
          Ready for approval needs complete coverage, or a named reduced scope.
        </p>
      </Panel>

      <Panel>
        <p className="text-[13px] font-medium text-foreground">Progress</p>
        <ol className="mt-2 flex flex-wrap gap-2">
          {STAGES.map((label, index) => (
            <li key={label}>
              <button
                type="button"
                onClick={() => setStage(index)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                  index <= stage
                    ? "border-royal/35 bg-royal-wash text-royal"
                    : "border-border text-muted-foreground",
                )}
              >
                {label}
              </button>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[12px] text-muted-foreground">
          Real stages, no artificial waiting. You can keep editing while a run is open.
        </p>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
        <div className="min-w-0 space-y-4">
          {grouped.map((entry) => (
            <section key={entry.group}>
              <h3 className="text-[14px] font-semibold text-foreground">
                {FINDING_GROUP_LABEL[entry.group]}{" "}
                <span className="font-normal text-muted-foreground">{entry.findings.length}</span>
              </h3>
              <ul className={cn("mt-2 space-y-2", lineByLine && "border-l-2 border-royal/25 pl-3")}>
                {entry.findings.map((finding) => (
                  <Finding key={finding.id} finding={finding} />
                ))}
              </ul>
            </section>
          ))}
        </div>

        <aside className="space-y-4">
          <Panel>
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
              <CircleHelp aria-hidden className="size-4" /> Question coverage
            </p>
            <div className="mt-3">
              <CoverageList />
            </div>
          </Panel>

          <Panel>
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
              <FileText aria-hidden className="size-4" /> Source material
            </p>
            <ul className="mt-3">
              {DEMO_SOURCES.map((source) => (
                <SourceRow key={source.id} {...source} />
              ))}
            </ul>
            <p className="mt-3 text-[12px] text-muted-foreground">
              Unread material stays visibly unread. Nothing is guessed from a filename.
            </p>
          </Panel>

          <Panel>
            <p className="text-[13px] font-medium text-foreground">Approval</p>
            <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
              Approval binds to this sender, these recipients, this body version and the context
              read. Any edit, or a new reply arriving, makes it stale.
            </p>
            <TTButton size="sm" className="mt-3" disabled>
              Approve
            </TTButton>
            <p className="mt-1.5 text-[12px] text-muted-foreground">
              Disabled here: this prototype never sends.
            </p>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

/* -------------------------------- follow-ups ------------------------------- */

function FollowUps() {
  const [done, setDone] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[20px] font-semibold text-foreground">Follow-ups</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          What was agreed with a person, and what the system is only suggesting. The two never look
          the same.
        </p>
      </div>

      <ul className="space-y-2">
        {DEMO_FOLLOWUPS.filter((entry) => !dismissed.includes(entry.id)).map((entry) => (
          <li key={entry.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p
                className={cn(
                  "text-[15px] leading-6 text-foreground",
                  done.includes(entry.id) && "line-through opacity-60",
                )}
              >
                {entry.what}
              </p>
              <Chip tone={entry.origin === "Agreed with the client" ? "royal" : "neutral"}>
                {entry.origin}
              </Chip>
            </div>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {entry.who} · {entry.when} · {entry.thread}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <TTButton
                size="sm"
                variant="secondary"
                onClick={() => setDone((current) => [...current, entry.id])}
              >
                <Check aria-hidden className="size-4" /> Mark complete
              </TTButton>
              <TTButton size="sm" variant="quiet">
                Snooze
              </TTButton>
              <TTButton
                size="sm"
                variant="quiet"
                onClick={() => setDismissed((current) => [...current, entry.id])}
              >
                Dismiss
              </TTButton>
            </div>
          </li>
        ))}
      </ul>

      <Panel className="border-royal/25">
        <p className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
          <Lightbulb aria-hidden className="size-4" /> Possible opportunity, kept private
        </p>
        <p className="mt-1.5 text-[14px] leading-6 text-foreground">
          {DEMO_OPPORTUNITY.observation}
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Timing: {DEMO_OPPORTUNITY.timing} · Smallest useful step: {DEMO_OPPORTUNITY.step}
        </p>
        <div className="mt-3 flex gap-2">
          <TTButton size="sm" variant="secondary">
            Keep for later
          </TTButton>
          <TTButton size="sm" variant="quiet">
            Dismiss
          </TTButton>
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">
          This never writes itself into a client reply.
        </p>
      </Panel>
    </div>
  );
}

/* -------------------------------- workspace -------------------------------- */

export function CommsNextWorkspace() {
  const [view, setView] = useState<View>("conversations");
  const [mode, setMode] = useState<"threads" | "people">("threads");
  const [filter, setFilter] = useState<ThreadState | "all">("all");
  const [selectedId, setSelectedId] = useState(DEMO_THREADS[0]?.id ?? "");
  const [showDetailOnMobile, setShowDetailOnMobile] = useState(false);

  const threads = useMemo(
    () =>
      filter === "all" ? DEMO_THREADS : DEMO_THREADS.filter((thread) => thread.state === filter),
    [filter],
  );
  const selected = DEMO_THREADS.find((thread) => thread.id === selectedId) ?? DEMO_THREADS[0]!;

  const TABS: { id: View; label: string }[] = [
    { id: "conversations", label: "Conversations" },
    { id: "review", label: "Review" },
    { id: "followups", label: "Follow-ups" },
  ];

  return (
    <div className="pb-20">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold leading-9 text-foreground sm:text-[36px]">
            Comms
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Understand the person, protect the promise, move the vision forward.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TTInput
            placeholder="Search conversations"
            aria-label="Search conversations"
            className="w-48"
          />
          <TTButton size="sm">New thread</TTButton>
          <TTButton size="sm" variant="quiet" aria-label="Settings">
            <Settings aria-hidden className="size-4" />
          </TTButton>
        </div>
      </header>

      <nav
        aria-label="Comms sections"
        className="mt-5 flex items-center gap-5 border-b border-border"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setView(tab.id)}
            aria-current={view === tab.id ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex h-10 items-center border-b-2 text-[14px] transition-colors",
              view === tab.id
                ? "border-royal font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="mt-6">
        {view === "conversations" ? (
          <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
            <div className={cn("min-w-0", showDetailOnMobile && "hidden lg:block")}>
              <ThreadList
                mode={mode}
                setMode={setMode}
                filter={filter}
                setFilter={setFilter}
                threads={threads}
                selectedId={selected.id}
                onSelect={(id) => {
                  setSelectedId(id);
                  setShowDetailOnMobile(true);
                }}
              />
            </div>
            <div className={cn("min-w-0", !showDetailOnMobile && "hidden lg:block")}>
              <ThreadWorkspace
                key={selected.id}
                thread={selected}
                onReview={() => setView("review")}
                onBack={() => setShowDetailOnMobile(false)}
              />
            </div>
          </div>
        ) : null}

        {view === "review" ? <ReviewPanel /> : null}
        {view === "followups" ? <FollowUps /> : null}
      </div>

      <footer className="mt-10 rounded-xl border border-border bg-secondary/50 p-4">
        <p className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
          <Sparkles aria-hidden className="size-4" /> What is simulated here
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-muted-foreground">
          <li>Every thread, person, finding and follow up is invented sample data.</li>
          <li>Review runs are scripted. No model is called and no run is recorded.</li>
          <li>Approve, send and save change local screen state only.</li>
          <li>File states are illustrative. Nothing is uploaded or extracted.</li>
          <li>No production Comms record is read, changed, or sent from this page.</li>
        </ul>
      </footer>
    </div>
  );
}
