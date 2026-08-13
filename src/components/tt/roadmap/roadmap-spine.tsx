/**
 * The Walk: Point A → stages → Point B, read top to bottom.
 *
 * A person should be able to tell, in five seconds, where this stands, where
 * it is going, and which step is live right now.
 */

import { MetaPill, TTButton } from "@/components/tt/primitives";
import { EvidenceList, TierChip } from "@/components/tt/roadmap/tier";
import type { Destination, RoadmapNote, RoadmapStage, StageState } from "@/domain/roadmap";
import { STAGE_STATES, STAGE_STATE_LABEL } from "@/domain/roadmap";
import { cn } from "@/lib/utils";

const STATE_MARK: Record<StageState, string> = {
  mapped: "border-border bg-card",
  in_build: "border-royal bg-royal/10",
  live: "border-success bg-success/10",
  blocked: "border-danger bg-danger/10",
};

export function PointAPanel({ notes }: { notes: RoadmapNote[] }) {
  return (
    <section className="tt-surface p-6" aria-labelledby="point-a">
      <p className="tt-eyebrow">Point A</p>
      <h2 id="point-a" className="mt-2 text-base font-semibold text-foreground">
        Where this actually stands
      </h2>
      <ul className="mt-4 space-y-4">
        {notes.map((note, index) => (
          <li key={`${note.label}-${index}`} className="border-t border-border pt-4 first:border-0 first:pt-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="tt-eyebrow">{note.label}</p>
              <TierChip tier={note.tier} />
            </div>
            <p className="mt-2 text-sm text-foreground">{note.value}</p>
            <EvidenceList evidence={note.evidence} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PointBPanel({
  destination,
  onApprove,
  approving,
}: {
  destination: Destination | null;
  onApprove?: (() => void) | undefined;
  approving?: boolean;
}) {
  return (
    <section className="tt-surface p-6" aria-labelledby="point-b">
      <p className="tt-eyebrow">Point B</p>
      <h2 id="point-b" className="mt-2 text-base font-semibold text-foreground">
        Where this is going
      </h2>

      {destination ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <TierChip tier={destination.tier} />
            {destination.tier === "inferred" ? (
              <MetaPill>Proposal — not yet approved</MetaPill>
            ) : (
              <MetaPill>Approved by a person</MetaPill>
            )}
          </div>
          <p className="mt-3 font-display text-2xl text-foreground">{destination.statement}</p>
          <p className="mt-2 text-sm text-muted-foreground">{destination.because}</p>
          <EvidenceList evidence={destination.evidence} />
          {destination.tier === "inferred" && onApprove ? (
            <TTButton className="mt-5" size="sm" onClick={onApprove} disabled={approving}>
              {approving ? "Approving…" : "Approve this destination"}
            </TTButton>
          ) : null}
        </>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          No destination is on record. Nothing below this can be sequenced honestly until there is
          one.
        </p>
      )}
    </section>
  );
}

export function StageList({
  stages,
  onState,
  busyId,
}: {
  stages: RoadmapStage[];
  onState: (stage: RoadmapStage, state: StageState) => void;
  busyId?: string | null;
}) {
  if (stages.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No stages yet. A roadmap needs at least one step to be useful.
      </p>
    );
  }

  return (
    <ol className="space-y-3">
      {stages.map((stage, index) => (
        <li key={stage.id} className="relative pl-8">
          <span
            aria-hidden
            className={cn(
              "absolute left-0 top-5 h-3.5 w-3.5 rounded-full border-2",
              STATE_MARK[stage.state],
            )}
          />
          {index < stages.length - 1 ? (
            <span aria-hidden className="absolute left-[6px] top-10 h-[calc(100%-1rem)] w-px bg-border" />
          ) : null}

          <article className="tt-surface p-5">
            <div className="flex flex-wrap items-center gap-2">
              <MetaPill>{STAGE_STATE_LABEL[stage.state]}</MetaPill>
              <TierChip tier={stage.tier} />
              <MetaPill>Carried by {stage.ownerLabel ?? "no one yet"}</MetaPill>
            </div>
            <h3 className="mt-3 text-base font-semibold text-foreground">{stage.title}</h3>
            {stage.intent ? (
              <p className="mt-1 text-sm text-muted-foreground">{stage.intent}</p>
            ) : null}
            <EvidenceList evidence={stage.evidence} />

            <div className="mt-4 flex flex-wrap gap-2">
              {STAGE_STATES.filter((state) => state !== stage.state).map((state) => (
                <TTButton
                  key={state}
                  size="sm"
                  variant="secondary"
                  disabled={busyId === stage.id}
                  onClick={() => onState(stage, state)}
                >
                  Mark {STAGE_STATE_LABEL[state].toLowerCase()}
                </TTButton>
              ))}
            </div>
          </article>
        </li>
      ))}
    </ol>
  );
}
