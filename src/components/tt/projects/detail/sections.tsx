/**
 * The working tabs of the delivery room: work, blockers, decisions, files and
 * history. Each one asks for the smallest input that keeps the record honest.
 */

import { useState } from "react";
import { Check, Download, FileText, Link as LinkIcon, Plus, Upload } from "lucide-react";

import { Panel } from "./overview";
import { MetaPill, TTButton, TTInput } from "@/components/tt/primitives";
import { blockerAgeDays, sortWorkItems } from "@/data/projects/detail-projection";
import type { ActivityEvent } from "@/domain/activity";
import {
  FILE_KINDS,
  FILE_KIND_LABEL,
  WORK_ITEM_STATUSES,
  WORK_ITEM_STATUS_LABEL,
  WORK_ITEM_STATUS_TONE,
  type BlockerInput,
  type ProjectBlocker,
  type ProjectDecision,
  type ProjectDecisionInput,
  type ProjectFile,
  type ProjectFileKind,
  type WorkItem,
  type WorkItemStatus,
} from "@/domain/project-delivery";
import { cn } from "@/lib/utils";

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="tt-surface p-8 text-center">
      <p className="font-display text-xl text-foreground">{title}</p>
      <p className="mx-auto mt-2 max-w-reading text-[14px] text-muted-foreground">{body}</p>
    </div>
  );
}

/* ------------------------------------------------------------------- work */

export function WorkTab({
  items,
  busy,
  onAdd,
  onMove,
}: {
  items: WorkItem[];
  busy: boolean;
  onAdd: (title: string) => void;
  onMove: (item: WorkItem, status: WorkItemStatus) => void;
}) {
  const [title, setTitle] = useState("");
  const ordered = sortWorkItems(items);

  return (
    <div className="space-y-5">
      <Panel title="Add work">
        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (!title.trim()) return;
            onAdd(title.trim());
            setTitle("");
          }}
        >
          <TTInput
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What needs doing?"
            aria-label="Work item"
          />
          <TTButton type="submit" disabled={busy || !title.trim()} className="shrink-0">
            <Plus aria-hidden />
            Add item
          </TTButton>
        </form>
      </Panel>

      {ordered.length === 0 ? (
        <Empty
          title="No work recorded"
          body="Delivery items belong here. Add the first one so this room can say what is moving."
        />
      ) : (
        <ul className="tt-surface divide-y divide-border">
          {ordered.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] text-foreground">{item.title}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[13px] text-muted-foreground">
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]",
                      WORK_ITEM_STATUS_TONE[item.status],
                    )}
                  >
                    {WORK_ITEM_STATUS_LABEL[item.status]}
                  </span>
                  {item.ownerLabel ? <span>{item.ownerLabel}</span> : null}
                  {item.dueDate ? (
                    <span>Due {new Date(item.dueDate).toLocaleDateString()}</span>
                  ) : null}
                </p>
              </div>
              <label className="sr-only" htmlFor={`status-${item.id}`}>
                Status for {item.title}
              </label>
              <select
                id={`status-${item.id}`}
                value={item.status}
                disabled={busy}
                onChange={(event) => onMove(item, event.target.value as WorkItemStatus)}
                className="h-10 rounded-lg border border-input bg-card px-3 text-[13px] text-foreground"
              >
                {WORK_ITEM_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {WORK_ITEM_STATUS_LABEL[status]}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* --------------------------------------------------- shared small pieces */

function WorkItemSelect({
  items,
  value,
  onChange,
  id,
  label,
}: {
  items: WorkItem[];
  value: string;
  onChange: (value: string) => void;
  id: string;
  label: string;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-lg border border-input bg-card px-3 text-[13px] text-foreground"
      >
        <option value="">{label} · not linked to one item</option>
        {sortWorkItems(items).map((item) => (
          <option key={item.id} value={item.id}>
            {item.title}
          </option>
        ))}
      </select>
    </div>
  );
}

function LinkedWork({
  items,
  workItemId,
}: {
  items: WorkItem[];
  workItemId?: string | undefined;
}) {
  const item = workItemId ? items.find((entry) => entry.id === workItemId) : undefined;
  if (!item) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
      <LinkIcon aria-hidden className="size-3.5" />
      {item.title}
      <span
        className={cn(
          "rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]",
          WORK_ITEM_STATUS_TONE[item.status],
        )}
      >
        {WORK_ITEM_STATUS_LABEL[item.status]}
      </span>
    </span>
  );
}

