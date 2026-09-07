/**
 * Milestones view.
 *
 * More candidates than the roadmap needs, each pressure-tested in the open:
 * what gets built, who it is for, what it closes, and what holds it back. The
 * ranking is derived and always explains itself; the decision is a person's.
 */

import { useEffect, useRef, useState } from "react";

import { ManualMilestoneForm } from "@/components/tt/roadmap/manual-milestone";
import { CriteriaPanel } from "@/components/tt/roadmap/criteria-panel";
import { MetricPanel } from "@/components/tt/roadmap/metric-panel";
import { SuccessPanel } from "@/components/tt/roadmap/success-panel";
import { OwnershipInspector } from "@/components/tt/roadmap/ownership-inspector";
import { EvidenceList, TierChip } from "@/components/tt/roadmap/tier";
import {
  EmptyState,
  MetaPill,
  SectionHeading,
  TTButton,
  TTInput,
} from "@/components/tt/primitives";
import { CONFIDENCE_LEVEL_LABEL } from "@/domain/confidence";
import { EXECUTION_ROOM_LABEL, ownedExecutionBoundary } from "@/domain/execution-ownership";
import type { ManualMilestoneInput } from "@/domain/milestone-create";
import type { MeasurementInput, MilestoneMeasurement } from "@/domain/milestone-measurement";
import type { AcceptanceCriterion } from "@/domain/milestone-criteria";
import type { OutcomeMetricInput } from "@/domain/milestone-metric";
import type { MilestoneSuccessInput } from "@/domain/milestone-success";
import type { MilestoneStatus, RoadmapMilestone } from "@/domain/roadmap-intel";
import { MILESTONE_STATUS_LABEL, UNKNOWN } from "@/domain/roadmap-intel";

const FILTERS: { key: MilestoneStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "candidate", label: "Candidates" },
  { key: "shortlisted", label: "Shortlisted" },
  { key: "approved", label: "Approved" },
  { key: "deferred", label: "Deferred" },
  { key: "rejected", label: "Rejected" },
];

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="tt-eyebrow">{label}</p>
      <p className="mt-1 max-w-reading text-sm text-foreground">{value || UNKNOWN}</p>
    </div>
  );
}

