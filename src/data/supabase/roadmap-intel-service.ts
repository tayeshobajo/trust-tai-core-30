/**
 * Roadmap Intelligence service — the one place v2 state is written.
 *
 * Every write keeps the truth model intact:
 *  - Research rows are appended, never overwritten, so history stays readable.
 *  - A strategy item becomes Decided only through an explicit human approval.
 *  - A milestone becomes Decided only when a person approves it.
 *  - Studio and Walkthrough store what happened, never a prettier version.
 *
 * Postgrest errors surface as themselves. Nothing here falls back to demo data.
 */

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

export const roadmapIntel = {
  async load(roadmapId: ID): Promise<RoadmapIntel> {
    const [research, strategy, milestones, artifacts, sessions, questions] = await Promise.all([
      supabase
        .from("roadmap_research")
        .select(RESEARCH_COLUMNS)
        .eq("roadmap_id", roadmapId)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase.from("roadmap_strategies").select(STRATEGY_COLUMNS).eq("roadmap_id", roadmapId).maybeSingle(),
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
          accent: options?.brand?.accent ?? null,
          logo_url: options?.brand?.logoUrl ?? null,
          provider: options?.provider ?? null,
          model: options?.model ?? null,
          rejected: options?.rejected ?? [],
          human_edited: false,
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
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("roadmap_artifacts")
      .update({
        sections,
        ...(title ? { title } : {}),
        human_edited: true,
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
