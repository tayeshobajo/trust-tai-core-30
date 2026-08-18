/**
 * The single decision this page is asking for.
 *
 * Chosen by `computeNextMove`, never by the renderer. One move at a time.
 */

import type { NextMove } from "@/domain/prospect-modules";
import { TTButton } from "@/components/tt/primitives";

import { Panel, TierTag, WhyWeThink } from "./panel";

export function NextMovePanel({
  move,
  onQualify,
  onPass,
  onResearch,
  busy,
  canResearch,
}: {
  move: NextMove;
  onQualify: () => void;
  onPass: () => void;
  onResearch: () => void;
  busy?: boolean | undefined;
  canResearch: boolean;
}) {
  return (
    <Panel
      eyebrow="Next move"
      title={move.headline}
      aside={<TierTag tier="decision" />}
      emphasis="primary"
    >
      <div className="space-y-4">
        <p className="max-w-reading text-sm text-foreground">{move.detail}</p>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Why now · {move.because}
        </p>
        <WhyWeThink confidence={move.confidence} />

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          {move.action === "qualify" ? (
            <>
              <TTButton disabled={busy} onClick={onQualify}>
                Qualify this company
              </TTButton>
              <TTButton variant="secondary" disabled={busy} onClick={onPass}>
                Pass
              </TTButton>
            </>
          ) : null}

          {move.action === "research" && canResearch ? (
            <TTButton disabled={busy} onClick={onResearch}>
              Read the website again
            </TTButton>
          ) : null}

          {move.action === "review" ? (
            <TTButton variant="secondary" disabled={busy} onClick={onPass}>
              Pass for now
            </TTButton>
          ) : null}

          {move.action === "people" || move.action === "handoff" ? (
            <p className="text-[13px] text-muted-foreground">
              Nothing is sent automatically. Comms opens only when a person is carried across.
            </p>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
