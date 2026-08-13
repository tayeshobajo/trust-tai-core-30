/**
 * Roadmap service — the one place roadmap state is written.
 *
 * Roadmaps sequence work; they do not own companies, people, or history.
 * Subjects are pointed at by id (`clients`, `prospects`, `comms_relationships`)
 * and every state change is mirrored into the shared `activities` stream.
 *
 * Draft generation is deterministic (`composeRoadmapDraft`) and reads only
 * evidence already stored in the shared tables. Nothing is invented, and a
 * proposed destination is written as Inferred until a person approves it.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ActivityName } from "@/domain/activity";
import type { ID } from "@/domain/entities";
import type {
  DecisionState,
  Destination,
  NextMove,
  Roadmap,
  RoadmapDecision,
  RoadmapDetail,
  RoadmapNote,
  RoadmapStage,
  RoadmapStatus,
  RoadmapSubjectKind,
  StageState,
} from "@/domain/roadmap";
import { orderStages } from "@/domain/roadmap";
import {
  composeRoadmapDraft,
  type OpenQuestion,
  type RoadmapSourceContext,
} from "@/data/roadmap-draft";

import { supabaseActivity } from "./activities";
import {
  assertOk,
  DECISION_COLUMNS,
  isNotReady,
  notePayload,
  ROADMAP_COLUMNS,
  RoadmapNotReadyError,
  STAGE_COLUMNS,
  toDecision,
  toRoadmap,
  toStage,
  type Row,
} from "./roadmap-schema";

export { RoadmapNotReadyError, isNotReady };

export interface RoadmapContext {
  organizationId: ID;
  userId: ID;
  /** Display name of the signed-in person, used for ownership labels. */
  userLabel?: string | undefined;
}

async function record(
  context: RoadmapContext,
  name: ActivityName,
  subject: { id: ID; label: string },
  summary: string,
  payload: Record<string, unknown> = {},
) {
  const at = new Date().toISOString();
  try {
    await supabaseActivity.record({
      organizationId: context.organizationId,
      name,
      subject: { type: "roadmap", id: subject.id, label: subject.label },
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
    // History is important, but never important enough to lose the user's work.
  }
}

/* --------------------------------------------------------- source evidence */

function note(
  label: string,
  value: string,
  tier: RoadmapNote["tier"],
  evidenceLabel: string,
  at: string,
  url?: string,
): RoadmapNote {
  return {
    label,
    value,
    tier,
    evidence: [{ label: evidenceLabel, kind: url ? "page" : "provider", ...(url ? { url } : {}) }],
    at,
  };
}

function memoryNotes(value: unknown, tier: RoadmapNote["tier"], at: string): RoadmapNote[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Row => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      label: String(entry["label"] ?? "Note"),
      value: String(entry["value"] ?? ""),
      tier,
      evidence: Array.isArray(entry["evidence"])
        ? (entry["evidence"] as { label?: unknown; kind?: unknown; url?: unknown }[]).map((ref) => ({
            label: String(ref.label ?? "Evidence"),
            kind: "provider" as const,
            ...(typeof ref.url === "string" ? { url: ref.url } : {}),
          }))
        : [],
      at: String(entry["at"] ?? at),
    }))
    .filter((item) => item.value.trim().length > 0);
}

export interface SubjectSelection {
  kind: RoadmapSubjectKind;
  id: ID;
}

/**
 * Read everything the organization already knows about a subject.
 * Nothing is fetched from outside Trust Tai; this is recall, not research.
 */
