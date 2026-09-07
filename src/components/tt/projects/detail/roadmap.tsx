/**
 * The Roadmap surface inside the Project workroom.
 *
 * Roadmap still owns every fact shown here. This composes that truth where the
 * work is being done, and every write it offers calls the Roadmap service, so
 * there is no second milestone store and no copy of a destination.
 */

import { Link } from "@tanstack/react-router";
import { useState } from "react";

import type { MeasurementInput, MilestoneMeasurement } from "@/domain/milestone-measurement";
import { MilestonesView } from "@/components/tt/roadmap/milestones-view";
import { EmptyState, SectionHeading, TTButton, TTCard } from "@/components/tt/primitives";
import type { ManualMilestoneInput } from "@/domain/milestone-create";
import type { AcceptanceCriterion } from "@/domain/milestone-criteria";
import type { CriterionEvidence } from "@/domain/criterion-evidence";
import type { EvidenceDraft } from "@/components/tt/roadmap/criterion-evidence";
import type { MilestoneSuccessInput } from "@/domain/milestone-success";
import type { OutcomeMetricInput } from "@/domain/milestone-metric";
import type { LinkableRoadmap } from "@/domain/project-roadmap-link";
import type { Roadmap } from "@/domain/roadmap";
import type { MilestoneStatus, RoadmapMilestone } from "@/domain/roadmap-intel";
import type { DeliveryProject } from "@/domain/delivery-projection";

const STATUS_LINE: Record<string, string> = {
  draft: "Draft",
  proposed: "Proposed",
  approved: "Approved",
  active: "Active",
  archived: "Archived",
};

function DestinationCard({ roadmap }: { roadmap: Roadmap }) {
  const destination = roadmap.pointB;
  return (
    <TTCard className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="tt-eyebrow">Where this work is going</p>
          <p className="mt-2 max-w-reading text-[17px] leading-relaxed text-foreground">
            {destination?.statement || roadmap.objective || "No destination recorded yet."}
          </p>
        </div>
        <TTButton asChild size="sm" variant="secondary">
          <Link
            to="/modules/roadmap/$roadmapId"
            params={{ roadmapId: roadmap.id }}
            search={{ view: "overview" as const }}
          >
            Open in Roadmap
          </Link>
        </TTButton>
      </div>
      <p className="text-[13px] text-muted-foreground">
        {STATUS_LINE[roadmap.status] ?? roadmap.status} · {roadmap.subjectLabel}
        {destination?.tier === "decided" ? " · Decided by a person" : ""}
      </p>
    </TTCard>
  );
}