function MilestoneCard({
  milestone,
  busyId,
  measurements,
  measurementsError,
  criteria,
  criteriaError,
  onStatus,
  onMetric,
  onMeasure,
  onSuccess,
  onCriterionAdd,
  onCriterionToggle,
  onCriterionEdit,
  onCriterionRemove,
  onCriterionMove,
}: {
  milestone: RoadmapMilestone;
  busyId: string | null;
  measurements: MilestoneMeasurement[];
  measurementsError: string | null;
  criteria: AcceptanceCriterion[];
  criteriaError: string | null;
  onStatus: (milestone: RoadmapMilestone, status: MilestoneStatus, note: string) => void;
  onMetric: (milestone: RoadmapMilestone, metric: OutcomeMetricInput | null) => void;
  onMeasure?: ((milestone: RoadmapMilestone, input: MeasurementInput) => void) | undefined;
  onSuccess?: ((milestone: RoadmapMilestone, input: MilestoneSuccessInput) => void) | undefined;
  onCriterionAdd?: ((milestone: RoadmapMilestone, text: string) => void) | undefined;
  onCriterionToggle?:
    | ((milestone: RoadmapMilestone, criterion: AcceptanceCriterion, done: boolean) => void)
    | undefined;
  onCriterionEdit?:
    | ((milestone: RoadmapMilestone, criterion: AcceptanceCriterion, text: string) => void)
    | undefined;
  onCriterionRemove?:
    | ((milestone: RoadmapMilestone, criterion: AcceptanceCriterion) => void)
    | undefined;
  onCriterionMove?:
    | ((
        milestone: RoadmapMilestone,
        criterion: AcceptanceCriterion,
        direction: "up" | "down",
      ) => void)
    | undefined;
}) {
  const read = ownedExecutionBoundary(milestone);
  const owned = {
    ownerLabel: EXECUTION_ROOM_LABEL[read.owner.primary],
    because: read.owner.because,
    boundary: read.boundary,
  };
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(false);
  const busy = busyId === milestone.id;

  return (
    <li className="tt-surface p-6">
      <div className="flex flex-wrap items-center gap-2">
        <TierChip tier={milestone.tier} />
        <MetaPill>{MILESTONE_STATUS_LABEL[milestone.status]}</MetaPill>
        <MetaPill>Priority {milestone.priorityScore}</MetaPill>
        <MetaPill>Sequence {milestone.recommendedSequence}</MetaPill>
        <MetaPill>{CONFIDENCE_LEVEL_LABEL[milestone.confidence]}</MetaPill>
      </div>

      <h3 className="mt-3 font-display text-2xl text-foreground">{milestone.name}</h3>
      <p className="mt-1 max-w-reading text-sm text-muted-foreground">{milestone.whatWeBuild}</p>

      {onSuccess ? (
        <SuccessPanel
          success={milestone.success ?? null}
          subject={milestone.name}
          busy={busy}
          onSave={(input) => onSuccess(milestone, input)}
        />
      ) : null}

      {onCriterionAdd ? (
        <CriteriaPanel
          criteria={criteria}
          criteriaError={criteriaError}
          subject={milestone.name}
          busy={busy}
          onAdd={(text) => onCriterionAdd(milestone, text)}
          onToggle={(criterion, done) => onCriterionToggle?.(milestone, criterion, done)}
          onEdit={(criterion, text) => onCriterionEdit?.(milestone, criterion, text)}
          onRemove={(criterion) => onCriterionRemove?.(milestone, criterion)}
          onMove={(criterion, direction) => onCriterionMove?.(milestone, criterion, direction)}
        />
      ) : null}

      <MetricPanel
        metric={milestone.outcomeMetric ?? null}
        subject={milestone.name}
        busy={busy}
        measurements={measurements}
        measurementsError={measurementsError}
        onSave={(metric) => onMetric(milestone, metric)}
        onClear={() => onMetric(milestone, null)}
        onRecord={onMeasure ? (input) => onMeasure(milestone, input) : undefined}
      />

      <button
        type="button"
        onClick={() => setDetail((value) => !value)}
        className="mt-5 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        {detail ? "Hide milestone detail" : "Milestone detail"}
      </button>
      {detail ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Line label="Intended user" value={milestone.intendedUser} />
          <Line label="Supporting market direction" value={milestone.supportingMarketDirection} />
          <Line label="Client advantage" value={milestone.clientAdvantage} />
          <Line label="Current gap" value={milestone.currentGap} />
          <Line label="Immediate value" value={milestone.immediateValue} />
          <Line label="Long term value" value={milestone.longTermValue} />
          <Line label="Dependencies" value={milestone.dependencies.join(", ")} />
          <Line label="Owned by" value={`${owned.ownerLabel} · ${owned.because}`} />
          <Line label="Execution boundary" value={owned.boundary} />
        </div>
      ) : null}

      {detail ? (
        <OwnershipInspector read={read.owner} boundary={owned.boundary} subject={milestone.name} />
      ) : null}

      <EvidenceList
        evidence={milestone.evidence.map((ref) => ({
          label: ref.label,
          url: ref.url,
          kind: "page" as const,
        }))}
      />

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="mt-4 text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        {open ? "Hide why it ranks here" : "Why it ranks here"}
      </button>
      {open ? (
        <ul className="mt-2 space-y-1">
          {milestone.priorityRationale.map((line) => (
            <li key={line} className="text-sm text-muted-foreground">
              · {line}
            </li>
          ))}
        </ul>
      ) : null}

      {milestone.decisionNote ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Decision note: {milestone.decisionNote}
        </p>
      ) : null}

      <div className="mt-5 space-y-3">
        <TTInput
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Why this decision (optional)"
          aria-label={`Decision note for ${milestone.name}`}
        />
        <div className="flex flex-wrap gap-2">
          <TTButton size="sm" disabled={busy} onClick={() => onStatus(milestone, "approved", note)}>
            Approve
          </TTButton>
          <TTButton
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => onStatus(milestone, "shortlisted", note)}
          >
            Shortlist
          </TTButton>
          <TTButton
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => onStatus(milestone, "deferred", note)}
          >
            Defer
          </TTButton>
          <TTButton
            size="sm"
            variant="quiet"
            disabled={busy}
            onClick={() => onStatus(milestone, "rejected", note)}
          >
            Reject
          </TTButton>
        </div>
      </div>
    </li>
  );
}

