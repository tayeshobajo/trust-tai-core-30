/**
 * The working tabs of the delivery room: work, blockers, decisions, files and
 * history. Each one asks for the smallest input that keeps the record honest.
 */

import { useState } from "react";
import { Download, FileText, Plus, Upload } from "lucide-react";

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
  type ProjectBlocker,
  type ProjectDecision,
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

/* --------------------------------------------------------------- blockers */

export function BlockersTab({
  blockers,
  busy,
  onRaise,
  onResolve,
}: {
  blockers: ProjectBlocker[];
  busy: boolean;
  onRaise: (reason: string, nextMove: string) => void;
  onResolve: (blocker: ProjectBlocker, resolution: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [nextMove, setNextMove] = useState("");

  return (
    <div className="space-y-5">
      <Panel title="Record a blocker">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!reason.trim()) return;
            onRaise(reason.trim(), nextMove.trim());
            setReason("");
            setNextMove("");
          }}
        >
          <TTInput
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="What is stopping this work?"
            aria-label="Blocker reason"
          />
          <TTInput
            value={nextMove}
            onChange={(event) => setNextMove(event.target.value)}
            placeholder="Next move to clear it (optional)"
            aria-label="Next move"
          />
          <TTButton type="submit" disabled={busy || !reason.trim()}>
            Record blocker
          </TTButton>
        </form>
      </Panel>

      {blockers.length === 0 ? (
        <Empty
          title="Nothing is blocked"
          body="When delivery stops, record why here so the reason and its age stay visible."
        />
      ) : (
        <ul className="space-y-3">
          {blockers.map((blocker) => (
            <li
              key={blocker.id}
              className={cn(
                "tt-surface p-5",
                blocker.status === "open" && "border-destructive/30 bg-destructive/[0.03]",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[15px] text-foreground">{blocker.reason}</p>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    {blocker.status === "open"
                      ? `Open for ${blockerAgeDays(blocker)} day${blockerAgeDays(blocker) === 1 ? "" : "s"}.`
                      : `Resolved. ${blocker.resolution ?? ""}`}{" "}
                    {blocker.nextMove ?? ""}
                  </p>
                </div>
                {blocker.status === "open" ? (
                  <TTButton
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      const resolution = window.prompt("How was it cleared?") ?? "";
                      onResolve(blocker, resolution);
                    }}
                  >
                    Mark resolved
                  </TTButton>
                ) : (
                  <MetaPill>Resolved</MetaPill>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- decisions */

export function DecisionsTab({
  decisions,
  busy,
  onAsk,
  onAnswer,
}: {
  decisions: ProjectDecision[];
  busy: boolean;
  onAsk: (question: string, whyItMatters: string) => void;
  onAnswer: (decision: ProjectDecision, answer: string) => void;
}) {
  const [question, setQuestion] = useState("");
  const [why, setWhy] = useState("");

  return (
    <div className="space-y-5">
      <Panel title="Ask for a decision">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!question.trim()) return;
            onAsk(question.trim(), why.trim());
            setQuestion("");
            setWhy("");
          }}
        >
          <TTInput
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="What needs a human answer?"
            aria-label="Decision question"
          />
          <TTInput
            value={why}
            onChange={(event) => setWhy(event.target.value)}
            placeholder="Why it matters (optional)"
            aria-label="Why it matters"
          />
          <TTButton type="submit" disabled={busy || !question.trim()}>
            Request decision
          </TTButton>
        </form>
      </Panel>

      {decisions.length === 0 ? (
        <Empty
          title="No decisions waiting"
          body="Questions that need human authority live here, separated from ordinary work."
        />
      ) : (
        <ul className="space-y-3">
          {decisions.map((decision) => (
            <li key={decision.id} className="tt-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[15px] text-foreground">{decision.question}</p>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    {decision.status === "open"
                      ? (decision.whyItMatters ?? "Waiting on an answer.")
                      : `Decided: ${decision.answer ?? "—"}`}
                  </p>
                </div>
                {decision.status === "open" ? (
                  <TTButton
                    size="sm"
                    variant="signal"
                    disabled={busy}
                    onClick={() => {
                      const answer = window.prompt(decision.question);
                      if (answer && answer.trim()) onAnswer(decision, answer.trim());
                    }}
                  >
                    Answer
                  </TTButton>
                ) : (
                  <MetaPill>Answered</MetaPill>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ files */

export function FilesTab({
  files,
  busy,
  onUpload,
  onOpen,
}: {
  files: ProjectFile[];
  busy: boolean;
  onUpload: (file: File, kind: ProjectFileKind) => void;
  onOpen: (file: ProjectFile, download: boolean) => void;
}) {
  const [kind, setKind] = useState<ProjectFileKind>("working");

  return (
    <div className="space-y-5">
      <Panel title="Add a file">
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
                  if (file) onUpload(file, kind);
                  event.target.value = "";
                }}
              />
            </label>
          </TTButton>
          <span className="text-[13px] text-muted-foreground">
            Files stay private to this organization.
          </span>
        </div>
      </Panel>

      {files.length === 0 ? (
        <Empty
          title="No files yet"
          body="Working files, deliverables and references for this milestone belong here."
        />
      ) : (
        <ul className="tt-surface divide-y divide-border">
          {files.map((file) => (
            <li key={file.id} className="flex flex-wrap items-center gap-3 p-4">
              <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] text-foreground">{file.name}</p>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {FILE_KIND_LABEL[file.kind]} · {new Date(file.createdAt).toLocaleDateString()}
                  {file.uploadedByLabel ? ` · ${file.uploadedByLabel}` : ""}
                </p>
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
