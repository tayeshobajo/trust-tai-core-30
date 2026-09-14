/**
 * MOCKUP ONLY — conversation mode. One header, history on demand, an editable
 * working goal, a compact next step, and the reply editor with its primary
 * action inside the first screen. Nothing sends.
 */

import { useState } from "react";
import { ChevronDown, Paperclip, FileText } from "lucide-react";

import type { V2Thread } from "@/data/mockups/comms-workspace-v2";
import { WORK_STATE_LABEL } from "@/data/mockups/comms-workspace-v2";

export function ConversationWorkspace({
  thread,
  draft,
  goal,
  onGoal,
  onDraft,
  onReview,
  onOpenPerson,
  onOpenContext,
  humourOn,
  onHumour,
}: {
  thread: V2Thread;
  draft: string;
  goal: string;
  onGoal: (value: string) => void;
  onDraft: (value: string) => void;
  onReview: () => void;
  onOpenPerson: () => void;
  onOpenContext: () => void;
  humourOn: boolean;
  onHumour: (value: boolean) => void;
}) {
  const [showEarlier, setShowEarlier] = useState(false);
  const [editingGoal, setEditingGoal] = useState(false);

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      {/* Header, stated once. */}
      <header className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border px-5 py-3.5">
        <button
          type="button"
          onClick={onOpenPerson}
          className="font-display text-[17px] font-semibold tracking-tight underline-offset-4 hover:underline"
        >
          {thread.person}
        </button>
        <span className="text-[13px] text-muted-foreground">{thread.company}</span>
        <span className="w-full text-[14px] text-muted-foreground sm:w-auto sm:before:mr-3 sm:before:content-['·']">
          {thread.subject}
        </span>
        <span className="ml-auto text-[12px] text-muted-foreground">
          {WORK_STATE_LABEL[thread.state]} · {thread.owner} · {thread.channel}
        </span>
      </header>

      {/* Thread, scrolling independently of the page. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <button
          type="button"
          onClick={() => setShowEarlier((value) => !value)}
          aria-expanded={showEarlier}
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown
            aria-hidden
            className={`size-4 transition-transform duration-150 motion-reduce:transition-none ${showEarlier ? "rotate-180" : ""}`}
          />
          Earlier messages · {thread.earlierCount}
        </button>
        {showEarlier ? (
          <p className="mt-2 border-l-2 border-border pl-3 text-[13px] text-muted-foreground">
            Earlier history is sample content in this prototype and is not rendered.
          </p>
        ) : null}

        <div className="mt-4 space-y-5">
          {thread.messages.map((message) => (
            <article key={message.id}>
              <p className="text-[12px] text-muted-foreground">
                {message.author} · {message.at}
              </p>
              <p className="mt-1 whitespace-pre-line text-[15px] leading-[1.65]">{message.body}</p>
            </article>
          ))}
        </div>

        <button
          type="button"
          onClick={onOpenContext}
          className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <FileText aria-hidden className="size-4" />
          Source material
        </button>
      </div>

      {/* Working goal, next step, editor. All above the fold at 900px. */}
      <div className="shrink-0 border-t border-border px-5 py-3">
        <div className="flex items-start gap-2">
          <span className="mt-1 shrink-0 text-[12px] uppercase tracking-[0.08em] text-muted-foreground">
            Goal
          </span>
          {editingGoal ? (
            <input
              autoFocus
              value={goal}
              onChange={(event) => onGoal(event.target.value)}
              onBlur={() => setEditingGoal(false)}
              aria-label="What should this achieve?"
              className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingGoal(true)}
              className="text-left text-[14px] leading-snug underline-offset-4 hover:underline"
            >
              {goal}
            </button>
          )}
        </div>
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          <span className="text-foreground">Next.</span> {thread.nextStep}{" "}
          <button
            type="button"
            onClick={onOpenContext}
            className="underline underline-offset-4 hover:text-foreground"
          >
            {thread.nextStepSource}
          </button>
        </p>

        {thread.humour ? (
          <label className="mt-2 flex items-start gap-2 text-[13px] text-muted-foreground">
            <input
              type="checkbox"
              checked={humourOn}
              onChange={(event) => onHumour(event.target.checked)}
              className="mt-1"
            />
            <span>
              Light touch: <span className="text-foreground">“{thread.humour.line}”</span>{" "}
              {thread.humour.note}
            </span>
          </label>
        ) : null}

        <textarea
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          rows={5}
          aria-label="Your reply"
          placeholder="Write your reply, or paste one written elsewhere."
          className="mt-2.5 w-full resize-none rounded-lg border border-border bg-card px-3.5 py-3 text-[15px] leading-[1.65] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        <div className="mt-2.5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onOpenContext}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] transition-colors hover:border-[var(--royal)]"
          >
            <FileText aria-hidden className="size-4" />
            Add context
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] text-muted-foreground transition-colors hover:border-[var(--royal)] hover:text-foreground"
          >
            <Paperclip aria-hidden className="size-4" />
            Attach to send
          </button>
          <span className="text-[12px] text-muted-foreground">
            Context is read for the review. Attachments go to the recipient.
          </span>
          <button
            type="button"
            onClick={onReview}
            disabled={!draft.trim()}
            className="ml-auto inline-flex h-10 items-center rounded-lg bg-[var(--royal)] px-4 text-[14px] font-medium text-primary-foreground transition-colors duration-150 hover:opacity-90 disabled:opacity-50 motion-reduce:transition-none"
          >
            Review draft
          </button>
        </div>
      </div>
    </div>
  );
}
