/**
 * Project Chat.
 *
 * Chat is how a person talks to the project. Projects remains where project
 * truth lives, so nothing said here becomes the record on its own. A message
 * can be answered from this project's context packet, or it can prepare one
 * bounded change: the field, the value today, the value proposed, and an
 * explicit approval before anything is written. Approving hands the change to
 * the same Projects service the Manage panel uses, so permissions, refusals
 * and activity are identical whichever door a person came through.
 *
 * The conversation itself is session scoped: it is held in the page and is
 * gone on reload, and the panel says so rather than implying a history that
 * does not exist. What survives is the project record and its activity.
 */

import { useEffect, useRef, useState } from "react";

import { TTButton } from "@/components/tt/primitives";
import { OTHER_ROOM_TRUTH, type ChatProposal, type OtherRoom } from "@/domain/project-chat-proposal";

export interface ProjectChatAnswer {
  answer: string;
  facts: string[];
  interpretations: string[];
  unknowns: string[];
  nextSteps: string[];
}

export type ProposalState = "open" | "applied" | "discarded" | "stale";

export interface ChatEntry {
  id: string;
  role: "you" | "project";
  /** What was said, for a person's own message or a plain reply. */
  text?: string;
  pasted?: string;
  pending?: boolean;
  answer?: ProjectChatAnswer;
  proposal?: ChatProposal;
  proposalState?: ProposalState;
  /** The receipt or refusal recorded after an approval was decided. */
  outcome?: string;
  /** Named when another room owns the truth. Chat never writes it here. */
  room?: OtherRoom;
}