export function MilestonesView({
  milestones,
  busyId,
  generating,
  creating,
  createError,
  onGenerate,
  onCreate,
  onStatus,
  onMetric,
  measurements = [],
  measurementsError = null,
  onMeasure,
  criteria = [],
  criteriaError = null,
  onSuccess,
  onCriterionAdd,
  onCriterionToggle,
  onCriterionEdit,
  onCriterionRemove,
  onCriterionMove,
}: {
  milestones: RoadmapMilestone[];
  busyId: string | null;
  generating: boolean;
  creating?: boolean;
  createError?: string | null;
  onGenerate: () => void;
  onCreate: (input: ManualMilestoneInput) => void;
  onStatus: (milestone: RoadmapMilestone, status: MilestoneStatus, note: string) => void;
  onMetric: (milestone: RoadmapMilestone, metric: OutcomeMetricInput | null) => void;
  /** P3-02 measurement history for this roadmap, read from Roadmap only. */
  measurements?: MilestoneMeasurement[];
  measurementsError?: string | null;
  onMeasure?: ((milestone: RoadmapMilestone, input: MeasurementInput) => void) | undefined;
  /** Acceptance criteria across this roadmap, read from Roadmap only. */
  criteria?: AcceptanceCriterion[];
  criteriaError?: string | null;
  onSuccess?: ((milestone: RoadmapMilestone, input: MilestoneSuccessInput) => void) | undefined;
  onCriterionAdd?: ((milestone: RoadmapMilestone, text: string) => void) | undefined;
  onCriterionToggle?:
    | ((milestone: RoadmapMilestone, criterion: AcceptanceCriterion, done: boolean) => void)
    | undefined;
  onCriterionEdit?:
    | ((milestone: RoadmapMilestone, criterion: AcceptanceCriterion, text: string) => void)
    | undefined;
  onCriterionRemove?:
    | ((milestone: RoadmapMilestone, criterion: AcceptanceCriterion) => void)
    | undefined;
  onCriterionMove?:
    | ((
        milestone: RoadmapMilestone,
        criterion: AcceptanceCriterion,
        direction: "up" | "down",
      ) => void)
    | undefined;
}) {
  const [filter, setFilter] = useState<MilestoneStatus | "all">("all");
  const [adding, setAdding] = useState(false);
  const count = useRef(milestones.length);
  /** A saved milestone closes the form. A refused one leaves it open to fix. */
  useEffect(() => {
    if (milestones.length !== count.current) {
      count.current = milestones.length;
      setAdding(false);
    }
  }, [milestones.length]);
  const visible =
    filter === "all" ? milestones : milestones.filter((entry) => entry.status === filter);

  const form = (
    <ManualMilestoneForm
      busy={Boolean(creating)}
      error={createError ?? null}
      onCreate={(input) => onCreate(input)}
      onCancel={() => setAdding(false)}
    />
  );

  if (milestones.length === 0) {
    return adding ? (
      form
    ) : (
      <EmptyState
        title="No milestones yet."
        belongsHere="Add one yourself when you already know it, or generate candidates from a research pass and decide between them."
        whyItMatters="A milestone you can name is worth more than one you have to be told."
        action={
          <div className="flex flex-wrap gap-2">
            <TTButton onClick={() => setAdding(true)}>Add milestone</TTButton>
            <TTButton variant="secondary" onClick={onGenerate} disabled={generating}>
              {generating ? "Researching…" : "Generate candidates"}
            </TTButton>
          </div>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow={`${milestones.length} milestones`}
        title="Milestones"
        description="Ranked by evidence, market direction, advantage and boundary. Only a person changes a status."
        action={
          <div className="flex flex-wrap gap-2">
            <TTButton onClick={() => setAdding(true)} disabled={adding}>
              Add milestone
            </TTButton>
            <TTButton variant="secondary" onClick={onGenerate} disabled={generating}>
              {generating ? "Researching…" : "Regenerate candidates"}
            </TTButton>
          </div>
        }
      />

      {adding ? form : null}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setFilter(entry.key)}
            className={
              filter === entry.key
                ? "rounded-full border border-foreground px-3 py-1 text-xs text-foreground"
                : "rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
            }
          >
            {entry.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing in this state yet.</p>
      ) : (
        <ul className="space-y-5">
          {visible.map((milestone) => (
            <MilestoneCard
              key={milestone.id}
              milestone={milestone}
              busyId={busyId}
              measurements={measurements.filter((row) => row.milestoneId === milestone.id)}
              measurementsError={measurementsError}
              criteria={criteria.filter((row) => row.milestoneId === milestone.id)}
              criteriaError={criteriaError}
              onStatus={onStatus}
              onMetric={onMetric}
              onMeasure={onMeasure}
              onSuccess={onSuccess}
              onCriterionAdd={onCriterionAdd}
              onCriterionToggle={onCriterionToggle}
              onCriterionEdit={onCriterionEdit}
              onCriterionRemove={onCriterionRemove}
              onCriterionMove={onCriterionMove}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
