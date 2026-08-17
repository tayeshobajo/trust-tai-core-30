/**
 * The composer.
 *
 * Two things a person can do here: write a message, or leave a note. Nothing is
 * sent from Comms — a composed reply becomes a draft a person approves.
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
    <div className="border-t border-border bg-card px-4 py-3 sm:px-5">
      <div className="flex items-center gap-1">
        {(["compose", "note"] as ComposerMode[]).map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setMode(entry)}
            aria-pressed={mode === entry}
            className={cn(
              "rounded-full px-2.5 py-1 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              mode === entry
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {entry === "compose" ? "Compose" : "Note"}
          </button>
        ))}
      </div>

      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        rows={3}
        placeholder={
          mode === "compose"
            ? "Write your message… or leave this empty and let Comms draft it."
            : "Leave an internal note. Only your team sees this."
        }
        className="mt-2.5 w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      {mode === "compose" ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {INTENTS.map((intent) => (
            <button
              key={intent.register}
              type="button"
              onClick={() => setRegister(intent.register)}
              aria-pressed={register === intent.register}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                register === intent.register
                  ? "border-foreground text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {intent.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
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
          <span className="opacity-60">Nothing is sent from Comms</span>
        </div>
        <TTButton onClick={submit} disabled={busy || drafting}>
          {mode === "note"
            ? busy
              ? "Saving…"
              : "Save note"
            : drafting
              ? "Composing…"
              : "Compose reply"}
        </TTButton>
      </div>

      {error ? <p className="mt-2 text-[12px] text-destructive">{error}</p> : null}
    </div>
  );
}
