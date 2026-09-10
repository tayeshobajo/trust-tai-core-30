/**
 * The milestone lifecycle strip: where this milestone stands, what still has
 * to be true, and the one human decision at the end of it.
 *
 * Nothing here decides anything on its own. When every condition is checked it
 * offers one clear action, and that action still asks a person to confirm.
 * Roadmap approval is not acceptance: only `Accept milestone` records that the
 * delivered work was accepted. When something is missing the strip says what,
 * and offers the action that resolves it on this same surface.
 */

import { useState } from "react";

import { MetaPill, TTButton, TTInput } from "@/components/tt/primitives";
import type { MilestoneLifecycle } from "@/domain/milestone-lifecycle";

export function LifecyclePanel({
  lifecycle,
  subject,
  busy,
  onFix,
  onAccept,
}: {
  lifecycle: MilestoneLifecycle;
  subject: string;
  busy: boolean;
  /** Opens the outcome editor, when that is what is missing. */
  onFix?: (() => void) | undefined;
  /** Records the human acceptance of delivered work. */
  onAccept?: ((note: string) => void) | undefined;
}) {
  const { progress } = lifecycle;
  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");

  return (
    <section className="mt-5 rounded-2xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="tt-eyebrow">{lifecycle.stepLabel}</p>
        {lifecycle.progressLabel ? <MetaPill>{lifecycle.progressLabel} conditions</MetaPill> : null}
      </div>

      {progress.total > 0 ? (
        <div
          className="mt-3 h-1 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.done}
          aria-label={`Acceptance conditions met for ${subject}`}
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
      ) : null}

      <p className="mt-3 max-w-reading text-sm text-foreground">{lifecycle.headline}</p>
      {lifecycle.remaining ? (
        <p className="mt-1 max-w-reading text-sm text-muted-foreground">{lifecycle.remaining}</p>
      ) : null}

      {!lifecycle.ready && lifecycle.fix === "outcome" && lifecycle.fixLabel && onFix ? (
        <div className="mt-4">
          <TTButton size="sm" variant="secondary" disabled={busy} onClick={onFix}>
            {lifecycle.fixLabel}
          </TTButton>
        </div>
      ) : null}

      {lifecycle.ready && onAccept && !confirming ? (
        <div className="mt-4">
          <TTButton size="sm" disabled={busy} onClick={() => setConfirming(true)}>
            Accept milestone
          </TTButton>
        </div>
      ) : null}

      {lifecycle.ready && onAccept && confirming ? (
        <div className="mt-4 space-y-3">
          <p className="max-w-reading text-sm text-foreground">
            This records that you accepted the delivered work on {subject}. It is your decision, not
            the system&apos;s, and you can reopen it later.
          </p>
          <TTInput
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Anything worth noting (optional)"
            aria-label={`Acceptance note for ${subject}`}
          />
          <div className="flex flex-wrap gap-2">
            <TTButton
              size="sm"
              disabled={busy}
              onClick={() => {
                onAccept(note);
                setConfirming(false);
                setNote("");
              }}
            >
              Accept milestone
            </TTButton>
            <TTButton
              size="sm"
              variant="quiet"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </TTButton>
          </div>
        </div>
      ) : null}
    </section>
  );
}