/* --------------------------------------------------------------- blockers */

export function BlockersTab({
  items,
  blockers,
  busy,
  onRaise,
  onResolve,
}: {
  items: WorkItem[];
  blockers: ProjectBlocker[];
  busy: boolean;
  onRaise: (input: BlockerInput) => void;
  onResolve: (blocker: ProjectBlocker, resolution: string, resumeWork: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const [nextMove, setNextMove] = useState("");
  const [impact, setImpact] = useState("");
  const [owner, setOwner] = useState("");
  const [workItemId, setWorkItemId] = useState("");
  const [resolving, setResolving] = useState<string | null>(null);
  const [resolution, setResolution] = useState("");
  const [resumeWork, setResumeWork] = useState(true);

  const open = blockers.filter((entry) => entry.status === "open");
  const cleared = blockers.filter((entry) => entry.status === "resolved");

  const startResolve = (blocker: ProjectBlocker) => {
    setResolving(blocker.id);
    setResolution("");
    setResumeWork(Boolean(blocker.workItemId));
  };

  return (
    <div className="space-y-5">
      <Panel title="Record a blocker">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!reason.trim()) return;
            onRaise({
              reason: reason.trim(),
              ...(impact.trim() ? { impact: impact.trim() } : {}),
              ...(owner.trim() ? { ownerLabel: owner.trim() } : {}),
              ...(nextMove.trim() ? { nextMove: nextMove.trim() } : {}),
              ...(workItemId ? { workItemId } : {}),
            });
            setReason("");
            setNextMove("");
            setImpact("");
            setOwner("");
            setWorkItemId("");
          }}
        >
          <TTInput
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="What is stopping this work?"
            aria-label="Blocker reason"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <TTInput
              value={impact}
              onChange={(event) => setImpact(event.target.value)}
              placeholder="What it costs us (optional)"
              aria-label="Impact"
            />
            <TTInput
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              placeholder="Who owns clearing it (optional)"
              aria-label="Blocker owner"
            />
          </div>
          <TTInput
            value={nextMove}
            onChange={(event) => setNextMove(event.target.value)}
            placeholder="Next move to clear it (optional)"
            aria-label="Next move"
          />
          <WorkItemSelect
            id="blocker-work-item"
            label="Work item this blocks"
            items={items}
            value={workItemId}
            onChange={setWorkItemId}
          />
          <TTButton type="submit" disabled={busy || !reason.trim()}>
            Record blocker
          </TTButton>
          <p className="text-[13px] text-muted-foreground">
            A blocker is delivery truth. It never changes the roadmap; it says why this milestone is
            not moving.
          </p>
        </form>
      </Panel>

      {blockers.length === 0 ? (
        <Empty
          title="Nothing is blocked"
          body="When delivery stops, record why here so the reason and its age stay visible."
        />
      ) : (
        <ul className="space-y-3">
          {[...open, ...cleared].map((blocker) => (
            <li
              key={blocker.id}
              className={cn(
                "tt-surface p-5",
                blocker.status === "open" && "border-destructive/30 bg-destructive/[0.03]",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="text-[15px] text-foreground">{blocker.reason}</p>
                  <p className="text-[13px] text-muted-foreground">
                    {blocker.status === "open"
                      ? `Open for ${blockerAgeDays(blocker)} day${blockerAgeDays(blocker) === 1 ? "" : "s"}.`
                      : `Cleared ${blocker.resolvedAt ? new Date(blocker.resolvedAt).toLocaleDateString() : ""}. ${blocker.resolution ?? ""}`}
                    {blocker.impact ? ` ${blocker.impact}` : ""}
                    {blocker.status === "open" && blocker.nextMove ? ` ${blocker.nextMove}` : ""}
                    {blocker.ownerLabel ? ` · ${blocker.ownerLabel}` : ""}
                  </p>
                  <LinkedWork items={items} workItemId={blocker.workItemId} />
                </div>
                {blocker.status === "open" ? (
                  <TTButton
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      resolving === blocker.id ? setResolving(null) : startResolve(blocker)
                    }
                  >
                    <Check aria-hidden />
                    {resolving === blocker.id ? "Cancel" : "Resolve"}
                  </TTButton>
                ) : (
                  <MetaPill>Resolved</MetaPill>
                )}
              </div>

              {resolving === blocker.id ? (
                <form
                  className="mt-4 space-y-3 border-t border-border pt-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!resolution.trim()) return;
                    onResolve(blocker, resolution.trim(), resumeWork);
                    setResolving(null);
                    setResolution("");
                  }}
                >
                  <TTInput
                    autoFocus
                    value={resolution}
                    onChange={(event) => setResolution(event.target.value)}
                    placeholder="How was it cleared?"
                    aria-label={`Resolution for ${blocker.reason}`}
                  />
                  {blocker.workItemId ? (
                    <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={resumeWork}
                        onChange={(event) => setResumeWork(event.target.checked)}
                        className="size-4 rounded border-input"
                      />
                      Put the linked work item back in progress
                    </label>
                  ) : null}
                  <TTButton type="submit" size="sm" disabled={busy || !resolution.trim()}>
                    Mark resolved
                  </TTButton>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- decisions */

export function DecisionsTab({
  items,
  decisions,
  busy,
  onAsk,
  onAnswer,
}: {
  items: WorkItem[];
  decisions: ProjectDecision[];
  busy: boolean;
  onAsk: (input: ProjectDecisionInput) => void;
  onAnswer: (decision: ProjectDecision, answer: string) => void;
}) {
  const [question, setQuestion] = useState("");
  const [why, setWhy] = useState("");
  const [owner, setOwner] = useState("");
  const [workItemId, setWorkItemId] = useState("");
  const [answering, setAnswering] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");

  const open = decisions.filter((entry) => entry.status === "open");
  const answered = decisions.filter((entry) => entry.status === "answered");

  return (
    <div className="space-y-5">
      <Panel title="Ask for a decision">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!question.trim()) return;
            onAsk({
              question: question.trim(),
              ...(why.trim() ? { whyItMatters: why.trim() } : {}),
              ...(owner.trim() ? { ownerLabel: owner.trim() } : {}),
              ...(workItemId ? { workItemId } : {}),
            });
            setQuestion("");
            setWhy("");
            setOwner("");
            setWorkItemId("");
          }}
        >
          <TTInput
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="What needs a human answer?"
            aria-label="Decision question"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <TTInput
              value={why}
              onChange={(event) => setWhy(event.target.value)}
              placeholder="Why it matters (optional)"
              aria-label="Why it matters"
            />
            <TTInput
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              placeholder="Who should answer (optional)"
              aria-label="Decision owner"
            />
          </div>
          <WorkItemSelect
            id="decision-work-item"
            label="Work item this holds up"
            items={items}
            value={workItemId}
            onChange={setWorkItemId}
          />
          <TTButton type="submit" disabled={busy || !question.trim()}>
            Request decision
          </TTButton>
          <p className="text-[13px] text-muted-foreground">
            Delivery decisions only. Direction still belongs to Roadmap, and nothing here rewrites
            it.
          </p>
        </form>
      </Panel>

      {decisions.length === 0 ? (
        <Empty
          title="No decisions waiting"
          body="Questions that need human authority live here, separated from ordinary work."
        />
      ) : (
        <ul className="space-y-3">
          {[...open, ...answered].map((decision) => (
            <li key={decision.id} className="tt-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="text-[15px] text-foreground">{decision.question}</p>
                  <p className="text-[13px] text-muted-foreground">
                    {decision.status === "open"
                      ? (decision.whyItMatters ?? "Waiting on an answer.")
                      : `Decided ${decision.decidedAt ? new Date(decision.decidedAt).toLocaleDateString() : ""}: ${decision.answer ?? "-"}`}
                    {decision.ownerLabel ? ` · ${decision.ownerLabel}` : ""}
                  </p>
                  <LinkedWork items={items} workItemId={decision.workItemId} />
                </div>
                {decision.status === "open" ? (
                  <TTButton
                    size="sm"
                    variant="signal"
                    disabled={busy}
                    onClick={() => {
                      setAnswering(answering === decision.id ? null : decision.id);
                      setAnswer("");
                    }}
                  >
                    {answering === decision.id ? "Cancel" : "Record the decision"}
                  </TTButton>
                ) : (
                  <MetaPill>Answered</MetaPill>
                )}
              </div>

              {answering === decision.id ? (
                <form
                  className="mt-4 space-y-3 border-t border-border pt-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!answer.trim()) return;
                    onAnswer(decision, answer.trim());
                    setAnswering(null);
                    setAnswer("");
                  }}
                >
                  <TTInput
                    autoFocus
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    placeholder="What was decided, in one sentence"
                    aria-label={`Answer for ${decision.question}`}
                  />
                  <TTButton type="submit" size="sm" disabled={busy || !answer.trim()}>
                    Save decision
                  </TTButton>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ files */

export function FilesTab({
  items,
  files,
  busy,
  onUpload,
  onOpen,
}: {
  items: WorkItem[];
  files: ProjectFile[];
  busy: boolean;
  onUpload: (file: File, kind: ProjectFileKind, workItemId?: string) => void;
  onOpen: (file: ProjectFile, download: boolean) => void;
}) {
  const [kind, setKind] = useState<ProjectFileKind>("working");
  const [workItemId, setWorkItemId] = useState("");
  const [filter, setFilter] = useState<ProjectFileKind | "all">("all");

  const visible = filter === "all" ? files : files.filter((file) => file.kind === filter);

  return (
    <div className="space-y-5">
      <Panel title="Add a file">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="sr-only" htmlFor="file-kind">
              File kind
            </label>
            <select
              id="file-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as ProjectFileKind)}
              className="h-11 rounded-lg border border-input bg-card px-3 text-[13px] text-foreground"
            >
              {FILE_KINDS.map((entry) => (
                <option key={entry} value={entry}>
                  {FILE_KIND_LABEL[entry]}
                </option>
              ))}
            </select>
            <TTButton asChild variant="secondary" className="cursor-pointer">
              <label>
                <Upload aria-hidden />
                Choose file
                <input
                  type="file"
                  className="sr-only"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onUpload(file, kind, workItemId || undefined);
                    event.target.value = "";
                  }}
                />
              </label>
            </TTButton>
            <span className="text-[13px] text-muted-foreground">
              Files stay private to this organization and open through short-lived links.
            </span>
          </div>
          <WorkItemSelect
            id="file-work-item"
            label="Work item this belongs to"
            items={items}
            value={workItemId}
            onChange={setWorkItemId}
          />
        </div>
      </Panel>

      {files.length === 0 ? (
        <Empty
          title="No files yet"
          body="Working files, deliverables and references for this milestone belong here."
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {(["all", ...FILE_KINDS] as const).map((entry) => (
              <TTButton
                key={entry}
                size="sm"
                variant={filter === entry ? "secondary" : "quiet"}
                onClick={() => setFilter(entry)}
              >
                {entry === "all" ? "Everything" : FILE_KIND_LABEL[entry]}
                <span className="ml-1 text-muted-foreground">
                  {entry === "all"
                    ? files.length
                    : files.filter((file) => file.kind === entry).length}
                </span>
              </TTButton>
            ))}
          </div>

          <ul className="tt-surface divide-y divide-border">
            {visible.map((file) => (
              <li key={file.id} className="flex flex-wrap items-center gap-3 p-4">
                <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] text-foreground">{file.name}</p>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    {FILE_KIND_LABEL[file.kind]} · {new Date(file.createdAt).toLocaleDateString()}
                    {file.uploadedByLabel ? ` · ${file.uploadedByLabel}` : ""}
                    {file.sizeBytes ? ` · ${Math.max(1, Math.round(file.sizeBytes / 1024))} KB` : ""}
                  </p>
                  <LinkedWork items={items} workItemId={file.workItemId} />
                </div>
                <TTButton size="sm" variant="secondary" onClick={() => onOpen(file, false)}>
                  Open
                </TTButton>
                <TTButton size="sm" variant="quiet" onClick={() => onOpen(file, true)}>
                  <Download aria-hidden />
                  Download
                </TTButton>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- activity */

export function ActivityTab({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) {
    return (
      <Empty
        title="No history yet"
        body="Every change made in this room is recorded here with who made it and when."
      />
    );
  }
  return (
    <ol className="tt-surface divide-y divide-border">
      {events.map((event) => (
        <li key={event.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 p-4">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            {new Date(event.occurredAt).toLocaleString()}
          </span>
          <span className="min-w-0 flex-1 text-[15px] text-foreground">{event.summary}</span>
          <span className="text-[13px] text-muted-foreground">
            {event.provenance.actor.label ?? event.provenance.appId}
          </span>
        </li>
      ))}
    </ol>
  );
}