/** Nothing is linked yet, and only a person may say which roadmap this is. */
function LinkPanel({
  candidates,
  busy,
  error,
  onLink,
}: {
  candidates: LinkableRoadmap[];
  busy: boolean;
  error: string | null;
  onLink: (roadmapId: string) => void;
}) {
  const [chosen, setChosen] = useState<string>("");

  if (candidates.length === 0) {
    return (
      <EmptyState
        title="No roadmap linked to this project yet."
        belongsHere="Roadmap owns direction. This project can read a roadmap once one exists for this company."
        whyItMatters="Delivery without a destination is just activity."
        action={
          <TTButton asChild variant="secondary">
            <Link to="/modules/roadmap">Open Roadmap</Link>
          </TTButton>
        }
      />
    );
  }

  return (
    <section aria-label="Link a roadmap" className="tt-surface space-y-4 p-6">
      <div>
        <p className="tt-eyebrow">No roadmap linked to this project yet</p>
        <p className="mt-2 max-w-reading text-[15px] text-foreground">
          Choose the roadmap this work is executing. Nothing is guessed for you, and linking writes
          no roadmap truth: it only records which direction this delivery serves.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="sr-only" htmlFor="project-roadmap-choice">
          Roadmap
        </label>
        <select
          id="project-roadmap-choice"
          value={chosen}
          onChange={(event) => setChosen(event.target.value)}
          className="h-10 min-w-64 rounded-lg border border-border bg-card px-3 text-sm text-foreground"
        >
          <option value="">Choose a roadmap…</option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.subjectLabel}
            </option>
          ))}
        </select>
        <TTButton disabled={!chosen || busy} onClick={() => onLink(chosen)}>
          {busy ? "Linking…" : "Link roadmap"}
        </TTButton>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export function ProjectRoadmapTab({
  roadmap,
  milestones,
  loading,
  candidates,
  linking,
  linkError,
  busyId,
  creating,
  createError,
  generating,
  generateStage,
  generateError,
  onGenerate,
  onLink,
  onCreate,
  onStatus,
  onMetric,
  measurements = [],
  measurementsError = null,
  onMeasure,
  criteria = [],
  criteriaError = null,
  evidence = [],
  evidenceError = null,
  onSuccess,
  onAccept,
  onReopen,
  onCriterionAdd,
  onCriterionToggle,
  onCriterionEdit,
  onCriterionRemove,
  onCriterionMove,
  onEvidenceAdd,
  onEvidenceRemove,
  onEvidenceOpen,
  onEvidenceUrl,
}: {
  roadmap: Roadmap | null;
  milestones: RoadmapMilestone[];
  loading: boolean;
  candidates: LinkableRoadmap[];
  linking: boolean;
  linkError: string | null;
  busyId: string | null;
  creating: boolean;
  createError: string | null;
  generating: boolean;
  generateStage: string | null;
  generateError: string | null;
  onGenerate: () => void;
  onLink: (roadmapId: string) => void;
  onCreate: (input: ManualMilestoneInput) => void;
  onStatus: (milestone: RoadmapMilestone, status: MilestoneStatus, note: string) => void;
  onMetric: (milestone: RoadmapMilestone, metric: OutcomeMetricInput | null) => void;
  /**
   * Measurements are Roadmap's truth (Canon 17). The workroom passes them
   * through to the same Roadmap component and the same Roadmap service; it
   * keeps no measurement store of its own.
   */
  measurements?: MilestoneMeasurement[];
  measurementsError?: string | null;
  onMeasure?: ((milestone: RoadmapMilestone, input: MeasurementInput) => void) | undefined;
  /**
   * Outcomes and acceptance criteria are Roadmap's truth too. The workroom
   * passes them to the same Roadmap component and the same Roadmap service.
   */
  criteria?: AcceptanceCriterion[];
  criteriaError?: string | null;
  /** Evidence on those conditions. Roadmap owned, passed straight through. */
  evidence?: CriterionEvidence[];
  evidenceError?: string | null;
  /** The project this workroom belongs to, as Projects records it. */
  deliveryProject?: DeliveryProject | null | undefined;
  onSuccess?: ((milestone: RoadmapMilestone, input: MilestoneSuccessInput) => void) | undefined;
  onAccept?: ((milestone: RoadmapMilestone, note: string) => void) | undefined;
  onReopen?: ((milestone: RoadmapMilestone, reason: string) => void) | undefined;
  onCriterionAdd?: ((milestone: RoadmapMilestone, text: string) => void) | undefined;
  onCriterionToggle?:
    | ((milestone: RoadmapMilestone, criterion: AcceptanceCriterion, done: boolean) => void)
    | undefined;
  onCriterionEdit?:
    | ((milestone: RoadmapMilestone, criterion: AcceptanceCriterion, text: string) => void)
    | undefined;
  onCriterionRemove?:
    ((milestone: RoadmapMilestone, criterion: AcceptanceCriterion) => void) | undefined;
  onCriterionMove?:
    | ((
        milestone: RoadmapMilestone,
        criterion: AcceptanceCriterion,
        direction: "up" | "down",
      ) => void)
    | undefined;
  onEvidenceAdd?:
    | ((milestone: RoadmapMilestone, criterion: AcceptanceCriterion, draft: EvidenceDraft) => void)
    | undefined;
  onEvidenceRemove?: ((item: CriterionEvidence) => void) | undefined;
  onEvidenceOpen?: ((item: CriterionEvidence) => void) | undefined;
  onEvidenceUrl?: ((item: CriterionEvidence) => Promise<string>) | undefined;
}) {
  if (!roadmap) {
    return <LinkPanel candidates={candidates} busy={linking} error={linkError} onLink={onLink} />;
  }

  return (
    <div className="space-y-6">
      <DestinationCard roadmap={roadmap} />

      {loading ? (
        <p className="text-sm text-muted-foreground">Reading the roadmap…</p>
      ) : (
        <>
          <SectionHeading
            eyebrow="Roadmap truth, operated here"
            title="Milestones"
            description="Added, approved and measured through Roadmap's own service. This page is where the work is, not a second copy of it."
          />
          {generateStage ? (
            <p role="status" className="text-sm text-muted-foreground">
              {generateStage}
            </p>
          ) : null}
          {generateError ? (
            <p role="alert" className="text-sm text-destructive">
              {generateError}
            </p>
          ) : null}
          <MilestonesView
            milestones={milestones}
            busyId={busyId}
            generating={generating}
            creating={creating}
            createError={createError}
            onGenerate={onGenerate}
            onCreate={onCreate}
            onStatus={onStatus}
            onMetric={onMetric}
            measurements={measurements}
            measurementsError={measurementsError}
            onMeasure={onMeasure}
            criteria={criteria}
            criteriaError={criteriaError}
            deliveryProjectFor={() => deliveryProject ?? null}
            evidence={evidence}
            evidenceError={evidenceError}
            onSuccess={onSuccess}
            onAccept={onAccept}
            onReopen={onReopen}
            onCriterionAdd={onCriterionAdd}
            onCriterionToggle={onCriterionToggle}
            onCriterionEdit={onCriterionEdit}
            onCriterionRemove={onCriterionRemove}
            onCriterionMove={onCriterionMove}
            onEvidenceAdd={onEvidenceAdd}
            onEvidenceRemove={onEvidenceRemove}
            onEvidenceOpen={onEvidenceOpen}
            onEvidenceUrl={onEvidenceUrl}
          />
        </>
      )}
    </div>
  );
}