function Group({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="tt-eyebrow">{title}</p>
      <ul className="mt-1 space-y-1">
        {items.map((item) => (
          <li key={item} className="text-[14px] text-muted-foreground">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ValueBlock({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex-1 rounded-xl border border-border bg-background p-3">
      <p className="tt-eyebrow">{label}</p>
      <p
        className={`mt-1 whitespace-pre-line text-[14px] ${muted ? "text-muted-foreground" : "text-foreground"}`}
      >
        {value || "Nothing recorded"}
      </p>
    </div>
  );
}

function ProposalCard({
  proposal,
  state,
  outcome,
  busy,
  onApprove,
  onDiscard,
}: {
  proposal: ChatProposal;
  state: ProposalState;
  outcome?: string;
  busy: boolean;
  onApprove: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="tt-eyebrow">Proposed change · {proposal.owningRoom} owns this</p>
      <p className="mt-1 text-[15px] font-medium text-foreground">{proposal.fieldLabel}</p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <ValueBlock label="Now" value={proposal.currentValue} muted />
        <ValueBlock label="Proposed" value={proposal.proposedValue} />
      </div>

      {proposal.reason ? (
        <p className="mt-3 text-[13px] text-muted-foreground">Because: {proposal.reason}</p>
      ) : null}
      {proposal.note ? (
        <p className="mt-1 text-[13px] text-muted-foreground">{proposal.note}</p>
      ) : null}
      <p className="mt-1 text-[13px] text-muted-foreground">
        Nothing is written until you approve. Recorded in {proposal.store}.
      </p>

      {state === "open" ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <TTButton type="button" onClick={onApprove} disabled={busy}>
            {busy ? "Recording…" : "Approve and record"}
          </TTButton>
          <TTButton type="button" variant="secondary" onClick={onDiscard} disabled={busy}>
            Discard
          </TTButton>
        </div>
      ) : (
        <p className="mt-3 text-[14px] text-foreground">
          {outcome ??
            (state === "applied"
              ? "Recorded."
              : state === "discarded"
                ? "Discarded. Nothing was changed."
                : "Out of date. Nothing was changed.")}
        </p>
      )}
    </div>
  );
}

export function ChatTab({
  projectName,
  entries,
  pending,
  applying,
  error,
  onSend,
  onApprove,
  onDiscard,
}: {
  projectName: string;
  entries: ChatEntry[];
  pending: boolean;
  /** The id of the proposal currently being written, if any. */
  applying: string | null;
  error: string | null;
  onSend: (message: string, pasted: string, mode: "ask" | "change") => void;
  onApprove: (entryId: string) => void;
  onDiscard: (entryId: string) => void;
}) {
  const [message, setMessage] = useState("");
  const [pasted, setPasted] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [mode, setMode] = useState<"ask" | "change">("ask");
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [entries.length, pending]);

  const send = () => {
    const text = message.trim();
    if (!text || pending) return;
    onSend(text, pasted.trim(), mode);
    setMessage("");
    setPasted("");
    setShowPaste(false);
  };

  return (
    <section className="flex min-h-[36rem] flex-col gap-4" aria-label="Project chat">
      <div className="tt-surface p-5">
        <p className="tt-eyebrow">Talk to this project</p>
        <p className="mt-2 text-[14px] text-muted-foreground">
          Answers come from what {projectName} already holds. You can also ask for a change here:
          it is shown to you first, and only written to Projects when you approve it.
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          This conversation is not saved. It is gone when you leave the page. The record is not.
        </p>
      </div>

      <div className="flex-1 space-y-4">
        {entries.length === 0 ? (
          <p className="text-[14px] text-muted-foreground">
            Nothing asked yet in this session. Try "where is this stuck?", or "set the next move to
            send the draft to Fiona".
          </p>
        ) : (
          <ul className="space-y-4">
            {entries.map((entry) => {
              if (entry.role === "you") {
                return (
                  <li key={entry.id} className="flex justify-end">
                    <div className="max-w-[42rem] rounded-2xl bg-primary px-4 py-3 text-primary-foreground">
                      <p className="text-[14px]">{entry.text}</p>
                      {entry.pasted ? (
                        <p className="mt-1 text-[13px] opacity-80">
                          With pasted context, used for this turn only.
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              }

              const room = entry.room ? OTHER_ROOM_TRUTH[entry.room] : null;
              return (
                <li key={entry.id} className="max-w-[46rem] space-y-3">
                  {entry.pending ? (
                    <p className="text-[14px] text-muted-foreground">Reading the project…</p>
                  ) : null}

                  {entry.text ? (
                    <p className="text-[14px] text-foreground">{entry.text}</p>
                  ) : null}

                  {room ? (
                    <p className="text-[13px] text-muted-foreground">
                      {room.because}{" "}
                      {room.to ? (
                        <a className="underline" href={room.to}>
                          Open {room.room}
                        </a>
                      ) : null}
                    </p>
                  ) : null}

                  {entry.answer ? (
                    <div>
                      <p className="text-[14px] text-foreground">{entry.answer.answer}</p>
                      <Group title="From the record" items={entry.answer.facts} />
                      <Group title="Reading" items={entry.answer.interpretations} />
                      <Group title="Not answered here" items={entry.answer.unknowns} />
                      <Group title="You could" items={entry.answer.nextSteps} />
                    </div>
                  ) : null}

                  {entry.proposal ? (
                    <ProposalCard
                      proposal={entry.proposal}
                      state={entry.proposalState ?? "open"}
                      {...(entry.outcome ? { outcome: entry.outcome } : {})}
                      busy={applying === entry.id}
                      onApprove={() => onApprove(entry.id)}
                      onDiscard={() => onDiscard(entry.id)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <div ref={endRef} />
      </div>

      {error ? <p className="text-[14px] text-foreground">{error}</p> : null}

      <div className="sticky bottom-0 rounded-2xl border border-border bg-card p-3">
        <div className="flex gap-2">
          {(["ask", "change"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              aria-pressed={mode === value}
              className={`rounded-full px-3 py-1 text-[13px] ${
                mode === value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {value === "ask" ? "Ask" : "Propose a change"}
            </button>
          ))}
        </div>

        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          aria-label={
            mode === "ask" ? `Ask about ${projectName}` : `Propose a change to ${projectName}`
          }
          placeholder={
            mode === "ask"
              ? `Ask about ${projectName}...`
              : "Say what should change. You will see it before anything is recorded."
          }
          className="mt-3 min-h-20 w-full resize-none rounded-xl border border-input bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground"
        />

        {showPaste ? (
          <textarea
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            aria-label="Paste context for this message"
            placeholder="Paste an update, a link or a note to read for this message only."
            className="mt-2 min-h-20 w-full rounded-xl border border-input bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground"
          />
        ) : null}

        <div className="mt-2 flex items-center justify-between gap-2">
          <button
            type="button"
            className="text-[13px] text-muted-foreground underline"
            onClick={() => setShowPaste((open) => !open)}
          >
            {showPaste ? "Remove pasted context" : "Add context for this message"}
          </button>
          <TTButton type="button" onClick={send} disabled={pending || message.trim().length === 0}>
            {pending ? "Reading the project…" : mode === "ask" ? "Ask" : "Prepare change"}
          </TTButton>
        </div>
      </div>
    </section>
  );
}
