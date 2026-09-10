/**
 * Client Chat.
 *
 * Chat is how a person talks to the account. Clients remains where account
 * truth is composed, so nothing said here becomes the record on its own. A
 * message is answered from a bounded account packet, or it prepares one
 * bounded commercial change: the field, the value today, the value proposed,
 * and an explicit approval before anything is written. Approving hands the
 * change to the same commercial service the Commercial panel uses, so
 * permissions, refusals and provenance are identical whichever door a person
 * came through.
 *
 * The conversation itself is session scoped: it is held in the page and is
 * gone on reload, and the panel says so rather than implying a history that
 * does not exist. What survives is the client record and its activity.
 */

import { useEffect, useRef, useState } from "react";

import { TTButton } from "@/components/tt/primitives";
import {
  CLIENT_OTHER_ROOM,
  type ClientChatProposal,
  type ClientOtherRoom,
} from "@/domain/client-chat-proposal";

export interface ClientChatAnswer {
  answer: string;
  facts: string[];
  interpretations: string[];
  unknowns: string[];
  nextSteps: string[];
}

export type ClientProposalState = "open" | "applied" | "discarded" | "stale";

export interface ClientChatEntry {
  id: string;
  role: "you" | "client";
  text?: string;
  pasted?: string;
  pending?: boolean;
  answer?: ClientChatAnswer;
  proposal?: ClientChatProposal;
  proposalState?: ClientProposalState;
  /** The receipt or refusal recorded after an approval was decided. */
  outcome?: string;
  /** Named when another room owns the truth. Chat never writes it here. */
  room?: ClientOtherRoom;
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
  proposal: ClientChatProposal;
  state: ClientProposalState;
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

export function ClientChatTab({
  clientName,
  entries,
  pending,
  applying,
  error,
  onSend,
  onApprove,
  onDiscard,
}: {
  clientName: string;
  entries: ClientChatEntry[];
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
    <section className="flex min-h-[36rem] flex-col gap-4" aria-label="Client chat">
      <div className="tt-surface rounded-2xl p-5">
        <p className="tt-eyebrow">Talk to this account</p>
        <p className="mt-2 text-[14px] text-muted-foreground">
          Answers come from what {clientName} already holds: the commercial state, the people, the
          projects and what has happened. Delivery is operated in the project workspace, and
          messages are sent in Comms.
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          You can also ask for a commercial change here: it is shown to you first, and only written
          when you approve it. This conversation is not saved and is gone when you leave the page.
          The record is not.
        </p>
      </div>

      <div className="flex-1 space-y-4">
        {entries.length === 0 ? (
          <p className="text-[14px] text-muted-foreground">
            Nothing asked yet in this session. Try "what needs me on this account?", or "their
            renewal moves to 2027-01-31, they signed a six month extension".
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

              const room = entry.room ? CLIENT_OTHER_ROOM[entry.room] : null;
              return (
                <li key={entry.id} className="max-w-[46rem] space-y-3">
                  {entry.pending ? (
                    <p className="text-[14px] text-muted-foreground">Reading the account…</p>
                  ) : null}

                  {entry.text ? <p className="text-[14px] text-foreground">{entry.text}</p> : null}

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
          aria-label="Message this account"
          rows={2}
          placeholder={
            mode === "ask" ? "Ask about this account" : "Say what should change, and why"
          }
          className="mt-3 w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-[14px] text-foreground outline-none"
        />

        {showPaste ? (
          <textarea
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            aria-label="Paste context for this turn"
            rows={3}
            placeholder="Paste anything relevant. Used for this turn only, never stored."
            className="mt-2 w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none"
          />
        ) : null}

        <div className="mt-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setShowPaste((open) => !open)}
            className="text-[13px] text-muted-foreground underline underline-offset-4"
          >
            {showPaste ? "Remove pasted context" : "Paste context for this turn"}
          </button>
          <TTButton type="button" onClick={send} disabled={pending || !message.trim()}>
            {pending ? "Reading…" : mode === "ask" ? "Ask" : "Prepare"}
          </TTButton>
        </div>
      </div>
    </section>
  );
}
