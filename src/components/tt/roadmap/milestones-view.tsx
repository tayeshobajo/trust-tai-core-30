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
import { SuccessPanel } from "@/components/tt/roadmap/success-panel";
import { OwnershipInspector } from "@/components/tt/roadmap/ownership-inspector";
import { EvidenceList } from "@/components/tt/roadmap/tier";
import {
  EmptyState,
  MetaPill,
  SectionHeading,
  TTButton,
  TTInput,
} from "@/components/tt/primitives";
import { CONFIDENCE_LEVEL_LABEL } from "@/domain/confidence";
import { EXECUTION_ROOM_LABEL, ownedExecutionBoundary } from "@/domain/execution-ownership";
import { milestoneActionPrompt, milestoneActions } from "@/domain/milestone-actions";
import type { ManualMilestoneInput } from "@/domain/milestone-create";
import type { MeasurementInput, MilestoneMeasurement } from "@/domain/milestone-measurement";
import type { AcceptanceCriterion } from "@/domain/milestone-criteria";
import type { OutcomeMetricInput } from "@/domain/milestone-metric";
import type { MilestoneSuccessInput } from "@/domain/milestone-success";
import type { MilestoneStatus, RoadmapMilestone } from "@/domain/roadmap-intel";
import { MILESTONE_STATUS_LABEL, UNKNOWN } from "@/domain/roadmap-intel";

const FILTERS: { key: MilestoneStatus | "all"; label: string }[] = [
  { key: "all", label: "All milestones" },
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
  criteria,
  criteriaError,
  onStatus,
  onSuccess,
  onCriterionAdd,
  onCriterionToggle,
  onCriterionEdit,
  onCriterionRemove,
  onCriterionMove,
}: {
  milestone: RoadmapMilestone;
  busyId: string | null;
  criteria: AcceptanceCriterion[];
  criteriaError: string | null;
  onStatus: (milestone: RoadmapMilestone, status: MilestoneStatus, note: string) => void;
  onSuccess?: ((milestone: RoadmapMilestone, input: MilestoneSuccessInput) => void) | undefined;
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
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<MilestoneStatus | null>(null);
  const busy = busyId === milestone.id;

  return (
    <li className="tt-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-2xl text-foreground">{milestone.name}</h3>
          <p className="mt-1 max-w-reading text-sm text-muted-foreground">
            {milestone.whatWeBuild}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <MetaPill>{MILESTONE_STATUS_LABEL[milestone.status]}</MetaPill>
          <MetaPill>Step {milestone.recommendedSequence}</MetaPill>
        </div>
      </div>

      {onSuccess ? (
        <SuccessPanel
          success={milestone.success ?? null}
          subject={milestone.name}
          busy={busy}
          open={editing}
          onOpenChange={setEditing}
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

      {/*
        Numeric measurement is advanced, not the everyday contract. The
        everyday milestone is Outcome, Target date and Acceptance criteria.
        The metric domain and its stored history remain intact underneath.
      */}

      <button
        type="button"
        onClick={() => setDetail((value) => !value)}
        className="mt-5 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        {detail ? "Hide milestone detail" : "Milestone detail"}
      </button>
      {detail ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Line label="Confidence" value={CONFIDENCE_LEVEL_LABEL[milestone.confidence]} />
          <Line label="Priority score" value={String(milestone.priorityScore)} />
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

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <TTButton size="sm" disabled={busy} onClick={() => setEditing((value) => !value)}>
          {editing ? "Close" : "Update milestone"}
        </TTButton>
        <MilestoneOverflow
          milestone={milestone}
          busy={busy}
          onPick={(status) => {
            setPending(status);
            setNote("");
          }}
        />
      </div>

      {pending ? (
        <div className="mt-4 space-y-3 rounded-2xl border border-border p-4">
          <p className="text-sm text-foreground">{milestoneActionPrompt(pending)}.</p>
          <TTInput
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Why this decision (optional)"
            aria-label={`Decision note for ${milestone.name}`}
          />
          <div className="flex flex-wrap gap-2">
            <TTButton
              size="sm"
              disabled={busy}
              onClick={() => {
                onStatus(milestone, pending, note);
                setPending(null);
              }}
            >
              Confirm
            </TTButton>
            <TTButton size="sm" variant="quiet" disabled={busy} onClick={() => setPending(null)}>
              Cancel
            </TTButton>
          </div>
        </div>
      ) : null}

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
  /**
   * Advanced numeric measurement. Accepted for backend compatibility and no
   * longer rendered in the everyday milestone surface.
   */
  onMetric?: ((milestone: RoadmapMilestone, metric: OutcomeMetricInput | null) => void) | undefined;
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
    ((milestone: RoadmapMilestone, criterion: AcceptanceCriterion) => void) | undefined;
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

      <div className="flex items-center gap-2">
        <label htmlFor="milestone-view" className="tt-eyebrow">
          View
        </label>
        <select
          id="milestone-view"
          value={filter}
          onChange={(event) => setFilter(event.target.value as MilestoneStatus | "all")}
          className="h-9 rounded-lg border border-input bg-card px-3 text-sm text-foreground"
        >
          {FILTERS.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.label}
            </option>
          ))}
        </select>
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
              criteria={criteria.filter((row) => row.milestoneId === milestone.id)}
              criteriaError={criteriaError}
              onStatus={onStatus}
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
