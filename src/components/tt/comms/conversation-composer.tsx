/**
 * The composer.
 *
 * Two things a person can do here: prepare a message, or leave a note. Nothing
 * is ever sent from Comms. A composed reply becomes a draft that lands in the
 * thread, and a person decides what happens to it — so there is no Send here,
 * by design, not by omission.
 */

import { useState } from "react";

import type { VoiceRegister } from "@/domain/voice";
import { TTButton } from "@/components/tt/primitives";
import { cn } from "@/lib/utils";

export type ComposerMode = "compose" | "note";

const INTENTS: { register: VoiceRegister; label: string }[] = [
  { register: "follow_up", label: "Follow up" },
  { register: "warm_intro", label: "Warm intro" },
  { register: "reconnect", label: "Reconnect" },
  { register: "logistics", label: "Check in" },
  { register: "sensitive", label: "More" },
];

const MODES: { mode: ComposerMode; label: string }[] = [
  { mode: "compose", label: "Draft a reply" },
  { mode: "note", label: "Internal note" },
];

export function ConversationComposer({
  drafting,
  busy,
  error,
  onCompose,
  onNote,
  onInsertInsight,
}: {
  drafting: boolean;
  busy: boolean;
  error?: string | null;
  onCompose: (register: VoiceRegister, purpose: string) => void;
  onNote: (value: string) => void;
  onInsertInsight?: () => string | null;
}) {
  const [mode, setMode] = useState<ComposerMode>("compose");
  const [register, setRegister] = useState<VoiceRegister>("follow_up");
  const [value, setValue] = useState("");

  function submit() {
    if (mode === "note") {
      if (!value.trim()) return;
      onNote(value.trim());
      setValue("");
      return;
    }
    onCompose(register, value.trim());
  }

  return (
    <div className="border-t border-border bg-card px-4 pb-4 pt-0 sm:px-5">
      {/* Underline tabs, same geometry as the room's section tabs. */}
      <div className="flex items-center gap-5 border-b border-border">
        {MODES.map((entry) => (
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

      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        rows={3}
        placeholder={
          mode === "compose"
            ? "Write your message… or leave this empty and let Comms prepare the draft."
            : "Leave an internal note. Only your team sees this."
        }
        className="mt-3 w-full resize-none rounded-lg border border-border bg-[var(--cloud)] px-3.5 py-3 text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      {mode === "compose" ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {INTENTS.map((intent) => (
            <button
              key={intent.register}
              type="button"
              onClick={() => setRegister(intent.register)}
              aria-pressed={register === intent.register}
              className={cn(
                "rounded-full border px-3 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                register === intent.register
                  ? "border-[var(--royal)] bg-[var(--cloud-strong)] text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {intent.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {onInsertInsight ? (
            <button
              type="button"
              onClick={() => {
                const insight = onInsertInsight();
                if (insight) setValue((current) => (current ? `${current}\n${insight}` : insight));
              }}
              className="transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Insert insight
            </button>
          ) : null}
          <span className="opacity-70">
            {mode === "compose" ? "Saved as a draft — never sent" : "Visible to your team only"}
          </span>
        </div>
        <TTButton onClick={submit} disabled={busy || drafting}>
          {mode === "note"
            ? busy
              ? "Saving…"
              : "Save note"
            : drafting
              ? "Preparing draft…"
              : "Save as draft"}
        </TTButton>
      </div>

      {error ? <p className="mt-2 text-[12px] text-destructive">{error}</p> : null}
    </div>
  );
}
