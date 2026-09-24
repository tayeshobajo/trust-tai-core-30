/**
 * The learning unit: the atom of the judgment learning engine (Step 5).
 *
 * Tai's chain:
 *   Context -> Evidence -> World Card -> Decision -> Confidence -> Action ->
 *   Tai intervention -> Human response -> Business outcome ->
 *   Reflection -> Learned principle
 *
 * Everything upstream of Reflection already exists in the stores this module
 * reads: the world card summary and DECIDE verdict on the draft rationale,
 * the dimensional record, the edit-correction record, outcome events, and
 * relationship stage transitions. This module ONLY assembles those into one
 * chain and holds the reflection when one is produced. It writes nothing
 * else and NEVER mutates the evidence it reads: reflections attach beside
 * the events, and any attempt to change `outcome_events` through this module
 * throws.
 *
 * Pure. All rows are passed in; no fetching, no model calls.
 */

import type { DimensionalRecord } from "@/domain/dimensional-record";
import type { EditCorrectionRecord } from "@/domain/edit-correction";
import type { OutcomeEvent } from "@/domain/outcome-fill";
import { readOutcomeEvents } from "@/domain/outcome-fill";

/** Organizational-memory domains a unit (and a principle) can belong to. */
export type PrincipleDomain =
  | "relationship_nurture"
  | "sales"
  | "roadmap"
  | "delivery"
  | "client_success"
  | "finance"
  | "team"
  | "content"
  | "leadership"
  | "improvement";

export interface StageTransition {
  from: string | null;
  to: string;
  occurredAt: string;
}

/** The reflection produced by pass 2, attached to the unit, never to events. */
export interface Reflection {
  /** 1. What did the system believe when it acted (decision + confidence)? */
  believed: string;
  /** 2. What did Tai's intervention change, and what does that teach? */
  interventionTaught: string | null;
  /** 3. What did the human's response or silence actually evidence? */
  responseEvidenced: string;
  /** 4. Candidate principle plus its confidence boundary. */
  candidatePrinciple: CandidatePrinciple | null;
  /** 5. Training-debt read: why Tai, learnable?, what graduates this class? */
  trainingDebt: TrainingDebtRead | null;
  producedAt: string;
  provider: string;
  model: string;
}

export interface CandidatePrinciple {
  /** Target form: "Tai tends toward X, except in context Y, where evidence suggests Z." */
  principle: string;
  scope: { domain: PrincipleDomain; contextTags: string[] };
  /** Where this should and should not generalize, in words. */
  confidenceBoundary: string;
  confidence: number;
  /** True when the reflection reads this as contradicting an existing principle. */
  contradictsExisting?: string | null;
}

export interface TrainingDebtRead {
  whyTai: string;
  judgmentMissing: string;
  learnable: boolean;
  graduationEvidence: string;
}

export interface LearningUnit {
  /** Stable id: the draft id when one exists, else the relationship + moment. */
  id: string;
  organizationId: string;
  relationshipId: string | null;
  draftId: string | null;
  context: {
    register: string | null;
    decideAction: string | null;
    relationshipStage: string | null;
    archetype: string | null;
    domain: PrincipleDomain;
    contextTags: string[];
  };
  worldCardSummary: string | null;
  decide: { action: string; confidence: number; rationale: string[] } | null;
  dimensional: DimensionalRecord | null;
  editCorrection: EditCorrectionRecord | null;
  outcomeEvents: OutcomeEvent[];
  stageTransitions: StageTransition[];
  reflection: Reflection | null;
  reflectionPending: boolean;
  assembledAt: string;
}

/* ------------------------------------------------------------- assembly */

