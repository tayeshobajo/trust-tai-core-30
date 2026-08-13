/**
 * Walkthrough view.
 *
 * Presentation mode with a notebook attached. What is said in the room is
 * captured as it happens: approvals, rejections, changes, unanswered questions
 * and next actions, each written into history with who captured it and when.
 */

import { useState } from "react";

import { EmptyState, MetaPill, SectionHeading, TTButton, TTInput } from "@/components/tt/primitives";
import type { RoadmapSession, WalkthroughEntryKind } from "@/domain/roadmap-intel";
import { WALKTHROUGH_KIND_LABEL } from "@/domain/roadmap-intel";

const KINDS: WalkthroughEntryKind[] = [
  "note",
  "approval",
  "rejection",
  "change",
  "question",
  "next_action",
];

export function WalkthroughView({
  session,
  history,
  busy,
  onStart,
  onCapture,
  onEnd,
}: {
  session: RoadmapSession | null;
  history: RoadmapSession[];
  busy: boolean;
  onStart: () => void;
  onCapture: (kind: WalkthroughEntryKind, body: string) => void;
  onEnd: () => void;
}) {
  const [kind, setKind] = useState<WalkthroughEntryKind>("note");
  const [body, setBody] = useState("");

  if (!session) {
    return (
      <EmptyState
        title="No walkthrough is running."
        belongsHere="Start a walkthrough when you present this roadmap, and capture what is decided in the room."
        whyItMatters="A decision made out loud and never written down is a decision the roadmap loses."
        action={
          <TTButton onClick={onStart} disabled={busy}>
            Start walkthrough
          </TTButton>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="In the room"
        title="Walkthrough"
        description="Everything captured here lands in this roadmap's history with its author and time."
        action={
          <TTButton variant="secondary" onClick={onEnd} disabled={busy || Boolean(session.endedAt)}>
            {session.endedAt ? "Ended" : "End walkthrough"}
          </TTButton>
        }
      />

      <form
        className="tt-surface space-y-3 p-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (!body.trim()) return;
          onCapture(kind, body.trim());
          setBody("");
        }}
      >
        <div className="flex flex-wrap gap-2">
          {KINDS.map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => setKind(entry)}
              className={
                kind === entry
                  ? "rounded-full border border-foreground px-3 py-1 text-xs text-foreground"
                  : "rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
              }
            >
              {WALKTHROUGH_KIND_LABEL[entry]}
            </button>
          ))}
        </div>
        <TTInput
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Capture what was just said"
          aria-label="Walkthrough capture"
        />
        <TTButton type="submit" disabled={busy || body.trim().length === 0}>
          Capture
        </TTButton>
      </form>

      <section aria-label="Captured in this session" className="tt-surface p-6">
        <p className="tt-eyebrow">This session</p>
        {session.entries.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nothing captured yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {session.entries.map((entry, index) => (
              <li key={`${entry.at}-${index}`}>
                <MetaPill>{WALKTHROUGH_KIND_LABEL[entry.kind]}</MetaPill>
                <p className="mt-1 max-w-reading text-sm text-foreground">{entry.body}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(entry.at).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {history.length > 1 ? (
        <section aria-label="Earlier walkthroughs" className="tt-surface p-6">
          <p className="tt-eyebrow">Earlier walkthroughs</p>
          <ul className="mt-3 space-y-1.5">
            {history.slice(1).map((entry) => (
              <li key={entry.id} className="text-sm text-muted-foreground">
                {new Date(entry.startedAt).toLocaleDateString()} · {entry.entries.length} captured
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