export async function gatherContext(
  subject: SubjectSelection,
  objective: string,
  context: RoadmapContext,
  extraContext?: string,
): Promise<RoadmapSourceContext> {
  const at = new Date().toISOString();
  const observed: RoadmapNote[] = [];
  const inferred: RoadmapNote[] = [];
  const decided: RoadmapNote[] = [];
  const openQuestions: OpenQuestion[] = [];
  let label = "";

  if (subject.kind === "prospect") {
    const { data, error } = await supabase
      .from("prospects")
      .select("id, company_name, website_url, status, fit_score, observed, inferred, suggested")
      .eq("organization_id", context.organizationId)
      .eq("id", subject.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = (data ?? null) as Row | null;
    if (!row) throw new Error("That prospect is not in this workspace.");
    label = String(row["company_name"] ?? "Prospect");
    const site = typeof row["website_url"] === "string" ? row["website_url"] : undefined;
    if (site) observed.push(note("Website", site, "observed", "Public website", at, site));
    observed.push(
      note("Scout status", String(row["status"] ?? "discovered"), "observed", "Scout record", at),
    );
    if (typeof row["fit_score"] === "number") {
      inferred.push(
        note("ICP fit", `Scores ${row["fit_score"]} of 100 against the active ICP.`, "inferred", "Scout fit evaluator", at),
      );
    }
    observed.push(...memoryNotes(row["observed"], "observed", at));
    inferred.push(...memoryNotes(row["inferred"], "inferred", at));
  } else if (subject.kind === "relationship") {
    const { data, error } = await supabase
      .from("comms_relationships")
      .select("id, full_name, company_name, stage, next_action, observed, inferred, decided")
      .eq("organization_id", context.organizationId)
      .eq("id", subject.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = (data ?? null) as Row | null;
    if (!row) throw new Error("That relationship is not in this workspace.");
    const company = typeof row["company_name"] === "string" ? row["company_name"] : "";
    label = company || String(row["full_name"] ?? "Relationship");
    observed.push(
      note("Relationship", String(row["full_name"] ?? ""), "observed", "Comms record", at),
      note("Comms stage", String(row["stage"] ?? "new"), "observed", "Comms record", at),
    );
    observed.push(...memoryNotes(row["observed"], "observed", at));
    inferred.push(...memoryNotes(row["inferred"], "inferred", at));
    decided.push(...memoryNotes(row["decided"], "decided", at));
  } else {
    const { data, error } = await supabase
      .from("clients")
      .select("id, name, status")
      .eq("organization_id", context.organizationId)
      .eq("id", subject.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = (data ?? null) as Row | null;
    if (!row) throw new Error("That client is not in this workspace.");
    label = String(row["name"] ?? "Client");
    observed.push(note("Client status", String(row["status"] ?? "unknown"), "observed", "Client record", at));
  }

  if (extraContext?.trim()) {
    decided.push({
      label: "Added by a person",
      value: extraContext.trim(),
      tier: "decided",
      evidence: [{ label: "Entered when this roadmap was created", kind: "human" }],
      at,
    });
  }

  return {
    subject: { kind: subject.kind, id: subject.id, label },
    objective,
    extraContext,
    observed,
    inferred,
    decided,
    openQuestions,
    ownerUserId: context.userId,
    ownerLabel: context.userLabel,
    generatedAt: at,
  };
}

/* ------------------------------------------------------------------ writes */

function subjectColumn(kind: RoadmapSubjectKind): "client_id" | "prospect_id" | "relationship_id" {
  if (kind === "client") return "client_id";
  if (kind === "prospect") return "prospect_id";
  return "relationship_id";
}

export interface CreateRoadmapInput {
  subject: SubjectSelection;
  objective: string;
  extraContext?: string | undefined;
}

export const roadmapService = {
  async list(organizationId: ID): Promise<Roadmap[]> {
    const { data, error } = await supabase
      .from("roadmaps")
      .select(ROADMAP_COLUMNS)
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false });
    assertOk(error);
    return ((data ?? []) as Row[]).map(toRoadmap);
  },

  /** Open decisions across every roadmap, newest first. Home reads this. */
  async openDecisions(organizationId: ID): Promise<RoadmapDecision[]> {
    const { data, error } = await supabase
      .from("roadmap_decisions")
      .select(DECISION_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("status", "open")
      .order("created_at", { ascending: false });
    assertOk(error);
    return ((data ?? []) as Row[]).map(toDecision);
  },

  async detail(id: ID, organizationId: ID): Promise<RoadmapDetail | null> {
    const { data, error } = await supabase
      .from("roadmaps")
      .select(ROADMAP_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("id", id)
      .maybeSingle();
    assertOk(error);
    if (!data) return null;

    const [stages, decisions] = await Promise.all([
      supabase
        .from("roadmap_stages")
        .select(STAGE_COLUMNS)
        .eq("roadmap_id", id)
        .order("position", { ascending: true }),
      supabase
        .from("roadmap_decisions")
        .select(DECISION_COLUMNS)
        .eq("roadmap_id", id)
        .order("created_at", { ascending: true }),
    ]);
    assertOk(stages.error);
    assertOk(decisions.error);

    return {
      roadmap: toRoadmap(data as Row),
      stages: orderStages(((stages.data ?? []) as Row[]).map(toStage)),
      decisions: ((decisions.data ?? []) as Row[]).map(toDecision),
    };
  },

  /** Existing roadmap for a subject, so a handoff never duplicates one. */
  async findBySubject(subject: SubjectSelection, organizationId: ID): Promise<Roadmap | null> {
    const { data, error } = await supabase
      .from("roadmaps")
      .select(ROADMAP_COLUMNS)
      .eq("organization_id", organizationId)
      .eq(subjectColumn(subject.kind), subject.id)
      .maybeSingle();
    assertOk(error);
    return data ? toRoadmap(data as Row) : null;
  },

  /**
   * Draft a roadmap from what is already known, then persist it.
   * Idempotent per subject: a second call returns the roadmap that exists.
   */
  async create(input: CreateRoadmapInput, context: RoadmapContext): Promise<RoadmapDetail> {
    const existing = await this.findBySubject(input.subject, context.organizationId);
    if (existing) {
      const detail = await this.detail(existing.id, context.organizationId);
      if (detail) return detail;
    }

    const source = await gatherContext(
      input.subject,
      input.objective,
      context,
      input.extraContext,
    );
    const draft = composeRoadmapDraft(source);

    const payload: Row = {
      organization_id: context.organizationId,
      [subjectColumn(input.subject.kind)]: input.subject.id,
      title: draft.title,
      subject_label: source.subject.label,
      objective: input.objective.trim(),
      status: "draft",
      owner_user_id: context.userId,
      point_a: notePayload(draft.pointA),
      point_b: draft.pointB,
      next_move: draft.nextMove,
      metadata: {
        subject_kind: input.subject.kind,
        unknowns: draft.unknowns,
        generated_at: source.generatedAt,
        generator: "roadmap-draft-v1",
      },
      created_by: context.userId,
    };

    const { data, error } = await supabase
      .from("roadmaps")
      .insert(payload)
      .select(ROADMAP_COLUMNS)
      .single();
    assertOk(error);
    if (!data) throw new Error("That roadmap could not be saved.");
    const roadmap = toRoadmap(data as Row);

    if (draft.stages.length > 0) {
      const { error: stageError } = await supabase.from("roadmap_stages").insert(
        draft.stages.map((stage) => ({
          organization_id: context.organizationId,
          roadmap_id: roadmap.id,
          position: stage.position,
          title: stage.title,
          intent: stage.intent,
          state: stage.state,
          tier: stage.tier,
          owner_label: stage.ownerLabel ?? null,
          evidence: stage.evidence,
        })),
      );
      assertOk(stageError);
    }

    if (draft.decisions.length > 0) {
      const { error: decisionError } = await supabase.from("roadmap_decisions").insert(
        draft.decisions.map((decision) => ({
          organization_id: context.organizationId,
          roadmap_id: roadmap.id,
          question: decision.question,
          why_it_matters: decision.whyItMatters,
          options: decision.options ?? [],
          recommendation: decision.recommendation ?? null,
          recommendation_because: decision.recommendationBecause ?? null,
          evidence: decision.evidence ?? [],
          owner_user_id: context.userId,
          status: "open",
          created_by: context.userId,
        })),
      );
      assertOk(decisionError);
    }

    await record(
      context,
      "roadmap.generated",
      { id: roadmap.id, label: roadmap.subjectLabel },
      `A roadmap was drafted for ${roadmap.subjectLabel} from ${source.observed.length} observed ${source.observed.length === 1 ? "fact" : "facts"}.`,
      { subject_kind: input.subject.kind, unknowns: draft.unknowns.length },
    );

    const detail = await this.detail(roadmap.id, context.organizationId);
    if (!detail) throw new Error("That roadmap could not be read back.");
    return detail;
  },

  async setStatus(
    id: ID,
    status: RoadmapStatus,
    label: string,
    context: RoadmapContext,
  ): Promise<Roadmap> {
    const { data, error } = await supabase
      .from("roadmaps")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("organization_id", context.organizationId)
      .select(ROADMAP_COLUMNS)
      .single();
    assertOk(error);
    if (!data) throw new Error("That roadmap could not be updated.");
    await record(
      context,
      "roadmap.status_changed",
      { id, label },
      `${label}'s roadmap moved to ${status.replace("_", " ")}.`,
      { status },
    );
    return toRoadmap(data as Row);
  },

  /** Approving Point B is the moment an inference becomes a human decision. */
  async approveDestination(
    id: ID,
    label: string,
    destination: Destination,
    context: RoadmapContext,
  ): Promise<Roadmap> {
    const at = new Date().toISOString();
    const decided: Destination = {
      ...destination,
      tier: "decided",
      because: "Approved by a person.",
      approvedBy: context.userId,
      approvedAt: at,
    };
    const { data, error } = await supabase
      .from("roadmaps")
      .update({ point_b: decided, status: "approved", updated_at: at })
      .eq("id", id)
      .eq("organization_id", context.organizationId)
      .select(ROADMAP_COLUMNS)
      .single();
    assertOk(error);
    if (!data) throw new Error("That destination could not be approved.");
    await record(
      context,
      "roadmap.approved",
      { id, label },
      `Point B for ${label} was approved: ${decided.statement}`,
    );
    return toRoadmap(data as Row);
  },

  async setNextMove(
    id: ID,
    label: string,
    move: NextMove,
    context: RoadmapContext,
  ): Promise<Roadmap> {
    const { data, error } = await supabase
      .from("roadmaps")
      .update({ next_move: move, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("organization_id", context.organizationId)
      .select(ROADMAP_COLUMNS)
      .single();
    assertOk(error);
    if (!data) throw new Error("That next move could not be saved.");
    await record(context, "roadmap.next_move_changed", { id, label }, `Next move: ${move.action}`);
    return toRoadmap(data as Row);
  },

  async setStageState(
    stage: RoadmapStage,
    state: StageState,
    label: string,
    context: RoadmapContext,
  ): Promise<RoadmapStage> {
    const { data, error } = await supabase
      .from("roadmap_stages")
      .update({ state, updated_at: new Date().toISOString() })
      .eq("id", stage.id)
      .eq("organization_id", context.organizationId)
      .select(STAGE_COLUMNS)
      .single();
    assertOk(error);
    if (!data) throw new Error("That stage could not be updated.");
    await record(
      context,
      "roadmap.stage_changed",
      { id: stage.roadmapId, label },
      `"${stage.title}" moved to ${state.replace("_", " ")}.`,
      { stage_id: stage.id, state },
    );
    return toStage(data as Row);
  },

  async setStageOwner(
    stage: RoadmapStage,
    owner: { userId?: ID | null; label?: string | null },
    roadmapLabel: string,
    context: RoadmapContext,
  ): Promise<RoadmapStage> {
    const { data, error } = await supabase
      .from("roadmap_stages")
      .update({
        owner_user_id: owner.userId ?? null,
        owner_label: owner.label ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", stage.id)
      .eq("organization_id", context.organizationId)
      .select(STAGE_COLUMNS)
      .single();
    assertOk(error);
    if (!data) throw new Error("That owner could not be saved.");
    await record(
      context,
      "roadmap.assigned",
      { id: stage.roadmapId, label: roadmapLabel },
      `"${stage.title}" is carried by ${owner.label ?? "no one"}.`,
      { stage_id: stage.id },
    );
    return toStage(data as Row);
  },

  async addDecision(
    roadmapId: ID,
    roadmapLabel: string,
    question: OpenQuestion,
    context: RoadmapContext,
  ): Promise<RoadmapDecision> {
    const { data, error } = await supabase
      .from("roadmap_decisions")
      .insert({
        organization_id: context.organizationId,
        roadmap_id: roadmapId,
        question: question.question,
        why_it_matters: question.whyItMatters,
        options: question.options ?? [],
        recommendation: question.recommendation ?? null,
        recommendation_because: question.recommendationBecause ?? null,
        evidence: question.evidence ?? [],
        owner_user_id: context.userId,
        status: "open",
        created_by: context.userId,
      })
      .select(DECISION_COLUMNS)
      .single();
    assertOk(error);
    if (!data) throw new Error("That decision could not be saved.");
    await record(
      context,
      "roadmap.decision_requested",
      { id: roadmapId, label: roadmapLabel },
      `Needs a decision: ${question.question}`,
    );
    return toDecision(data as Row);
  },

  async resolveDecision(
    decision: RoadmapDecision,
    status: Exclude<DecisionState, "open">,
    roadmapLabel: string,
    context: RoadmapContext,
    note?: string,
  ): Promise<RoadmapDecision> {
    const at = new Date().toISOString();
    const { data, error } = await supabase
      .from("roadmap_decisions")
      .update({
        status,
        resolution_note: note?.trim() || null,
        resolved_by: context.userId,
        resolved_at: at,
        updated_at: at,
      })
      .eq("id", decision.id)
      .eq("organization_id", context.organizationId)
      .select(DECISION_COLUMNS)
      .single();
    assertOk(error);
    if (!data) throw new Error("That decision could not be recorded.");
    await record(
      context,
      "roadmap.decision_resolved",
      { id: decision.roadmapId, label: roadmapLabel },
      `${decision.question} — ${status}.`,
      { decision_id: decision.id, status },
    );
    return toDecision(data as Row);
  },
};
