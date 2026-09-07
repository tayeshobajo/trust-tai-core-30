/**
 * Roadmap Intelligence service, the one place v2 state is written.
 *
 * Every write keeps the truth model intact:
 *  - Research rows are appended, never overwritten, so history stays readable.
 *  - A strategy item becomes Decided only through an explicit human approval.
 *  - A milestone becomes Decided only when a person approves it.
 *  - Studio and Walkthrough store what happened, never a prettier version.
 *
 * Postgrest errors surface as themselves. Nothing here falls back to demo data.
 */

import { guardRoomWrites } from "@/lib/room-authority";
import { supabase } from "@/integrations/trust-tai/supabase";
import type { ActivityName } from "@/domain/activity";
import type { ID } from "@/domain/entities";
import type {
  ApprovalState,
  ArtifactKind,
  ArtifactSection,
  AskAnswer,
  MilestoneStatus,
  RoadmapArtifact,
  RoadmapMilestone,
  RoadmapResearch,
  RoadmapSession,
  RoadmapStrategy,
  StrategyItem,
  WalkthroughEntry,
} from "@/domain/roadmap-intel";
import type { OutcomeMetric, OutcomeMetricInput } from "@/domain/milestone-metric";
import {
  checkOutcomeMetric,
  metricEventKey,
  metricSummary,
  sameMetric,
} from "@/domain/milestone-metric";
import type { MeasurementInput, MilestoneMeasurement } from "@/domain/milestone-measurement";
import { NO_METRIC_FOR_MEASUREMENT } from "@/domain/milestone-measurement";
import {
  checkMeasurement,
  measuredDay,
  measuredInstant,
  measurementEventKey,
  measurementSummary,
  sortMeasurements,
} from "@/domain/milestone-measurement";
import type { MilestoneSuccess, MilestoneSuccessInput } from "@/domain/milestone-success";
import { checkMilestoneSuccess, sameSuccess, successEventKey } from "@/domain/milestone-success";
import type { AcceptanceCriterion } from "@/domain/milestone-criteria";
import {
  canRemoveCriterion,
  checkCriterionText,
  criterionEventKey,
  findSameCriterion,
  nextCriterionPosition,
  reorderCriteria,
  sortCriteria,
} from "@/domain/milestone-criteria";
import type { CriterionEvidence, CriterionEvidenceType } from "@/domain/criterion-evidence";
import {
  checkEvidenceInput,
  criterionEvidencePath,
  evidenceEventKey,
} from "@/domain/criterion-evidence";
import { PROJECT_FILES_BUCKET } from "@/domain/project-delivery";
import type { ManualMilestoneInput } from "@/domain/milestone-create";
import {
  MANUAL_PRIORITY_RATIONALE,
  checkManualMilestone,
  findSameName,
  manualMilestoneKey,
  nextSequence,
} from "@/domain/milestone-create";
import { rankMilestones, type MilestoneScoreInput } from "@/data/roadmap-milestones";
import type { NormalizedResearch } from "@/data/roadmap-research-parse";

import { supabaseActivity } from "./activities";
import { assertOk } from "./roadmap-schema";
import {
  ARTIFACT_COLUMNS,
  MILESTONE_COLUMNS,
  QUESTION_COLUMNS,
  RESEARCH_COLUMNS,
  SESSION_COLUMNS,
  STRATEGY_COLUMNS,
  entryList,
  sourceList,
  toArtifact,
  toMilestone,
  toResearch,
  toSession,
  toStrategy,
  type Row,
} from "./roadmap-intel-schema";

export interface IntelContext {
  organizationId: ID;
  userId: ID;
  userLabel?: string | undefined;
}

/** One earlier version of a composed document. */
export interface ArtifactVersion {
  id: ID;
  artifactId: ID;
  kind: "preview" | "full";
  version: number;
  title: string;
  provider?: string | undefined;
  model?: string | undefined;
  humanEdited: boolean;
  replacedAt: string;
}

/**
 * Keep the version that is about to be replaced.
 *
 * A composed document is client facing work, and a hand edit is Decided truth,
 * so neither is allowed to disappear because someone pressed compose again.
 * The live row stays one per kind; history lives in its own table.
 */
async function snapshot(context: IntelContext, artifact: RoadmapArtifact): Promise<void> {
  const { error } = await supabase.from("roadmap_artifact_versions").insert({
    organization_id: context.organizationId,
    roadmap_id: artifact.roadmapId,
    artifact_id: artifact.id,
    kind: artifact.kind,
    version: artifact.version,
    title: artifact.title,
    sections: artifact.sections,
    provider: artifact.provider ?? null,
    model: artifact.model ?? null,
    rejected: artifact.rejected,
    human_edited: artifact.humanEdited,
    replaced_at: new Date().toISOString(),
    replaced_by: context.userId,
  });

  /**
   * History is additive. Where the versions table has not been created yet the
   * live document still saves, because losing a snapshot is not a reason to
   * block a person from composing. Every other failure is real and surfaces.
   */
  if (
    error &&
    !/does not exist|schema cache|42P01|PGRST205/i.test(`${error.code} ${error.message}`)
  ) {
    assertOk(error);
  }
}

async function record(
  context: IntelContext,
  name: ActivityName,
  roadmapId: ID,
  label: string,
  summary: string,
  payload: Record<string, unknown> = {},
) {
  const at = new Date().toISOString();
  try {
    await supabaseActivity.record({
      organizationId: context.organizationId,
      name,
      subject: { type: "roadmap", id: roadmapId, label },
      summary,
      payload,
      provenance: {
        appId: "roadmap",
        actor: { type: "user", id: context.userId },
        observedAt: at,
        confidence: "observed",
      },
      occurredAt: at,
    });
  } catch {
    // History matters, but never enough to lose the person's work.
  }
}

/* -------------------------------------------------------------------- read */

export interface RoadmapIntel {
  research: RoadmapResearch | null;
  researchHistory: RoadmapResearch[];
  strategy: RoadmapStrategy | null;
  milestones: RoadmapMilestone[];
  artifacts: RoadmapArtifact[];
  sessions: RoadmapSession[];
  questions: AskAnswer[];
  /** Outcome measurements (P3-02), newest first, across this roadmap. */
  measurements: MilestoneMeasurement[];
  /**
   * Why the measurement history could not be read, when it could not be.
   *
   * An unreadable table is not the same fact as "no measurement recorded yet",
   * so the two are kept apart all the way to the screen.
   */
  measurementsError: string | null;
  /** Acceptance criteria for every milestone on this roadmap, in order. */
  criteria: AcceptanceCriterion[];
  /** Why the checklist could not be read, when it could not be. */
  criteriaError: string | null;
  /** Proof attached to those conditions. Optional by default, never a decision. */
  criterionEvidence: CriterionEvidence[];
  /** Why the attached proof could not be read, when it could not be. */
  criterionEvidenceError: string | null;
}

