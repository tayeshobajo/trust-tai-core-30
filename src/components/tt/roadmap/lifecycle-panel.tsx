/**
 * The milestone lifecycle strip: where this milestone stands, what still has
 * to be true, and the one human decision at the end of it.
 *
 * Nothing here decides anything. When every condition is checked it offers a
 * person one clear action; when something is missing it says what, and offers
 * the action that resolves it on this same surface.
 */

import { MetaPill, TTButton } from "@/components/tt/primitives";
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
  /** Proposes the final human decision. It still has to be confirmed. */
  onAccept?: (() => void) | undefined;
}) {
  const { progress } = lifecycle;
  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <section className="mt-5 rounded-2xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="tt-eyebrow">{lifecycle.stepLabel}</p>
        {lifecycle.progressLabel ? (
          <MetaPill>{lifecycle.progressLabel} conditions</MetaPill>
        ) : null}
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

      {lifecycle.ready && onAccept ? (
        <div className="mt-4">
          <TTButton size="sm" disabled={busy} onClick={onAccept}>
            Accept and complete
          </TTButton>
        </div>
      ) : lifecycle.fix === "outcome" && lifecycle.fixLabel && onFix ? (
        <div className="mt-4">
          <TTButton size="sm" variant="secondary" disabled={busy} onClick={onFix}>
            {lifecycle.fixLabel}
          </TTButton>
        </div>
      ) : null}
    </section>
  );
}
