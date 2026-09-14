/**
 * MOCKUP ONLY — New review intake. A focused in-place workspace for work that
 * did not start in Gmail: pasted WhatsApp or LinkedIn text, a proposal written
 * elsewhere, or a new outbound message with a stated goal and no inbound
 * source at all. Local state only.
 */

import { useState } from "react";
import { ArrowLeft, FileText, Paperclip } from "lucide-react";

import { V2_CONTEXT_FILES, V2_INTAKE_SAMPLE } from "@/data/mockups/comms-workspace-v2";

export function ReviewIntake({
  context,
  draft,
  recipient,
  goal,
  onContext,
  onDraft,
  onRecipient,
  onGoal,
  onBack,
  onReview,
}: {
  context: string;
  draft: string;
  recipient: string;
  goal: string;
  onContext: (value: string) => void;
  onDraft: (value: string) => void;
  onRecipient: (value: string) => void;
  onGoal: (value: string) => void;
  onBack: () => void;
  onReview: () => void;
}) {
  const [extras, setExtras] = useState(false);
  const [files, setFiles] = useState(V2_CONTEXT_FILES);

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3.5">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Back
        </button>
        <h2 className="font-display text-[17px] font-semibold tracking-tight">New review</h2>
        <span className="ml-auto text-[12px] text-muted-foreground">
          Nothing typed here is lost when you switch views.
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="grid gap-5 lg:grid-cols-2">
          <section>
            <h3 className="text-[14px] font-medium">What are we responding to?</h3>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Paste an email, a WhatsApp or LinkedIn message, or notes. Optional — a new outbound
              message only needs a goal.
            </p>
            <textarea
              value={context}
              onChange={(event) => onContext(event.target.value)}
              rows={10}
              aria-label="What are we responding to?"
              placeholder="Paste the message or notes here."
              className="mt-2 w-full resize-y rounded-lg border border-border bg-[var(--cloud)] px-3.5 py-3 text-[15px] leading-[1.6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onContext(V2_INTAKE_SAMPLE.context)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] transition-colors hover:border-[var(--royal)]"
              >
                <FileText aria-hidden className="size-4" />
                Paste sample message
              </button>
              <span className="text-[12px] text-muted-foreground">
                Context files are read for the review and never sent.
              </span>
            </div>
            <ul className="mt-2 space-y-1.5">
              {files.map((file) => (
                <li key={file.id} className="border-b border-border pb-1.5 last:border-0">
                  <p className="text-[13px] font-medium">
                    {file.name} <span className="font-normal text-muted-foreground">· {file.size}</span>
                  </p>
                  <p
                    className={
                      file.status === "unread"
                        ? "text-[12px] text-[var(--danger)]"
                        : "text-[12px] text-muted-foreground"
                    }
                  >
                    {file.note}
                  </p>
                </li>
              ))}
            </ul>
            {files.length === V2_CONTEXT_FILES.length ? null : (
              <button
                type="button"
                onClick={() => setFiles(V2_CONTEXT_FILES)}
                className="mt-2 text-[13px] text-muted-foreground hover:text-foreground"
              >
                Add sample context files
              </button>
            )}
          </section>

          <section>
            <h3 className="text-[14px] font-medium">Your draft</h3>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Paste or upload the email, message or proposal you intend to send.
            </p>
            <textarea
              value={draft}
              onChange={(event) => onDraft(event.target.value)}
              rows={10}
              aria-label="Your draft"
              placeholder="Paste your draft here."
              className="mt-2 w-full resize-y rounded-lg border border-border bg-card px-3.5 py-3 text-[15px] leading-[1.6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onDraft(V2_INTAKE_SAMPLE.draft)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] transition-colors hover:border-[var(--royal)]"
              >
                <Paperclip aria-hidden className="size-4" />
                Upload sample proposal
              </button>
              <span className="text-[12px] text-muted-foreground">
                Markdown and text are read. PDFs are reported unread, never guessed at.
              </span>
            </div>
          </section>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:max-w-3xl">
          <label className="block">
            <span className="text-[13px] font-medium">Recipient or client</span>
            <input
              value={recipient}
              onChange={(event) => onRecipient(event.target.value)}
              placeholder="Who is this going to?"
              className="mt-1 h-10 w-full rounded-lg border border-border bg-card px-3 text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <label className="block">
            <span className="text-[13px] font-medium">What should this achieve?</span>
            <input
              value={goal}
              onChange={(event) => onGoal(event.target.value)}
              placeholder="One line is enough."
              className="mt-1 h-10 w-full rounded-lg border border-border bg-card px-3 text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        </div>

        <button
          type="button"
          onClick={() => setExtras((value) => !value)}
          aria-expanded={extras}
          className="mt-3 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {extras ? "Hide owner and channel" : "Owner and channel"}
        </button>
        {extras ? (
          <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:max-w-3xl">
            <label className="block">
              <span className="text-[13px] font-medium">Owner</span>
              <input
                defaultValue="Sam Oyelaran"
                className="mt-1 h-10 w-full rounded-lg border border-border bg-card px-3 text-[14px]"
              />
            </label>
            <label className="block">
              <span className="text-[13px] font-medium">Channel</span>
              <select className="mt-1 h-10 w-full rounded-lg border border-border bg-card px-2.5 text-[14px]">
                <option>Email</option>
                <option>WhatsApp</option>
                <option>LinkedIn</option>
              </select>
            </label>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t border-border px-5 py-3">
        <span className="text-[12px] text-muted-foreground">
          Review reads the context and the draft. It never sends anything.
        </span>
        <button
          type="button"
          onClick={onReview}
          disabled={!draft.trim()}
          className="ml-auto inline-flex h-10 items-center rounded-lg bg-[var(--royal)] px-4 text-[14px] font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50"
        >
          Review draft
        </button>
      </div>
    </div>
  );
}
