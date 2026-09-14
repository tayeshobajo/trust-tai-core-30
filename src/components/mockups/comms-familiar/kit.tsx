/**
 * MOCKUP ONLY — shared pieces for the three familiar Comms directions.
 *
 * Fixture data, local state, no service calls, nothing sends. Production Comms
 * components are deliberately not imported or modified here; only the shared
 * design primitives and tokens are reused so the directions look native.
 */

import { useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Check,
  Clock,
  Mail,
  Paperclip,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  UserPlus,
} from "lucide-react";

import { TTButton } from "@/components/tt/primitives";
import {
  DEMO_FOLLOWUPS,
  DEMO_OPPORTUNITY,
  DEMO_PEOPLE,
  DEMO_THREADS,
  FINDING_GROUP_LABEL,
  HEALTH_LABEL,
  SIMULATED_BEHAVIOUR,
  THREAD_STATE_LABEL,
  THREAD_STATE_MEANING,
  personById,
  type DemoFollowUp,
  type DemoPerson,
  type DemoThread,
  type ThreadState,
} from "@/data/mockups/comms-familiar";
import { cn } from "@/lib/utils";

/* --------------------------------- atoms --------------------------------- */

export function Chip({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
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

export function stateTone(state: ThreadState) {
  if (state === "needs_reply") return "warn" as const;
  if (state === "draft") return "royal" as const;
  if (state === "waiting") return "neutral" as const;
  return "good" as const;
}

export function Surface({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      className={cn("rounded-xl border border-border bg-card", className)}
      {...props}
    />
  );
}

export function PrototypeNote({ direction }: { direction: string }) {
  return (
    <details className="mb-5 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-[12px] text-warning">
      <summary className="cursor-pointer list-none">
        Prototype · {direction} · sample data only, nothing is sent or saved
      </summary>
      <ul className="mt-2 space-y-1 text-warning/90">
        {SIMULATED_BEHAVIOUR.map((line) => (
          <li key={line}>· {line}</li>
        ))}
      </ul>
    </details>
  );
}

/** The whole top-level navigation for a direction. Two or three words, no more. */
export function TopNav<T extends string>({
  items,
  active,
  onChange,
  onSettings,
  count,
}: {
  items: { id: T; label: string; badge?: number }[];
  active: T;
  onChange: (id: T) => void;
  onSettings: () => void;
  count?: string;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-px">
      <nav aria-label="Comms" className="flex items-center gap-5">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            aria-current={active === item.id ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex h-11 items-center gap-2 border-b-2 px-1 text-[15px] transition-colors",
              active === item.id
                ? "border-[var(--royal)] font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
            {item.badge ? (
              <span className="rounded-full bg-royal-wash px-1.5 text-[12px] text-royal">
                {item.badge}
              </span>
            ) : null}
          </button>
        ))}
      </nav>
      <div className="flex items-center gap-3 pb-2">
        {count ? <span className="text-[13px] text-muted-foreground">{count}</span> : null}
        <button
          type="button"
          onClick={onSettings}
          className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-[13px] text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <Settings className="size-4" aria-hidden />
          Settings
        </button>
      </div>
    </div>
  );
}

/** Voice DNA and Connections live here: findable, never competing with the work. */
export function SettingsSheet({ onClose }: { onClose: () => void }) {
  return (
    <Surface className="mb-4 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[17px] font-medium text-foreground">Comms preferences</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Set once, then forgotten. Nothing here is part of the daily job.
          </p>
        </div>
        <TTButton variant="quiet" size="sm" onClick={onClose}>
          Close
        </TTButton>
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {[
          {
            term: "How you sound",
            detail:
              "Your writing rules and approved examples. Drafts are held to these before you ever see them.",
            meta: "Version 4 · edited 3 days ago",
          },
          {
            term: "Connected mailboxes",
            detail:
              "Gmail for sam@ and tai@, reading only the threads you have labelled for Trust Tai.",
            meta: "2 connected · last read 6 minutes ago",
          },
        ].map((row) => (
          <div key={row.term} className="rounded-lg border border-border bg-secondary/40 p-3">
            <dt className="text-[14px] font-medium text-foreground">{row.term}</dt>
            <dd className="mt-1 text-[13px] text-muted-foreground">{row.detail}</dd>
            <dd className="mt-2 text-[12px] text-muted-foreground/80">{row.meta}</dd>
          </div>
        ))}
      </dl>
    </Surface>
  );
}