export interface AssembleLearningUnitInput {
  organizationId: string;
  relationshipId?: string | null;
  draftId?: string | null;
  /** The draft's rationale jsonb, as stored (round trip tolerated). */
  rationale?: unknown;
  /** Stage transitions on relationships the clone touched, already read. */
  stageTransitions?: StageTransition[];
  /** Context tags the caller derives from the situation (e.g. milestone_event). */
  contextTags?: string[];
  domain?: PrincipleDomain;
  now?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Assemble one learning unit from the stores the caller already read under
 * RLS. Every leg that is missing stays null and says so; the unit learns
 * only from the legs it honestly has.
 */
export function assembleLearningUnit(input: AssembleLearningUnitInput): LearningUnit {
  const rationale = asRecord(input.rationale) ?? {};
  const decideRaw = asRecord(rationale["decide"]);
  const worldCard = asRecord(rationale["world_card"]);
  const dimensional = asRecord(rationale["dimensional"]) as DimensionalRecord | null;
  const correction = asRecord(rationale["correction"]) as EditCorrectionRecord | null;
  const learning = asRecord(rationale["learning"]);
  const reflection = asRecord(learning?.["reflection"]) as Reflection | null;

  const decide = decideRaw
    ? {
        action: str(decideRaw["action"]) ?? "unknown",
        confidence: typeof decideRaw["confidence"] === "number" ? decideRaw["confidence"] : 0,
        rationale: Array.isArray(decideRaw["rationale"])
          ? (decideRaw["rationale"] as unknown[]).filter((r): r is string => typeof r === "string")
          : [],
      }
    : null;

  return {
    id: input.draftId ?? `${input.relationshipId ?? "unknown"}:${input.now ?? ""}`,
    organizationId: input.organizationId,
    relationshipId: input.relationshipId ?? null,
    draftId: input.draftId ?? null,
    context: {
      register: str(dimensional?.context?.register) ?? null,
      decideAction: decide?.action ?? str(dimensional?.context?.decide_action) ?? null,
      relationshipStage: str(dimensional?.context?.relationship_stage) ?? null,
      archetype: str(dimensional?.context?.archetype) ?? null,
      domain: input.domain ?? "relationship_nurture",
      contextTags: input.contextTags ?? [],
    },
    worldCardSummary: str(worldCard?.["summary"]),
    decide,
    dimensional,
    editCorrection: correction,
    outcomeEvents: readOutcomeEvents(dimensional),
    stageTransitions: input.stageTransitions ?? [],
    reflection,
    reflectionPending: learning?.["reflection_pending"] === true,
    assembledAt: input.now ?? new Date().toISOString(),
  };
}

/* ------------------------------------------- reflection storage, lawful */

/**
 * Mark a stored rationale as reflection-pending (queued path). Additive:
 * the flag lives under `learning`, nothing else in the record changes.
 * Returns null when there is no lawful home.
 */
export function markReflectionPending(
  stored: unknown,
  trigger: "tai_intervention" | "outcome_event" | "stage_transition",
  now?: string,
): Record<string, unknown> | null {
  const record = asRecord(stored);
  if (!record) return null;
  const learning = asRecord(record["learning"]) ?? {};
  if (learning["reflection_pending"] === true) return null;
  return {
    ...record,
    learning: {
      ...learning,
      reflection_pending: true,
      reflection_trigger: trigger,
      reflection_marked_at: now ?? new Date().toISOString(),
    },
  };
}

const eventsFingerprint = (value: unknown): string => JSON.stringify(readOutcomeEvents(value));

/**
 * Attach a reflection to a stored rationale. THE LAW OF THIS ENGINE:
 * reflection never mutates evidence. The returned record's outcome events,
 * correction record and dimensional evidence legs must be byte-identical to
 * what was read; if the caller-supplied reflection object smuggles a
 * different events array, this throws and nothing is written.
 */
export function attachReflection(stored: unknown, reflection: Reflection): Record<string, unknown> {
  const record = asRecord(stored);
  if (!record) {
    throw new Error("A reflection needs an existing record to attach to; nothing was invented.");
  }
  const before = eventsFingerprint(record["dimensional"]);
  const learning = asRecord(record["learning"]) ?? {};
  const next: Record<string, unknown> = {
    ...record,
    learning: {
      ...learning,
      reflection,
      reflection_pending: false,
      reflected_at: reflection.producedAt,
    },
  };
  /* The reflection payload may only occupy `learning`. Evidence legs stay
     exactly as read; a drifted event history is refused, not repaired. */
  const after = eventsFingerprint(next["dimensional"]);
  if (before !== after) {
    throw new Error("Reflection may never mutate outcome events; the write was refused.");
  }
  if (JSON.stringify(record["correction"] ?? null) !== JSON.stringify(next["correction"] ?? null)) {
    throw new Error("Reflection may never mutate a correction record; the write was refused.");
  }
  return next;
}

/**
 * True when this unit's chain gained information worth reflecting on:
 * a Tai intervention, a filled outcome leg, or a stage transition.
 */
export function unitHasNewInformation(unit: LearningUnit): boolean {
  if (unit.reflection) return false;
  const intervened =
    unit.dimensional?.tai_intervention !== undefined &&
    unit.dimensional.tai_intervention !== "none";
  return (
    intervened ||
    unit.editCorrection !== null ||
    unit.outcomeEvents.length > 0 ||
    unit.stageTransitions.length > 0
  );
}
