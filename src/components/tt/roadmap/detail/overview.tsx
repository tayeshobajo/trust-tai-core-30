/**
 * Roadmap detail, Overview.
 *
 * The whole path in one read: where the company is, where it is going, the
 * sequence between the two, the milestone actually in hand, and the proof the
 * plan is anchored to. Every statement carries its own tier.
 */

import { ArrowRight } from "lucide-react";

import { TTButton } from "@/components/tt/primitives";
import { TierChip } from "@/components/tt/roadmap/tier";
import { DetailSection, KeyLine, MilestonePath, PathStatePill } from "./parts";
import type { AnchorProofLine, PathMilestone } from "@/data/roadmap/detail/projection";
import type { Roadmap } from "@/domain/roadmap";
import { UNKNOWN_STATEMENT } from "@/domain/roadmap";

export function PointSummary({
  roadmap,
  approving,
  onApprove,
}: {
  roadmap: Roadmap;
  approving: boolean;
  onApprove: () => void;
}) {
  const pointA = roadmap.pointA[0];
  return (
    <DetailSection
      eyebrow="Where this stands"
      title="Point A to Point B"
      supporting="Observed truth on the left, the destination on the right. A destination stays a proposal until a person approves it."
      action={
        roadmap.pointB && roadmap.pointB.tier !== "decided" ? (
          <TTButton size="sm" disabled={approving} onClick={onApprove}>
            {approving ? "Approving…" : "Approve Point B"}
          </TTButton>
        ) : null
      }
    >
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-start">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="tt-eyebrow">Point A</p>
            <TierChip tier={pointA?.tier ?? "observed"} />
          </div>
          <p className="mt-2 text-[14px] leading-relaxed text-foreground">
            {pointA?.value ?? UNKNOWN_STATEMENT}
          </p>
          {roadmap.pointA.length > 1 ? (
            <ul className="mt-3 space-y-1.5">
              {roadmap.pointA.slice(1, 4).map((note) => (
                <li key={`${note.label}-${note.at}`} className="text-[13px] text-muted-foreground">
  · {note.value}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <ArrowRight
          aria-hidden
          className="mt-6 hidden size-4 shrink-0 text-muted-foreground sm:block"
        />

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="tt-eyebrow">Point B</p>
            {roadmap.pointB ? <TierChip tier={roadmap.pointB.tier} /> : null}
          </div>
          <p className="mt-2 text-[14px] leading-relaxed text-foreground">
            {roadmap.pointB?.statement ?? UNKNOWN_STATEMENT}
          </p>
          {roadmap.pointB?.because ? (
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              {roadmap.pointB.because}
            </p>
          ) : null}
        </div>
      </div>
    </DetailSection>
  );
}

export function PathSection({
  path,
  activeId,
  onSelect,
}: {
  path: PathMilestone[];
  activeId?: string | null;
  onSelect?: (id: string) => void;
}) {
  return (
    <DetailSection
      eyebrow="The walk"
      title="Milestone path"
      supporting="Sequence is a recommendation. Execution state is read back from the room that owns the work."
    >
      <MilestonePath path={path} activeId={activeId ?? null} {...(onSelect ? { onSelect } : {})} />
    </DetailSection>
  );
}

export function CurrentMilestoneCard({
  entry,
  action,
}: {
  entry: PathMilestone | null;
  action?: React.ReactNode;
}) {
  if (!entry) {
    return (
      <DetailSection
        eyebrow="In hand"
        title="Nothing is in motion"
        supporting="No approved milestone is running or waiting to start on this roadmap."
      >
        <p className="text-[13px] text-muted-foreground">
          Approve a milestone in Milestones to put something in hand.
        </p>
      </DetailSection>
    );
  }

  return (
    <DetailSection
      eyebrow={`Milestone ${entry.ordinal}`}
      title={entry.name}
      action={<PathStatePill state={entry.state} />}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <KeyLine label="What we build" value={entry.whatWeBuild} />
        <KeyLine label="What it unlocks" value={entry.unlocks} />
        <KeyLine label="Who carries it" value={entry.ownerLabel} />
        <KeyLine
          label="Owning room"
          value={
            entry.supportingRooms.length > 0
              ? `${entry.owningRoomLabel}, supported by ${entry.supportingRooms.join(" and ")}`
              : entry.owningRoomLabel
          }
        />
        <KeyLine
          label="Boundary"
          value={entry.executionBoundary || "No execution boundary is recorded."}
        />
      </div>
      {entry.dependencies.length > 0 ? (
        <ul className="mt-4 space-y-1">
          {entry.dependencies.map((dependency) => (
            <li key={dependency} className="text-[13px] text-muted-foreground">
              Depends on · {dependency}
            </li>
          ))}
        </ul>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </DetailSection>
  );
}

export function AnchorProofCard({ lines }: { lines: AnchorProofLine[] }) {
  return (
    <DetailSection
      eyebrow="Anchor proof"
      title="What this company is already good at"
      supporting="The plan is built on what is already true, not on what would be flattering."
    >
      {lines.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          No anchor proof is on record yet. Run research in Evidence to establish it.
        </p>
      ) : (
        <ul className="space-y-3">
          {lines.map((line) => (
            <li key={line.statement} className="border-l-2 border-border pl-3">
              <p className="text-[14px] leading-relaxed text-foreground">{line.statement}</p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {line.because || "No reasoning is recorded."}
              </p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                {line.approved ? "Approved" : "Proposed"} · {line.sources}{" "}
                {line.sources === 1 ? "source" : "sources"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </DetailSection>
  );
}
