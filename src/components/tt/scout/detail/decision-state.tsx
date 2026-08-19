/**
 * Scout, the Tai Decision State.
 *
 * The final calm section of a company record. It shows what the evidence
 * appears to say, what is still unclear, one suggested next move, and the
 * bounded actions a person can take. Every action states its consequence
 * before it is committed. Nothing here executes on its own.
 */

import { useState } from "react";

import { MetaPill, SectionHeading, TTButton } from "@/components/tt/primitives";
import { InboundBadge } from "@/components/tt/scout/inbound";
import type {
  DecisionMove,
  DecisionMoveKey,
  DecisionStateView,
} from "@/data/scout/decision-state";
import { cn } from "@/lib/utils";

import { relativeTime } from "./parts";

export interface DecisionCommit {
  move: DecisionMoveKey;
  note?: string;
}

export function DecisionStatePanel({
  companyName,
  state,
  toldUs,
  submissionHref,
  onCommit,
  busy,
}: {
  companyName: string;
  state: DecisionStateView;
  /** The founder's own line, for Website inbound companies only. */
  toldUs?: string | null;
  /** Link back to the original conversation, when there is one. */
  submissionHref?: string | null;
  onCommit: (commit: DecisionCommit) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState<DecisionMoveKey | null>(null);
  const [note, setNote] = useState("");

  const start = (move: DecisionMove) => {
    if (!move.available || busy) return;
    setOpen(move.key);
    setNote(move.key === "ask_question" ? (state.draftQuestion ?? "") : "");
  };

  const commit = (move: DecisionMoveKey) => {
    onCommit(note.trim() ? { move, note: note.trim() } : { move });
    setOpen(null);
    setNote("");
  };

  return (
    <div className="tt-surface p-5">
      <div className="flex flex-wrap items-center gap-2">
        {state.inbound ? <InboundBadge /> : null}
        <MetaPill>{state.evidenceLine}</MetaPill>
        <MetaPill>{state.permissionLine}</MetaPill>
      </div>

      <div className="mt-4">
        <SectionHeading
          eyebrow="Decision"
          title="What deserves to happen next?"
          description={`Scout can read and interpret. What happens to ${companyName} is decided here, by a person.`}
        />
      </div>

      {toldUs ? (
        <p className="border-l-2 border-royal/50 pl-3 text-[14px] text-foreground">
          Told us: {toldUs}
          {submissionHref ? (
            <a
              href={submissionHref}
              className="ml-2 text-royal underline-offset-4 hover:underline"
            >
              Open original conversation
            </a>
          ) : null}
        </p>
      ) : null}

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <ReadColumn title="What appears true" lines={state.read.appearsTrue} />
        <ReadColumn title="What is still unclear" lines={state.read.stillUncertain} />
        <ReadColumn title="Why this may deserve attention" lines={state.read.deservesAttention} />
        <ReadColumn title="What should not be assumed" lines={state.read.doNotAssume} />
      </div>

      <div className="mt-6 rounded-xl border border-royal/30 bg-royal/5 p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-royal">
          Suggested next move
        </p>
        <p className="mt-1 font-serif text-[19px] text-foreground">{state.suggested.label}</p>
        <p className="mt-1 text-[13px] text-muted-foreground">{state.suggested.because}</p>
        <p className="mt-2 text-[12px] text-muted-foreground">
          A suggestion, not a decision. Nothing moves until you choose.
        </p>
      </div>

      <ul className="mt-5 space-y-2">
        {state.moves.map((move) => (
          <li key={move.key} className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[14px] font-medium text-foreground">
                  {move.label}
                  {move.key === state.suggested.key ? (
                    <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-royal">
                      Suggested
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {move.available ? move.consequence : move.unavailableBecause}
                </p>
              </div>
              <TTButton
                variant={move.key === state.suggested.key ? "primary" : "secondary"}
                className="h-9 shrink-0 text-[13px]"
                disabled={!move.available || busy}
                onClick={() => start(move)}
              >
                {move.label}
              </TTButton>
            </div>

            {open === move.key ? (
              <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3">
                <p className="text-[13px] text-foreground">{move.consequence}</p>
                <label className="mt-3 block">
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {move.key === "ask_question" ? "Draft question" : "Reason (optional)"}
                  </span>
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    rows={move.key === "ask_question" ? 5 : 2}
                    className="mt-1.5 w-full rounded-lg border border-border bg-background p-3 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-royal/40"
                    placeholder={
                      move.key === "ask_question"
                        ? "One question, in your own words."
                        : "Why this, in one line."
                    }
                  />
                </label>
                {move.key === "ask_question" ? (
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    Saved as a draft in Scout. Send it from Comms when you are ready.
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <TTButton
                    className="h-9 text-[13px]"
                    disabled={busy || (move.key === "ask_question" && !note.trim())}
                    onClick={() => commit(move.key)}
                  >
                    Confirm {move.label.toLowerCase()}
                  </TTButton>
                  <TTButton
                    variant="quiet"
                    className="h-9 text-[13px]"
                    disabled={busy}
                    onClick={() => setOpen(null)}
                  >
                    Cancel
                  </TTButton>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="mt-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Decision record
        </p>
        {state.record.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted-foreground">
            Nothing has been decided about this company yet.
          </p>
        ) : (
          <ol className="mt-3 space-y-3">
            {state.record.slice(0, 8).map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="flex gap-3">
                <span
                  aria-hidden
                  className={cn(
                    "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                    entry.byPerson ? "bg-royal" : "bg-muted-foreground/40",
                  )}
                />
                <div className="min-w-0">
                  <p className="text-[13px] text-foreground">{entry.label}</p>
                  <p className="text-[12px] text-muted-foreground">
                    {entry.actor} · {relativeTime(entry.at)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function ReadColumn({ title, lines }: { title: string; lines: string[] }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </h3>
      {lines.length === 0 ? (
        <p className="mt-2 text-[13px] text-muted-foreground">Nothing here yet.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {lines.map((line, index) => (
            <li key={index} className="text-[13px] text-foreground">
              {line}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