/* ------------------------------- thread list ------------------------------ */

export const THREAD_FILTERS: { id: ThreadState | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs_reply", label: "Needs reply" },
  { id: "waiting", label: "Waiting" },
  { id: "draft", label: "Drafts" },
  { id: "done", label: "Done" },
];

export function FilterRow({
  filter,
  onChange,
  threads,
}: {
  filter: ThreadState | "all";
  onChange: (next: ThreadState | "all") => void;
  threads: DemoThread[];
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {THREAD_FILTERS.map((entry) => {
        const count =
          entry.id === "all"
            ? threads.length
            : threads.filter((thread) => thread.state === entry.id).length;
        return (
          <button
            key={entry.id}
            type="button"
            onClick={() => onChange(entry.id)}
            aria-pressed={filter === entry.id}
            className={cn(
              "h-8 rounded-full border px-3 text-[13px] transition-colors",
              filter === entry.id
                ? "border-royal/40 bg-royal-wash text-royal"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {entry.label}
            <span className="ml-1.5 text-muted-foreground/70">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  return (
    <label className="flex h-10 items-center gap-2 rounded-lg border border-input bg-card px-3">
      <Search className="size-4 text-muted-foreground" aria-hidden />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-full w-full bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground"
      />
    </label>
  );
}

export function ThreadRow({
  thread,
  selected,
  onSelect,
}: {
  thread: DemoThread;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "w-full border-b border-border px-3 py-3 text-left transition-colors last:border-b-0",
        selected ? "bg-cloud-strong" : "hover:bg-secondary",
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span
          className={cn(
            "truncate text-[14px]",
            thread.unread ? "font-semibold text-foreground" : "text-foreground",
          )}
        >
          {thread.person}
        </span>
        <span className="shrink-0 text-[12px] text-muted-foreground">{thread.activity}</span>
      </div>
      <p className="mt-0.5 truncate text-[13px] text-foreground/90">{thread.subject}</p>
      <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{thread.preview}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Chip tone={stateTone(thread.state)}>{THREAD_STATE_LABEL[thread.state]}</Chip>
        <span className="text-[12px] text-muted-foreground">{thread.company}</span>
      </div>
    </button>
  );
}

export function ThreadList({
  threads,
  selectedId,
  onSelect,
  className,
}: {
  threads: DemoThread[];
  selectedId: string;
  onSelect: (id: string) => void;
  className?: string;
}) {
  if (threads.length === 0) {
    return (
      <Surface className={cn("p-4 text-[13px] text-muted-foreground", className)}>
        Nothing matches this filter. That is a real answer, not an empty screen.
      </Surface>
    );
  }
  return (
    <Surface className={cn("overflow-hidden", className)}>
      {threads.map((thread) => (
        <ThreadRow
          key={thread.id}
          thread={thread}
          selected={thread.id === selectedId}
          onSelect={() => onSelect(thread.id)}
        />
      ))}
    </Surface>
  );
}

/* ------------------------------ thread reading ----------------------------- */

function MyRead({ thread }: { thread: DemoThread }) {
  return (
    <div className="rounded-lg border border-royal/25 bg-royal-wash/60 p-3">
      <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-royal">
        <Sparkles className="size-4" aria-hidden />
        My read
      </p>
      <dl className="mt-2 space-y-2 text-[13px]">
        {[
          { term: "What they need", value: thread.read.need },
          { term: "Still open", value: thread.read.open },
          { term: "Next move", value: thread.read.move },
          { term: "Why", value: thread.read.because },
        ].map((row) => (
          <div key={row.term}>
            <dt className="text-muted-foreground">{row.term}</dt>
            <dd className="text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ReviewPanel({
  thread,
  onClose,
  onApprove,
  approved,
}: {
  thread: DemoThread;
  onClose: () => void;
  onApprove: () => void;
  approved: boolean;
}) {
  const mustFix = thread.findings.filter((finding) => finding.group === "must_fix");
  return (
    <div className="mt-3 rounded-lg border border-border bg-secondary/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="inline-flex items-center gap-1.5 text-[14px] font-medium text-foreground">
          <ShieldCheck className="size-4 text-royal" aria-hidden />
          Review of this draft
        </p>
        <TTButton variant="quiet" size="sm" onClick={onClose}>
          Hide
        </TTButton>
      </div>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {mustFix.length > 0
          ? `${mustFix.length} things would misfire if this went as written. Nothing sends until you decide.`
          : "Nothing must change. The send decision is still yours."}
      </p>
      <ul className="mt-3 space-y-2">
        {thread.findings.map((finding) => (
          <li key={finding.id} className="rounded-lg border border-border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Chip
                tone={
                  finding.group === "must_fix"
                    ? "risk"
                    : finding.group === "confirm"
                      ? "warn"
                      : "neutral"
                }
              >
                {FINDING_GROUP_LABEL[finding.group]}
              </Chip>
              <span className="text-[13px] italic text-muted-foreground">“{finding.excerpt}”</span>
            </div>
            <p className="mt-1.5 text-[13px] text-foreground">{finding.issue}</p>
            <p className="mt-1 text-[13px] text-muted-foreground">{finding.why}</p>
            {finding.replacement ? (
              <p className="mt-2 rounded border border-border bg-secondary/60 p-2 text-[13px] text-foreground">
                Suggested wording: {finding.replacement}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <TTButton size="sm" onClick={onApprove} disabled={approved}>
          {approved ? "Approved in this prototype" : "Approve this wording"}
        </TTButton>
        <span className="text-[12px] text-muted-foreground">
          Approving here changes this screen only. No message can leave a prototype.
        </span>
      </div>
    </div>
  );
}

/** The whole familiar job: read, reply, review, decide, without changing screens. */
export function ThreadPane({
  thread,
  onOpenPerson,
  compact,
}: {
  thread: DemoThread;
  onOpenPerson?: (personId: string) => void;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState(thread.draft ?? "");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [approved, setApproved] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const person = personById(thread.personId);

  return (
    <Surface className="flex min-h-0 flex-col p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <h2 className="text-[18px] font-medium text-foreground">{thread.subject}</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {thread.person} · {thread.title}, {thread.company} · {thread.channel} ·{" "}
            {thread.messageCount} messages
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={stateTone(thread.state)}>{THREAD_STATE_LABEL[thread.state]}</Chip>
          {onOpenPerson ? (
            <TTButton variant="secondary" size="sm" onClick={() => onOpenPerson(thread.personId)}>
              Open {person.name.split(" ")[0]}
            </TTButton>
          ) : null}
          <TTButton variant="quiet" size="sm" onClick={() => setSaved("scout")}>
            <UserPlus className="size-4" aria-hidden />
            Save to Scout
          </TTButton>
        </div>
      </header>

      <p className="mt-3 text-[13px] text-muted-foreground">
        {THREAD_STATE_MEANING[thread.state]}
      </p>
      {saved === "scout" ? (
        <p className="mt-2 text-[13px] text-royal">
          {person.company} would be handed to Scout from here. In this prototype nothing was saved.
        </p>
      ) : null}

      <div className="mt-3 space-y-3 overflow-auto">
        {thread.messages.map((message) => (
          <article
            key={message.id}
            className={cn(
              "rounded-lg border p-3",
              message.role === "us"
                ? "border-royal/20 bg-royal-wash/40"
                : "border-border bg-secondary/30",
            )}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px] font-medium text-foreground">{message.author}</span>
              <span className="text-[12px] text-muted-foreground">{message.at}</span>
            </div>
            <p className="mt-1.5 whitespace-pre-line text-[14px] leading-6 text-foreground">
              {message.body}
            </p>
          </article>
        ))}
      </div>

      {!compact ? <div className="mt-3">{<MyRead thread={thread} />}</div> : null}

      <div className="mt-4 rounded-lg border border-border bg-card p-3">
        <label
          htmlFor={`composer-${thread.id}`}
          className="text-[13px] font-medium text-foreground"
        >
          Your reply
        </label>
        <textarea
          id={`composer-${thread.id}`}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setApproved(false);
          }}
          rows={6}
          placeholder="Write to them the way you would anyway. Review is one click away."
          className="mt-2 w-full resize-y rounded-lg border border-input bg-card p-3 text-[14px] leading-6 text-foreground outline-none placeholder:text-muted-foreground"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <TTButton size="sm" variant="secondary" onClick={() => setReviewOpen(true)}>
            <ShieldCheck className="size-4" aria-hidden />
            Review before sending
          </TTButton>
          <TTButton size="sm" disabled={!approved}>
            <Send className="size-4" aria-hidden />
            Send
          </TTButton>
          <TTButton variant="quiet" size="sm">
            <Paperclip className="size-4" aria-hidden />
            Attach
          </TTButton>
          <TTButton variant="quiet" size="sm" onClick={() => setSaved("followup")}>
            <Clock className="size-4" aria-hidden />
            Remind me
          </TTButton>
          <span className="text-[12px] text-muted-foreground">
            {approved
              ? "Reviewed. A real send would still be your decision."
              : "Send stays closed until a human has read the review."}
          </span>
        </div>
        {saved === "followup" ? (
          <p className="mt-2 text-[13px] text-royal">
            A reminder for Friday would be kept against {person.name}. Prototype only.
          </p>
        ) : null}
        {reviewOpen ? (
          <ReviewPanel
            thread={thread}
            approved={approved}
            onApprove={() => setApproved(true)}
            onClose={() => setReviewOpen(false)}
          />
        ) : null}
      </div>
    </Surface>
  );
}

/* --------------------------------- people --------------------------------- */

export function healthTone(health: DemoPerson["health"]) {
  if (health === "slipping") return "risk" as const;
  if (health === "quiet") return "warn" as const;
  return "good" as const;
}

export function PersonRow({
  person,
  selected,
  onSelect,
}: {
  person: DemoPerson;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "w-full border-b border-border px-3 py-3 text-left transition-colors last:border-b-0",
        selected ? "bg-cloud-strong" : "hover:bg-secondary",
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[14px] font-medium text-foreground">{person.name}</span>
        <span className="shrink-0 text-[12px] text-muted-foreground">{person.lastTouch}</span>
      </div>
      <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
        {person.title}, {person.company}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Chip tone={healthTone(person.health)}>{HEALTH_LABEL[person.health]}</Chip>
        <span className="truncate text-[12px] text-muted-foreground">{person.healthNote}</span>
      </div>
    </button>
  );
}

export function PersonHeader({ person }: { person: DemoPerson }) {
  return (
    <div className="border-b border-border pb-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-medium text-foreground">{person.name}</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {person.title}, {person.company} · {person.email}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Chip tone={healthTone(person.health)}>{HEALTH_LABEL[person.health]}</Chip>
          <TTButton variant="quiet" size="sm">
            <UserPlus className="size-4" aria-hidden />
            Save to Scout
          </TTButton>
        </div>
      </div>
      <p className="mt-2 text-[13px] text-muted-foreground">{person.healthNote}</p>
    </div>
  );
}

export function RelationshipMemory({ person }: { person: DemoPerson }) {
  const opportunity =
    DEMO_OPPORTUNITY.personId === person.id ? DEMO_OPPORTUNITY : null;
  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-3">
      <p className="text-[13px] font-medium text-foreground">What we know about working with them</p>
      <ul className="mt-2 space-y-1.5 text-[13px] text-muted-foreground">
        {person.memory.map((line) => (
          <li key={line}>· {line}</li>
        ))}
      </ul>
      {opportunity ? (
        <div className="mt-3 rounded border border-royal/25 bg-royal-wash/50 p-2.5 text-[13px]">
          <p className="text-royal">Worth noticing</p>
          <p className="mt-1 text-foreground">{opportunity.observation}</p>
          <p className="mt-1 text-muted-foreground">
            {opportunity.timing} {opportunity.step}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function PersonThreads({
  person,
  onOpenThread,
}: {
  person: DemoPerson;
  onOpenThread: (threadId: string) => void;
}) {
  const threads = DEMO_THREADS.filter((thread) => thread.personId === person.id);
  return (
    <div className="space-y-2">
      {threads.map((thread) => (
        <button
          key={thread.id}
          type="button"
          onClick={() => onOpenThread(thread.id)}
          className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left hover:bg-secondary"
        >
          <span>
            <span className="text-[14px] text-foreground">{thread.subject}</span>
            <span className="mt-0.5 block text-[12px] text-muted-foreground">
              {thread.activity} · {thread.messageCount} messages
            </span>
          </span>
          <span className="flex items-center gap-2">
            <Chip tone={stateTone(thread.state)}>{THREAD_STATE_LABEL[thread.state]}</Chip>
            <ArrowUpRight className="size-4 text-muted-foreground" aria-hidden />
          </span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------- follow-ups ------------------------------- */

export function FollowUpList({
  onOpenThread,
  heading = "Needs attention",
  note = "Only what someone is actually waiting on. Everything else stays out of your way.",
}: {
  onOpenThread: (threadId: string) => void;
  heading?: string;
  note?: string;
}) {
  const [done, setDone] = useState<string[]>([]);
  const tone = (entry: DemoFollowUp) =>
    entry.dueTone === "overdue" ? "risk" : entry.dueTone === "today" ? "warn" : "neutral";
  return (
    <Surface className="p-4 sm:p-5">
      <h2 className="text-[16px] font-medium text-foreground">{heading}</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">{note}</p>
      <ul className="mt-3 space-y-2">
        {DEMO_FOLLOWUPS.map((entry) => (
          <li
            key={entry.id}
            className={cn(
              "rounded-lg border border-border bg-card p-3",
              done.includes(entry.id) && "opacity-60",
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={tone(entry)}>{entry.when}</Chip>
              <span className="text-[12px] text-muted-foreground">{entry.origin}</span>
            </div>
            <p className="mt-1.5 text-[14px] text-foreground">{entry.what}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <TTButton variant="secondary" size="sm" onClick={() => onOpenThread(entry.threadId)}>
                <Mail className="size-4" aria-hidden />
                Open the thread
              </TTButton>
              <TTButton
                variant="quiet"
                size="sm"
                onClick={() => setDone((prev) => [...prev, entry.id])}
              >
                <Check className="size-4" aria-hidden />
                Done
              </TTButton>
              <span className="text-[12px] text-muted-foreground">Owner: {entry.who}</span>
            </div>
          </li>
        ))}
      </ul>
    </Surface>
  );
}

/** The whole overview, said in one sentence instead of a dashboard. */
export function InlineSummary() {
  const needsReply = DEMO_THREADS.filter((thread) => thread.state === "needs_reply").length;
  const drafts = DEMO_THREADS.filter((thread) => thread.state === "draft").length;
  const overdue = DEMO_FOLLOWUPS.filter((entry) => entry.dueTone === "overdue").length;
  return (
    <p className="mb-3 text-[13px] text-muted-foreground">
      {needsReply} conversations are waiting on you, {drafts} draft needs a read before it can go,
      and {overdue} promise is already late. {DEMO_PEOPLE.length} people in the ledger.
    </p>
  );
}