const MEASUREMENT_COLUMNS = "*";

/** A missing measurements table reads as absent history, never as a crash. */
function missingMeasurements(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return /does not exist|schema cache|42P01|PGRST205|roadmap_measurements/i.test(
    `${error.code ?? ""} ${error.message ?? ""}`,
  );
}

const CRITERION_COLUMNS = "*";

/** A missing criteria table reads as an unreadable checklist, never an empty one. */
function missingCriteria(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return /does not exist|schema cache|42P01|PGRST205|roadmap_milestone_criteria/i.test(
    `${error.code ?? ""} ${error.message ?? ""}`,
  );
}

export const EVIDENCE_NOT_APPLIED =
  "Acceptance evidence is not available in this environment yet: the roadmap_criterion_evidence table has not been applied.";

/** A missing evidence table reads as unreadable proof, never as no proof. */
function missingCriterionEvidence(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return /does not exist|schema cache|42P01|PGRST205|roadmap_criterion_evidence/i.test(
    `${error.code ?? ""} ${error.message ?? ""}`,
  );
}

function toCriterionEvidence(row: Row): CriterionEvidence {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"] ?? ""),
    roadmapId: String(row["roadmap_id"] ?? ""),
    milestoneId: String(row["milestone_id"] ?? ""),
    criterionId: String(row["criterion_id"] ?? ""),
    type: (row["type"] as CriterionEvidenceType) ?? "note",
    label: String(row["label"] ?? ""),
    ...(row["url"] ? { url: String(row["url"]) } : {}),
    ...(row["storage_path"] ? { storagePath: String(row["storage_path"]) } : {}),
    ...(row["content_type"] ? { contentType: String(row["content_type"]) } : {}),
    ...(row["size_bytes"] != null ? { sizeBytes: Number(row["size_bytes"]) } : {}),
    ...(row["note"] ? { note: String(row["note"]) } : {}),
    createdBy: String(row["created_by"] ?? ""),
    ...(row["created_by_label"] ? { createdByLabel: String(row["created_by_label"]) } : {}),
    createdAt: String(row["created_at"] ?? ""),
  };
}

function toCriterion(row: Row): AcceptanceCriterion {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"] ?? ""),
    roadmapId: String(row["roadmap_id"] ?? ""),
    milestoneId: String(row["milestone_id"] ?? ""),
    text: String(row["text"] ?? ""),
    position: Number(row["position"] ?? 1),
    done: Boolean(row["done"]),
    createdBy: String(row["created_by"] ?? ""),
    createdAt: String(row["created_at"] ?? ""),
    ...(row["completed_by"] ? { completedBy: String(row["completed_by"]) } : {}),
    ...(row["completed_at"] ? { completedAt: String(row["completed_at"]) } : {}),
    updatedAt: String(row["updated_at"] ?? row["created_at"] ?? ""),
  };
}

function toMeasurement(row: Row): MilestoneMeasurement {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"] ?? ""),
    roadmapId: String(row["roadmap_id"] ?? ""),
    milestoneId: String(row["milestone_id"] ?? ""),
    metricKey: String(row["metric_key"] ?? ""),
    value: Number(row["value"] ?? 0),
    measuredAt: measuredDay(row["measured_at"]),
    source: String(row["source"] ?? ""),
    recordedBy: String(row["recorded_by"] ?? ""),
    recordedAt: String(row["recorded_at"] ?? row["created_at"] ?? ""),
    sourceEventKey: String(row["source_event_key"] ?? ""),
  };
}

function toAsk(row: Row): AskAnswer {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    roadmapId: String(row["roadmap_id"]),
    question: String(row["question"] ?? ""),
    answer: String(row["answer"] ?? ""),
    facts: Array.isArray(row["facts"])
      ? (row["facts"] as Row[]).map((entry) => ({
          statement: String(entry["statement"] ?? ""),
          sources: sourceList(entry["sources"]),
        }))
      : [],
    inferences: Array.isArray(row["inferences"]) ? row["inferences"].map(String) : [],
    unknowns: Array.isArray(row["unknowns"]) ? row["unknowns"].map(String) : [],
    ...(row["provider"] ? { provider: String(row["provider"]) } : {}),
    ...(row["model"] ? { model: String(row["model"]) } : {}),
    createdAt: String(row["created_at"] ?? new Date().toISOString()),
  };
}

