/**
 * Reply, or record what already happened.
 *
 * Two modes at the foot of the relationship. Reply prepares a message in Tai's
 * voice, informed by this relationship's history, its open promises and the
 * thing being answered. Record interaction puts something that happened
 * elsewhere onto the timeline.
 *
 * Nothing is sent from here. A draft lands in the thread and a person decides.
 */

import { useState } from "react";

import { TTButton } from "@/components/tt/primitives";
import type { VoiceRegister } from "@/domain/voice";
import { cn } from "@/lib/utils";

export type ReplyMode = "reply" | "record";

const INTENTS: { register: VoiceRegister; label: string }[] = [
  { register: "follow_up", label: "Follow up" },
  { register: "warm_intro", label: "Warm intro" },
  { register: "reconnect", label: "Reconnect" },
  { register: "gratitude", label: "Thank you" },
  { register: "logistics", label: "Check in" },
  { register: "sensitive", label: "More" },
];

export function ReplyRecordBar({
  drafting,
  busy,
  error,
  purposeHint,
  onPrepareDraft,
  onRecordInteraction,
}: {
  drafting: boolean;
  busy: boolean;
  error?: string | null;
  /** The reason Comms already believes in, offered as a starting point. */
  purposeHint?: string | null;
  onPrepareDraft: (register: VoiceRegister, purpose: string) => void;
  onRecordInteraction: () => void;
}) {
  const [mode, setMode] = useState<ReplyMode>("reply");
  const [register, setRegister] = useState<VoiceRegister>("follow_up");
  const [value, setValue] = useState("");

  return (
    <div className="border-t border-border bg-card px-4 pb-4 pt-0 sm:px-5">
      <div className="flex items-center gap-5 border-b border-border">
        {(
          [
            { mode: "reply" as const, label: "Reply" },
            { mode: "record" as const, label: "Record interaction" },
          ]
        ).map((entry) => (
          <button
            key={entry.mode}
            type="button"
            onClick={() => setMode(entry.mode)}
            aria-pressed={mode === entry.mode}
            className={cn(
              "-mb-px inline-flex h-10 items-center border-b-2 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              mode === entry.mode
                ? "border-[var(--royal)] font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {mode === "reply" ? (
        <div className="pt-3">
          <div className="flex flex-wrap gap-1.5">
            {INTENTS.map((intent) => (
              <button
                key={intent.register}
                type="button"
                aria-pressed={register === intent.register}
                onClick={() => setRegister(intent.register)}
                className={cn(
                  "rounded-full border px-3 py-1 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  register === intent.register
                    ? "border-royal/40 bg-royal/8 text-royal"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {intent.label}
              </button>
            ))}
          </div>

          <textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            rows={3}
            placeholder="Write it yourself, or leave this empty and Comms prepares the draft in your voice."
            className="mt-2.5 w-full rounded-lg border border-input bg-card px-3.5 py-2.5 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12px] text-muted-foreground">
              {purposeHint
                ? `Comms will use: ${purposeHint}`
                : "Drafts only. Nothing leaves Comms without you."}
            </p>
            <div className="flex items-center gap-2">
              {purposeHint ? (
                <TTButton
                  variant="quiet"
                  size="sm"
                  type="button"
                  onClick={() => setValue(purposeHint)}
                >
                  Use this reason
                </TTButton>
              ) : null}
              <TTButton
                size="sm"
                type="button"
                disabled={drafting || busy}
                onClick={() => onPrepareDraft(register, value.trim())}
              >
                {drafting ? "Preparing…" : "Prepare draft"}
              </TTButton>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
          <p className="max-w-[38ch] text-[12px] text-muted-foreground">
            Add a text, a call, a meeting or a note that happened somewhere else. It keeps your
            name on it.
          </p>
          <TTButton size="sm" type="button" onClick={onRecordInteraction} disabled={busy}>
            + Add interaction
          </TTButton>
        </div>
      )}

      {error ? <p className="mt-2 text-[12px] text-destructive">{error}</p> : null}
    </div>
  );
}