const roadmapIntelRaw = {
  async load(roadmapId: ID): Promise<RoadmapIntel> {
    const [
      research,
      strategy,
      milestones,
      artifacts,
      sessions,
      questions,
      measurements,
      criteria,
      criterionEvidence,
    ] = await Promise.all([
      supabase
        .from("roadmap_research")
        .select(RESEARCH_COLUMNS)
        .eq("roadmap_id", roadmapId)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("roadmap_strategies")
        .select(STRATEGY_COLUMNS)
        .eq("roadmap_id", roadmapId)
        .maybeSingle(),
      supabase
        .from("roadmap_milestones")
        .select(MILESTONE_COLUMNS)
        .eq("roadmap_id", roadmapId)
        .order("recommended_sequence", { ascending: true }),
      supabase.from("roadmap_artifacts").select(ARTIFACT_COLUMNS).eq("roadmap_id", roadmapId),
      supabase
        .from("roadmap_sessions")
        .select(SESSION_COLUMNS)
        .eq("roadmap_id", roadmapId)
        .order("started_at", { ascending: false })
        .limit(20),
      supabase
        .from("roadmap_questions")
        .select(QUESTION_COLUMNS)
        .eq("roadmap_id", roadmapId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("roadmap_measurements")
        .select(MEASUREMENT_COLUMNS)
        .eq("roadmap_id", roadmapId)
        .order("measured_at", { ascending: false })
        .limit(200),
      supabase
        .from("roadmap_milestone_criteria")
        .select(CRITERION_COLUMNS)
        .eq("roadmap_id", roadmapId)
        .order("position", { ascending: true })
        .limit(500),
      supabase
        .from("roadmap_criterion_evidence")
        .select("*")
        .eq("roadmap_id", roadmapId)
        .order("created_at", { ascending: true })
        .limit(1000),
    ]);

    assertOk(research.error);
    assertOk(strategy.error);
    assertOk(milestones.error);
    assertOk(artifacts.error);
    assertOk(sessions.error);
    assertOk(questions.error);

    const history = ((research.data ?? []) as Row[]).map(toResearch);

    return {
      research: history[0] ?? null,
      researchHistory: history,
      strategy: strategy.data ? toStrategy(strategy.data as Row) : null,
      milestones: ((milestones.data ?? []) as Row[]).map(toMilestone),
      artifacts: ((artifacts.data ?? []) as Row[]).map(toArtifact),
      sessions: ((sessions.data ?? []) as Row[]).map(toSession),
      questions: ((questions.data ?? []) as Row[]).map(toAsk),
      measurements: sortMeasurements(((measurements.data ?? []) as Row[]).map(toMeasurement)),
      measurementsError: measurements.error
        ? "Measurement history could not be read here yet, so nothing is shown rather than an empty history."
        : null,
      criteria: sortCriteria(((criteria.data ?? []) as Row[]).map(toCriterion)),
      criteriaError: criteria.error
        ? "The acceptance checklist could not be read here yet, so nothing is shown rather than an empty checklist."
        : null,
      criterionEvidence: ((criterionEvidence.data ?? []) as Row[]).map(toCriterionEvidence),
      criterionEvidenceError: criterionEvidence.error
        ? "Attached evidence could not be read here yet, so nothing is shown rather than an empty list."
        : null,
    };
  },

  /* ---------------------------------------------------------- research */

  async saveResearch(
    context: IntelContext,
    roadmapId: ID,
    label: string,
    research: NormalizedResearch,
    provenance: { provider: string; model: string; checkedAt: string },
  ): Promise<RoadmapResearch> {
    const { data, error } = await supabase
      .from("roadmap_research")
      .insert({
        organization_id: context.organizationId,
        roadmap_id: roadmapId,
        status: "complete",
        company_model: research.companyModel,
        buyers: research.buyers,
        strengths: research.strengths,
        digital_presence: research.digitalPresence,
        competitors: research.competitors,
        market_direction: research.marketDirection,
        sources: research.sources,
        unknowns: research.unknowns,
        provider: provenance.provider,
        model: provenance.model,
        checked_at: provenance.checkedAt,
        created_by: context.userId,
      })
      .select(RESEARCH_COLUMNS)
      .single();

    assertOk(error);
    await record(
      context,
      "roadmap.researched",
      roadmapId,
      label,
      `Researched ${label} against ${research.sources.length} public sources.`,
      { sources: research.sources.length, unknowns: research.unknowns.length, ...provenance },
    );
    return toResearch(data as Row);
  },

  /* ---------------------------------------------------------- strategy */

  async saveStrategy(
    context: IntelContext,
    roadmapId: ID,
    label: string,
    strategy: Omit<
      RoadmapStrategy,
      "id" | "organizationId" | "roadmapId" | "createdAt" | "updatedAt"
    >,
  ): Promise<RoadmapStrategy> {
    const payload = {
      organization_id: context.organizationId,
      roadmap_id: roadmapId,
      point_a: strategy.pointA,
      anchor_proof: strategy.anchorProof,
      horizon: strategy.horizon,
      point_b: strategy.pointB,
      point_c: strategy.pointC,
      central_truth: strategy.centralTruth,
      gaps: strategy.gaps,
      leverage_point: strategy.leveragePoint,
      provider: strategy.provider ?? null,
      model: strategy.model ?? null,
      generated_at: strategy.generatedAt ?? new Date().toISOString(),
      created_by: context.userId,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("roadmap_strategies")
      .upsert(payload, { onConflict: "roadmap_id" })
      .select(STRATEGY_COLUMNS)
      .single();

    assertOk(error);
    await record(
      context,
      "roadmap.generated",
      roadmapId,
      label,
      `Proposed a strategy for ${label}. Every item stays Inferred until a person approves it.`,
    );
    return toStrategy(data as Row);
  },

  /**
   * A person approves, rejects, or defers one strategy item. Approval is the
   * only path from Inferred to Decided, and it is always attributed.
   */
  async setStrategyApproval(
    context: IntelContext,
    strategy: RoadmapStrategy,
    key: string,
    approval: ApprovalState,
    label: string,
  ): Promise<RoadmapStrategy> {
    const at = new Date().toISOString();
    const apply = (item: StrategyItem | null): StrategyItem | null => {
      if (!item || item.key !== key) return item;
      return {
        ...item,
        approval,
        tier: approval === "approved" ? "decided" : "inferred",
        ...(approval === "approved"
          ? { approvedBy: context.userId, approvedAt: at }
          : { approvedBy: undefined, approvedAt: undefined }),
      } as StrategyItem;
    };
    const applyAll = (items: StrategyItem[]) =>
      items.map((item) => apply(item)).filter((item): item is StrategyItem => item !== null);

    const next = {
      ...strategy,
      pointA: applyAll(strategy.pointA),
      anchorProof: applyAll(strategy.anchorProof),
      gaps: applyAll(strategy.gaps),
      pointB: apply(strategy.pointB),
      pointC: apply(strategy.pointC),
      centralTruth: apply(strategy.centralTruth),
      leveragePoint: apply(strategy.leveragePoint),
    };

    const { data, error } = await supabase
      .from("roadmap_strategies")
      .update({
        point_a: next.pointA,
        anchor_proof: next.anchorProof,
        gaps: next.gaps,
        point_b: next.pointB,
        point_c: next.pointC,
        central_truth: next.centralTruth,
        leverage_point: next.leveragePoint,
        updated_at: at,
      })
      .eq("id", strategy.id)
      .select(STRATEGY_COLUMNS)
      .single();

    assertOk(error);
    await record(
      context,
      approval === "approved" ? "roadmap.approved" : "roadmap.decided",
      strategy.roadmapId,
      label,
      `${key} was ${approval} by a person.`,
      { key, approval },
    );
    return toStrategy(data as Row);
  },

  /* -------------------------------------------------------- milestones */

  /**
   * Replace the untouched candidate set with a freshly ranked one. Anything a
   * person has already shortlisted, approved, rejected, or deferred is left
   * exactly where it is.
   */
  async replaceCandidates(
    context: IntelContext,
    roadmapId: ID,
    label: string,
    candidates: (MilestoneScoreInput & { whatWeBuild: string; intendedUser: string })[],
  ): Promise<RoadmapMilestone[]> {
    const cleared = await supabase
      .from("roadmap_milestones")
      .delete()
      .eq("roadmap_id", roadmapId)
      .eq("status", "candidate");
    assertOk(cleared.error);

    const ranked = rankMilestones(candidates);
    if (ranked.length === 0) return [];

    const { data, error } = await supabase
      .from("roadmap_milestones")
      .insert(
        ranked.map((entry) => ({
          organization_id: context.organizationId,
          roadmap_id: roadmapId,
          name: entry.name,
          what_we_build: entry.whatWeBuild,
          intended_user: entry.intendedUser,
          supporting_market_direction: entry.supportingMarketDirection,
          client_advantage: entry.clientAdvantage,
          current_gap: entry.currentGap,
          evidence: entry.evidence,
          immediate_value: entry.immediateValue,
          long_term_value: entry.longTermValue,
          dependencies: entry.dependencies,
          execution_boundary: entry.executionBoundary,
          confidence: entry.confidence,
          priority_score: entry.priorityScore,
          priority_rationale: entry.priorityRationale,
          recommended_sequence: entry.recommendedSequence,
          status: "candidate",
          tier: "inferred",
          created_by: context.userId,
        })),
      )
      .select(MILESTONE_COLUMNS);

    assertOk(error);
    await record(
      context,
      "roadmap.generated",
      roadmapId,
      label,
      `Generated ${ranked.length} milestone candidates for ${label}.`,
      { count: ranked.length },
    );
    return ((data ?? []) as Row[]).map(toMilestone);
  },

  /**
   * Create a milestone by hand (manual create is first class).
   *
   * A person who already knows the milestone does not need a model to state it.
   * Because typing it is itself the decision, the row lands Approved and
   * Decided with the actor and the time on it. Nothing is guessed: research
   * fields a person did not type stay empty, and the priority score stays 0
   * with a rationale that says why. Saving the same name twice on the same
   * roadmap returns the existing milestone instead of duplicating truth.
   */
  async createManualMilestone(
    context: IntelContext,
    roadmapId: ID,
    label: string,
    input: Partial<ManualMilestoneInput>,
    existing: RoadmapMilestone[] = [],
  ): Promise<RoadmapMilestone> {
    const checked = checkManualMilestone(input);
    if (!checked.ok) throw new Error(checked.refusal);

    const duplicate = findSameName(existing, checked.milestone.name);
    if (duplicate) return duplicate;

    const at = new Date().toISOString();
    const { data, error } = await supabase
      .from("roadmap_milestones")
      .insert({
        organization_id: context.organizationId,
        roadmap_id: roadmapId,
        name: checked.milestone.name,
        what_we_build: checked.milestone.whatWeBuild,
        execution_boundary: checked.milestone.executionBoundary,
        priority_rationale: MANUAL_PRIORITY_RATIONALE,
        recommended_sequence: nextSequence(existing),
        status: "approved",
        tier: "decided",
        owner_user_id: context.userId,
        ...(context.userLabel ? { owner_label: context.userLabel } : {}),
        decided_by: context.userId,
        decided_at: at,
        created_by: context.userId,
      })
      .select(MILESTONE_COLUMNS)
      .single();

    assertOk(error);

    await record(
      context,
      "roadmap.approved",
      roadmapId,
      label,
      `${checked.milestone.name} was created by a person as a decided milestone.`,
      {
        milestoneId: (data as Row)["id"],
        origin: "manual",
        source_event_key: manualMilestoneKey(roadmapId, checked.milestone.name),
      },
    );
    return toMilestone(data as Row);
  },

  /** Only this path can make a milestone Decided, and only a person calls it. */
  async setMilestoneStatus(
    context: IntelContext,
    milestone: RoadmapMilestone,
    status: MilestoneStatus,
    label: string,
    note?: string,
  ): Promise<RoadmapMilestone> {
    const at = new Date().toISOString();
    const decided = status === "approved";
    const { data, error } = await supabase
      .from("roadmap_milestones")
      .update({
        status,
        tier: decided ? "decided" : "inferred",
        decision_note: note ?? null,
        decided_by: context.userId,
        decided_at: at,
        ...(decided && !milestone.ownerLabel && context.userLabel
          ? { owner_user_id: context.userId, owner_label: context.userLabel }
          : {}),
        updated_at: at,
      })
      .eq("id", milestone.id)
      .select(MILESTONE_COLUMNS)
      .single();

    assertOk(error);
    await record(
      context,
      decided ? "roadmap.approved" : "roadmap.decided",
      milestone.roadmapId,
      label,
      `${milestone.name} was ${status} by a person.`,
      { milestoneId: milestone.id, status, ...(note ? { note } : {}) },
    );
    return toMilestone(data as Row);
  },

  async setMilestoneOwner(
    context: IntelContext,
    milestone: RoadmapMilestone,
    ownerLabel: string,
  ): Promise<RoadmapMilestone> {
    const { data, error } = await supabase
      .from("roadmap_milestones")
      .update({
        owner_user_id: context.userId,
        owner_label: ownerLabel,
        updated_at: new Date().toISOString(),
      })
      .eq("id", milestone.id)
      .select(MILESTONE_COLUMNS)
      .single();
    assertOk(error);
    return toMilestone(data as Row);
  },

  /**
   * Record or correct the milestone outcome metric (P3-01).
   *
   * Roadmap owns this truth, so this is the only write path. It is manual by
   * design: a person types the key, label, unit, direction, baseline and
   * target, and the metric is stored as Decided with who recorded it. Invalid
   * or partial input is refused outright, nothing is defaulted, and setting the
   * same metric again changes nothing and records no second event.
   */
  async setMilestoneMetric(
    context: IntelContext,
    milestone: RoadmapMilestone,
    input: Partial<OutcomeMetricInput> | null,
    label: string,
  ): Promise<RoadmapMilestone> {
    const current = milestone.outcomeMetric ?? null;
    let next: OutcomeMetric | null = null;

    if (input) {
      const checked = checkOutcomeMetric(input);
      if (!checked.ok) throw new Error(checked.refusal);
      if (sameMetric(current, checked.metric)) return milestone;
      next = {
        ...checked.metric,
        tier: "decided",
        recordedBy: context.userId,
        recordedAt: new Date().toISOString(),
      };
    } else if (!current) {
      return milestone;
    }

    const at = new Date().toISOString();
    const { data, error } = await supabase
      .from("roadmap_milestones")
      .update({
        // The stored contract always carries a baseline object, so an absent
        // baseline is written as an empty one rather than a fake zero.
        outcome_metric: next ? { ...next, baseline: next.baseline ?? {} } : null,
        updated_at: at,
      })
      .eq("id", milestone.id)
      .select(MILESTONE_COLUMNS)
      .single();

    if (error?.message && /outcome_metric/.test(error.message)) {
      throw new Error(
        "Outcome metrics are not available in this environment yet: the roadmap_milestones.outcome_metric column has not been applied.",
      );
    }
    assertOk(error);

    await record(
      context,
      "roadmap.updated",
      milestone.roadmapId,
      label,
      next
        ? `${milestone.name} now measures ${metricSummary(next)}.`
        : `The outcome metric on ${milestone.name} was removed by a person.`,
      {
        milestoneId: milestone.id,
        scope: "outcome_metric",
        ...(next ? { metric: next } : { cleared: true }),
        source_event_key: metricEventKey(milestone.id, next),
      },
    );
    return toMilestone(data as Row);
  },

  /**
   * Record one measurement against a milestone outcome metric (P3-02).
   *
   * Roadmap owns measurement truth, so this is the only write path, and the
   * Project workroom calls this same method rather than keeping its own store.
   *
   * The reading is refused before the database is touched when the milestone
   * has no metric, when the value is not a number, when the measured day is
   * missing or unreal, or when the source says nothing. The metric contract is
   * never touched: baseline and target are read here and left exactly as they
   * were. Submitting the same reading again returns the measurement already on
   * record and writes no second row and no second event.
   */
  async recordMeasurement(
    context: IntelContext,
    milestone: RoadmapMilestone,
    input: Partial<MeasurementInput>,
    label: string,
  ): Promise<MilestoneMeasurement> {
    const metric = milestone.outcomeMetric ?? null;
    const checked = checkMeasurement(metric, input);
    if (!checked.ok) throw new Error(checked.refusal);
    if (!metric) throw new Error(NO_METRIC_FOR_MEASUREMENT);

    // Lineage is proven from the milestone row itself, never from the caller.
    if (milestone.organizationId && milestone.organizationId !== context.organizationId) {
      throw new Error("That milestone belongs to another organization.");
    }
    if (!milestone.roadmapId) {
      throw new Error("That milestone is not attached to a roadmap.");
    }

    const key = measurementEventKey(milestone.id, metric.key, checked.measurement);

    const existing = await supabase
      .from("roadmap_measurements")
      .select(MEASUREMENT_COLUMNS)
      .eq("milestone_id", milestone.id)
      .eq("source_event_key", key)
      .maybeSingle();
    if (existing.error && !missingMeasurements(existing.error)) assertOk(existing.error);
    if (existing.data) return toMeasurement(existing.data as Row);

    const at = new Date().toISOString();
    const { data, error } = await supabase
      .from("roadmap_measurements")
      .insert({
        organization_id: context.organizationId,
        roadmap_id: milestone.roadmapId,
        milestone_id: milestone.id,
        metric_key: metric.key,
        value: checked.measurement.value,
        measured_at: measuredInstant(checked.measurement.measuredAt),
        source: checked.measurement.source,
        recorded_by: context.userId,
        recorded_at: at,
        source_event_key: key,
        provenance: {
          appId: "roadmap",
          actor: {
            type: "user",
            id: context.userId,
            ...(context.userLabel ? { label: context.userLabel } : {}),
          },
          observedAt: at,
          confidence: "observed",
        },
      })
      .select(MEASUREMENT_COLUMNS)
      .single();

    if (error && missingMeasurements(error)) {
      throw new Error(
        "Measurements are not available in this environment yet: the roadmap_measurements table has not been applied.",
      );
    }
    assertOk(error);

    const measurement = toMeasurement(data as Row);
    await record(
      context,
      "roadmap.measured",
      milestone.roadmapId,
      label,
      `${milestone.name} measured ${measurementSummary(measurement, metric)}.`,
      {
        milestoneId: milestone.id,
        measurementId: measurement.id,
        metricKey: metric.key,
        value: measurement.value,
        measuredAt: measurement.measuredAt,
        source: measurement.source,
        source_event_key: key,
      },
    );
    return measurement;
  },

  /** The measurement history for one milestone, newest first. */
  async listMeasurements(milestoneId: ID): Promise<MilestoneMeasurement[]> {
    const { data, error } = await supabase
      .from("roadmap_measurements")
      .select(MEASUREMENT_COLUMNS)
      .eq("milestone_id", milestoneId)
      .order("measured_at", { ascending: false });
    assertOk(error);
    return sortMeasurements(((data ?? []) as Row[]).map(toMeasurement));
  },

  /* ------------------------------------------- success and acceptance */

  /**
   * Write the plain language success definition on a milestone.
   *
   * People describe success. The system structures measurement. This is the
   * everyday path: an outcome sentence, an optional target date, an optional
   * success check. Nothing is defaulted, the target date is never today by
   * accident, and writing the same words again changes nothing.
   */
  async setMilestoneSuccess(
    context: IntelContext,
    milestone: RoadmapMilestone,
    input: Partial<MilestoneSuccessInput> | null,
    label: string,
  ): Promise<RoadmapMilestone> {
    const current = milestone.success ?? null;
    let next: MilestoneSuccess | null = null;

    if (input) {
      const checked = checkMilestoneSuccess(input);
      if (!checked.ok) throw new Error(checked.refusal);
      if (sameSuccess(current, checked.success)) return milestone;
      next = {
        ...checked.success,
        tier: "decided",
        recordedBy: context.userId,
        recordedAt: new Date().toISOString(),
      };
    } else if (!current) {
      return milestone;
    }

    const at = new Date().toISOString();
    const { data, error } = await supabase
      .from("roadmap_milestones")
      .update({ success_definition: next, updated_at: at })
      .eq("id", milestone.id)
      .select(MILESTONE_COLUMNS)
      .single();

    if (error?.message && /success_definition/.test(error.message)) {
      throw new Error(
        "Milestone outcomes are not available in this environment yet: the roadmap_milestones.success_definition column has not been applied.",
      );
    }
    assertOk(error);

    await record(
      context,
      "roadmap.updated",
      milestone.roadmapId,
      label,
      next
        ? `${milestone.name} now succeeds when: ${next.outcome}`
        : `The outcome on ${milestone.name} was removed by a person.`,
      {
        milestoneId: milestone.id,
        scope: "success_definition",
        ...(next ? { success: next } : { cleared: true }),
        source_event_key: successEventKey(milestone.id, next),
      },
    );
    return toMilestone(data as Row);
  },

  async listCriteria(milestoneId: ID): Promise<AcceptanceCriterion[]> {
    const { data, error } = await supabase
      .from("roadmap_milestone_criteria")
      .select(CRITERION_COLUMNS)
      .eq("milestone_id", milestoneId);
    if (error && missingCriteria(error)) return [];
    assertOk(error);
    return sortCriteria(((data ?? []) as Row[]).map(toCriterion));
  },

  /**
   * Add one acceptance criterion. Roadmap owns the checklist, so this is the
   * only write path, and the Project workroom calls this same method.
   */
  async addCriterion(
    context: IntelContext,
    milestone: RoadmapMilestone,
    text: string,
    label: string,
  ): Promise<AcceptanceCriterion> {
    const checked = checkCriterionText(text);
    if (!checked.ok) throw new Error(checked.refusal);

    const existing = await this.listCriteria(milestone.id);
    const duplicate = findSameCriterion(existing, checked.text);
    if (duplicate) return duplicate;

    const at = new Date().toISOString();
    const { data, error } = await supabase
      .from("roadmap_milestone_criteria")
      .insert({
        organization_id: milestone.organizationId,
        roadmap_id: milestone.roadmapId,
        milestone_id: milestone.id,
        text: checked.text,
        position: nextCriterionPosition(existing),
        done: false,
        created_by: context.userId,
        created_at: at,
        updated_at: at,
        source_event_key: criterionEventKey(milestone.id, checked.text),
        provenance: {
          appId: "roadmap",
          actor: { type: "user", id: context.userId, label: context.userLabel ?? null },
          observedAt: at,
          confidence: "observed",
        },
      })
      .select(CRITERION_COLUMNS)
      .single();

    if (error && missingCriteria(error)) {
      throw new Error(
        "Acceptance criteria are not available in this environment yet: the roadmap_milestone_criteria table has not been applied.",
      );
    }
    assertOk(error);

    const criterion = toCriterion(data as Row);
    await record(
      context,
      "roadmap.updated",
      milestone.roadmapId,
      label,
      `An acceptance condition was added to ${milestone.name}: ${criterion.text}`,
      {
        milestoneId: milestone.id,
        scope: "acceptance_criteria",
        criterionId: criterion.id,
        action: "added",
        source_event_key: criterion.id,
      },
    );
    return criterion;
  },

  /** Correct the wording of a condition. The text is the only thing that moves. */
  async editCriterion(
    context: IntelContext,
    criterion: AcceptanceCriterion,
    text: string,
    label: string,
  ): Promise<AcceptanceCriterion> {
    const checked = checkCriterionText(text);
    if (!checked.ok) throw new Error(checked.refusal);
    if (checked.text === criterion.text) return criterion;

    const at = new Date().toISOString();
    const { data, error } = await supabase
      .from("roadmap_milestone_criteria")
      .update({ text: checked.text, updated_at: at })
      .eq("id", criterion.id)
      .select(CRITERION_COLUMNS)
      .single();
    assertOk(error);

    const next = toCriterion(data as Row);
    await record(
      context,
      "roadmap.updated",
      criterion.roadmapId,
      label,
      `An acceptance condition was reworded to: ${next.text}`,
      {
        milestoneId: criterion.milestoneId,
        scope: "acceptance_criteria",
        criterionId: criterion.id,
        action: "edited",
      },
    );
    return next;
  },

  /**
   * Check or uncheck a condition.
   *
   * Checking every box never completes the milestone. It is evidence a person
   * reads before making that call themselves.
   */
  async setCriterionDone(
    context: IntelContext,
    criterion: AcceptanceCriterion,
    done: boolean,
    label: string,
  ): Promise<AcceptanceCriterion> {
    if (criterion.done === done) return criterion;
    const at = new Date().toISOString();
    const { data, error } = await supabase
      .from("roadmap_milestone_criteria")
      .update({
        done,
        completed_by: done ? context.userId : null,
        completed_at: done ? at : null,
        updated_at: at,
      })
      .eq("id", criterion.id)
      .select(CRITERION_COLUMNS)
      .single();
    assertOk(error);

    const next = toCriterion(data as Row);
    await record(
      context,
      "roadmap.updated",
      criterion.roadmapId,
      label,
      done
        ? `An acceptance condition was met: ${next.text}`
        : `An acceptance condition was reopened: ${next.text}`,
      {
        milestoneId: criterion.milestoneId,
        scope: "acceptance_criteria",
        criterionId: criterion.id,
        action: done ? "checked" : "unchecked",
      },
    );
    return next;
  },

  /** Remove a condition that should never have been written. */
  async removeCriterion(
    context: IntelContext,
    criterion: AcceptanceCriterion,
    label: string,
  ): Promise<void> {
    const allowed = canRemoveCriterion(criterion);
    if (!allowed.ok) throw new Error(allowed.refusal);

    const { error } = await supabase
      .from("roadmap_milestone_criteria")
      .delete()
      .eq("id", criterion.id);
    assertOk(error);

    await record(
      context,
      "roadmap.updated",
      criterion.roadmapId,
      label,
      `An acceptance condition was removed: ${criterion.text}`,
      {
        milestoneId: criterion.milestoneId,
        scope: "acceptance_criteria",
        criterionId: criterion.id,
        action: "removed",
      },
    );
  },

  /** Move one condition up or down, keeping the checklist order readable. */
  async moveCriterion(
    context: IntelContext,
    rows: AcceptanceCriterion[],
    criterion: AcceptanceCriterion,
    direction: "up" | "down",
    label: string,
  ): Promise<void> {
    const moves = reorderCriteria(rows, criterion.id, direction);
    if (moves.length === 0) return;
    const at = new Date().toISOString();
    for (const move of moves) {
      const { error } = await supabase
        .from("roadmap_milestone_criteria")
        .update({ position: move.position, updated_at: at })
        .eq("id", move.id);
      assertOk(error);
    }
    await record(
      context,
      "roadmap.updated",
      criterion.roadmapId,
      label,
      `The acceptance checklist order was changed by a person.`,
      {
        milestoneId: criterion.milestoneId,
        scope: "acceptance_criteria",
        criterionId: criterion.id,
        action: "reordered",
      },
    );
  },

  /* ------------------------------------------------ criterion evidence */

  /**
   * Proof attached to the conditions on one roadmap.
   *
   * An unreadable table is a different fact from an empty one, so a missing
   * relation is reported rather than shown as "nothing attached".
   */
  async listCriterionEvidence(roadmapId: ID): Promise<CriterionEvidence[]> {
    const { data, error } = await supabase
      .from("roadmap_criterion_evidence")
      .select("*")
      .eq("roadmap_id", roadmapId)
      .order("created_at", { ascending: true })
      .limit(1000);
    if (error && missingCriterionEvidence(error)) {
      throw new Error(EVIDENCE_NOT_APPLIED);
    }
    assertOk(error);
    return ((data ?? []) as Row[]).map(toCriterionEvidence);
  },

  /**
   * Attach one piece of proof to one condition.
   *
   * A file is uploaded into the existing private project files bucket, under
   * an organization scoped path, before anything is recorded. If the row
   * cannot be written, the object is removed rather than left orphaned.
   *
   * Nothing here checks the criterion. That stays a person's act.
   */
  async addCriterionEvidence(
    context: IntelContext,
    criterion: AcceptanceCriterion,
    raw: { type: CriterionEvidenceType; label?: string; url?: string; note?: string; file?: File },
    label: string,
  ): Promise<CriterionEvidence> {
    const checked = checkEvidenceInput({
      type: raw.type,
      label: raw.type === "file" ? (raw.file?.name ?? raw.label) : raw.label,
      url: raw.url,
      note: raw.note,
    });
    if (!checked.ok) throw new Error(checked.refusal);
    const input = checked.input;

    let storagePath: string | null = null;
    let contentType: string | null = null;
    let sizeBytes: number | null = null;

    if (input.type === "file") {
      const file = raw.file;
      if (!file) throw new Error("Choose a file to attach.");
      const path = criterionEvidencePath(
        criterion.organizationId,
        criterion.milestoneId,
        criterion.id,
        file.name,
      );
      const upload = await supabase.storage.from(PROJECT_FILES_BUCKET).upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (upload.error) throw new Error("That file could not be uploaded.");
      storagePath = path;
      contentType = file.type || null;
      sizeBytes = file.size;
    }

    const at = new Date().toISOString();
    const { data, error } = await supabase
      .from("roadmap_criterion_evidence")
      .insert({
        organization_id: criterion.organizationId,
        roadmap_id: criterion.roadmapId,
        milestone_id: criterion.milestoneId,
        criterion_id: criterion.id,
        type: input.type,
        label: input.label,
        url: input.url ?? null,
        storage_path: storagePath,
        content_type: contentType,
        size_bytes: sizeBytes,
        note: input.note ?? null,
        created_by: context.userId,
        created_by_label: context.userLabel ?? null,
        created_at: at,
        source_event_key: evidenceEventKey(criterion.id, input),
        provenance: {
          appId: "roadmap",
          actor: { type: "user", id: context.userId, label: context.userLabel ?? null },
          observedAt: at,
          confidence: "observed",
        },
      })
      .select("*")
      .single();

    if (error) {
      if (storagePath) {
        await supabase.storage.from(PROJECT_FILES_BUCKET).remove([storagePath]);
      }
      if (missingCriterionEvidence(error)) throw new Error(EVIDENCE_NOT_APPLIED);
      // The same proof attached twice is the same fact, not a failure.
      if (/duplicate key|23505/i.test(`${error.code ?? ""} ${error.message ?? ""}`)) {
        const existing = await supabase
          .from("roadmap_criterion_evidence")
          .select("*")
          .eq("criterion_id", criterion.id)
          .eq("source_event_key", evidenceEventKey(criterion.id, input))
          .maybeSingle();
        if (existing.data) return toCriterionEvidence(existing.data as Row);
      }
      throw new Error("That evidence could not be saved.");
    }

    const saved = toCriterionEvidence(data as Row);
    await record(
      context,
      "roadmap.updated",
      criterion.roadmapId,
      label,
      `Evidence was attached to an acceptance condition: ${saved.label}`,
      {
        milestoneId: criterion.milestoneId,
        scope: "acceptance_evidence",
        criterionId: criterion.id,
        evidenceId: saved.id,
        evidenceType: saved.type,
        action: "attached",
        source_event_key: saved.id,
      },
    );
    return saved;
  },

  /** Remove one piece of proof, explicitly, with the file it stood on. */
  async removeCriterionEvidence(
    context: IntelContext,
    evidence: CriterionEvidence,
    label: string,
  ): Promise<void> {
    const { error } = await supabase
      .from("roadmap_criterion_evidence")
      .delete()
      .eq("id", evidence.id);
    if (error && missingCriterionEvidence(error)) throw new Error(EVIDENCE_NOT_APPLIED);
    assertOk(error);

    if (evidence.storagePath) {
      await supabase.storage.from(PROJECT_FILES_BUCKET).remove([evidence.storagePath]);
    }

    await record(
      context,
      "roadmap.updated",
      evidence.roadmapId,
      label,
      `Evidence was removed from an acceptance condition: ${evidence.label}`,
      {
        milestoneId: evidence.milestoneId,
        scope: "acceptance_evidence",
        criterionId: evidence.criterionId,
        evidenceId: evidence.id,
        action: "removed",
      },
    );
  },

  /** A short lived signed url. Evidence files are private; nothing is public. */
  async criterionEvidenceUrl(evidence: CriterionEvidence): Promise<string> {
    if (!evidence.storagePath) throw new Error("That evidence is not a stored file.");
    const { data, error } = await supabase.storage
      .from(PROJECT_FILES_BUCKET)
      .createSignedUrl(evidence.storagePath, 60);
    if (error || !data?.signedUrl) throw new Error("That file could not be opened.");
    return data.signedUrl;
  },

  /* ----------------------------------------------------------- studio */

  /**
   * Save a composed artifact.
   *
   * A person's edits outrank a regeneration. If the stored document has been
   * edited by hand, this refuses unless the caller explicitly asked to replace
   * it, so Studio can never quietly overwrite someone's work.
   */
  async saveArtifact(
    context: IntelContext,
    roadmapId: ID,
    kind: ArtifactKind,
    title: string,
    sections: ArtifactSection[],
    options?: {
      brand?: { accent?: string | undefined; logoUrl?: string | undefined } | undefined;
      provider?: string | undefined;
      model?: string | undefined;
      rejected?: { section: string; line: string; reason: string }[] | undefined;
      replaceHumanEdits?: boolean | undefined;
    },
  ): Promise<RoadmapArtifact> {
    const existing = await supabase
      .from("roadmap_artifacts")
      .select(ARTIFACT_COLUMNS)
      .eq("roadmap_id", roadmapId)
      .eq("kind", kind)
      .maybeSingle();
    assertOk(existing.error);

    const current = existing.data ? toArtifact(existing.data as Row) : null;
    if (current?.humanEdited && options?.replaceHumanEdits !== true) {
      throw new Error(
        "This document has been edited by hand. Choose replace if you want the new composition to take its place.",
      );
    }

    // Snapshot what is about to be replaced before the live row changes.
    if (current) await snapshot(context, current);

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("roadmap_artifacts")
      .upsert(
        {
          organization_id: context.organizationId,
          roadmap_id: roadmapId,
          kind,
          title,
          sections,
          // Identity is only ever real. Where none was validated, keep whatever
          // was already on record rather than clearing it.
          accent: options?.brand?.accent ?? current?.accent ?? null,
          logo_url: options?.brand?.logoUrl ?? current?.logoUrl ?? null,
          provider: options?.provider ?? null,
          model: options?.model ?? null,
          rejected: options?.rejected ?? [],
          human_edited: false,
          version: (current?.version ?? 0) + 1,
          edited_at: null,
          edited_by: null,
          generated_at: now,
          created_by: context.userId,
          updated_at: now,
        },
        { onConflict: "roadmap_id,kind" },
      )
      .select(ARTIFACT_COLUMNS)
      .single();

    assertOk(error);
    await record(
      context,
      "roadmap.generated",
      roadmapId,
      title,
      `Composed the ${kind === "preview" ? "Roadmap Preview" : "full roadmap"} from approved strategy and approved milestones only.`,
    );
    return toArtifact(data as Row);
  },

  /** A human edit to a composed document. This is Decided truth, so it sticks. */
  async editArtifact(
    context: IntelContext,
    artifact: RoadmapArtifact,
    sections: ArtifactSection[],
    title?: string,
  ): Promise<RoadmapArtifact> {
    await snapshot(context, artifact);
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("roadmap_artifacts")
      .update({
        sections,
        ...(title ? { title } : {}),
        human_edited: true,
        version: artifact.version + 1,
        edited_at: now,
        edited_by: context.userId,
        updated_at: now,
      })
      .eq("id", artifact.id)
      .select(ARTIFACT_COLUMNS)
      .single();

    assertOk(error);
    await record(
      context,
      "roadmap.generated",
      artifact.roadmapId,
      artifact.title,
      "Edited the composed document by hand.",
    );
    return toArtifact(data as Row);
  },

  /** Every version this document has had, newest first. */
  async listArtifactVersions(artifactId: ID): Promise<ArtifactVersion[]> {
    const { data, error } = await supabase
      .from("roadmap_artifact_versions")
      .select("id, artifact_id, kind, version, title, provider, model, human_edited, replaced_at")
      .eq("artifact_id", artifactId)
      .order("version", { ascending: false });
    assertOk(error);
    return ((data ?? []) as Row[]).map((row) => ({
      id: String(row["id"]),
      artifactId: String(row["artifact_id"]),
      kind: row["kind"] === "full" ? "full" : "preview",
      version: typeof row["version"] === "number" ? row["version"] : 1,
      title: String(row["title"] ?? ""),
      provider: row["provider"] ? String(row["provider"]) : undefined,
      model: row["model"] ? String(row["model"]) : undefined,
      humanEdited: row["human_edited"] === true,
      replacedAt: String(row["replaced_at"] ?? new Date().toISOString()),
    }));
  },

  /* ------------------------------------------------------ walkthrough */

  async startSession(context: IntelContext, roadmapId: ID, label: string): Promise<RoadmapSession> {
    const { data, error } = await supabase
      .from("roadmap_sessions")
      .insert({
        organization_id: context.organizationId,
        roadmap_id: roadmapId,
        started_at: new Date().toISOString(),
        entries: [],
        created_by: context.userId,
      })
      .select(SESSION_COLUMNS)
      .single();
    assertOk(error);
    await record(context, "roadmap.updated", roadmapId, label, `Walkthrough started for ${label}.`);
    return toSession(data as Row);
  },

  async appendEntry(
    context: IntelContext,
    session: RoadmapSession,
    entry: Omit<WalkthroughEntry, "at" | "authorId">,
  ): Promise<RoadmapSession> {
    const next: WalkthroughEntry = {
      ...entry,
      at: new Date().toISOString(),
      authorId: context.userId,
    };
    const entries = [...session.entries, next];
    const { data, error } = await supabase
      .from("roadmap_sessions")
      .update({ entries, updated_at: next.at })
      .eq("id", session.id)
      .select(SESSION_COLUMNS)
      .single();
    assertOk(error);

    await record(
      context,
      entry.kind === "approval" ? "roadmap.approved" : "roadmap.decided",
      session.roadmapId,
      "Walkthrough",
      `Captured in the room: ${entry.body}`,
      { kind: entry.kind },
    );
    return toSession(data as Row);
  },

  async endSession(context: IntelContext, session: RoadmapSession): Promise<RoadmapSession> {
    const at = new Date().toISOString();
    const { data, error } = await supabase
      .from("roadmap_sessions")
      .update({ ended_at: at, updated_at: at })
      .eq("id", session.id)
      .select(SESSION_COLUMNS)
      .single();
    assertOk(error);
    return toSession(data as Row);
  },

  /* -------------------------------------------------------------- ask */

  async saveAnswer(
    context: IntelContext,
    roadmapId: ID,
    answer: Omit<AskAnswer, "id" | "organizationId" | "roadmapId" | "createdAt">,
  ): Promise<AskAnswer> {
    const { data, error } = await supabase
      .from("roadmap_questions")
      .insert({
        organization_id: context.organizationId,
        roadmap_id: roadmapId,
        question: answer.question,
        answer: answer.answer,
        facts: answer.facts,
        inferences: answer.inferences,
        unknowns: answer.unknowns,
        provider: answer.provider ?? null,
        model: answer.model ?? null,
        created_by: context.userId,
      })
      .select(QUESTION_COLUMNS)
      .single();
    assertOk(error);
    return toAsk(data as Row);
  },
};

export { entryList };

export const roadmapIntel = guardRoomWrites("roadmap", "Roadmap", roadmapIntelRaw, [
  "load",
  "listArtifactVersions",
]);
