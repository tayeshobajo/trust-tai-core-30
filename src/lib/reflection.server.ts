/**
 * Reflection: pass 2 of the judgment learning engine (Step 5).
 *
 * In-product, through the one runtime caller boundary, per Tai's ruling 3:
 * one memory, one judgment spine. OpenClaw invokes, inspects and consumes;
 * it never accumulates a second private Tai model.
 *
 * Hybrid timing (ruling 2):
 *  - IMMEDIATE: a Tai intervention (edit, discard, escalation resolution)
 *    triggers a reflection right away. The hook sites are additive and
 *    best-effort: a reflection failure never touches the human's action.
 *  - QUEUED: ordinary outcome events and stage transitions mark the unit
 *    reflection-pending; processReflectionQueue drains pending units when
 *    the weekly consolidation (or an operator) invokes it. No new cron
 *    lives inside the product; scheduling stays outside (hands, not brains).
 *
 * Reflections attach to the learning unit's rationale under `learning` and
 * are NEVER written into outcome events; attachReflection refuses a write
 * that would drift the evidence (the law lives in src/domain/learning-unit.ts).
 *
 * Fail-closed: with no provider configured, the unit stays (or becomes)
 * reflection-pending, nothing breaks, and the queue answer says so.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  extractJsonObject,
  ProviderCallFailedError,
  ProviderNotConfiguredError,
  runtimeModelCaller,
  type RuntimeModelCaller,
} from "@/lib/intelligence-runtime.server";
import {
  attachReflection,
  markReflectionPending,
  unitHasNewInformation,
  type CandidatePrinciple,
  type LearningUnit,
  type PrincipleDomain,
  type Reflection,
  type TrainingDebtRead,
} from "@/domain/learning-unit";
import type { Principle } from "@/domain/principle-lifecycle";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

const PRINCIPLE_DOMAINS: PrincipleDomain[] = [
  "relationship_nurture",
  "sales",
  "roadmap",
  "delivery",
  "client_success",
  "finance",
  "team",
  "content",
  "leadership",
  "improvement",
];

/**
 * The evidence hierarchy the reflection reasons under (ruling 7). The
 * Character Bible is a PRIOR, not a prison; disagreement between sources is
 * signal, never noise to smooth over.
 */
export const EVIDENCE_HIERARCHY = [
  "1. Character Bible: who Tai generally is. A prior, not a prison.",
  "2. Explicit instruction: Tai's current stated intent. Overrides the prior.",
  "3. Observed corrections: how Tai actually judges when it counts. Overrides both when they disagree; the disagreement itself is signal.",
  "4. Real outcomes: what the world said back. The final examiner; even Tai-taught principles answer to it.",
].join("\n");

export const REFLECTION_INSTRUCTIONS = `You are the reflection pass of Trust Tai OS's judgment learning engine. You are given one
learning unit: the full chain of one decision, from context and evidence through the world
card, the DECIDE verdict, the action taken, any Tai intervention, the human's response or
silence, and any business outcome. You are also given the Character Bible runtime card and
the prior principles relevant to this scope.

Hierarchy of evidence, strongest interpretation discipline you have:
${EVIDENCE_HIERARCHY}

Answer these five questions, honestly and only from the chain:
1. What did the system believe when it acted (decision and confidence)?
2. What did Tai's intervention (if any) change, and what does that teach?
3. What did the human's response or silence actually evidence? Interpretation is made here
   and stays attached to this reflection; it is never written back into events.
4. Candidate principle: one transferable sentence in the form "Tai tends toward X, except in
   context Y, where evidence suggests Z", plus a confidence boundary saying where it should
   and should not generalize. If the unit teaches nothing transferable, return null.
5. Training-debt read: if this required Tai, why? What judgment was missing? Is it learnable?
   What evidence would graduate this decision class? If Tai was not needed, return null.

Laws:
- Use only the chain and the priors given. Never invent people, events or outcomes.
- Units missing outcome data learn only from the intervention leg, and must say so.
- If the candidate principle contradicts a prior principle given to you, name that prior's id
  in contradictsExisting. Contradictions are flagged, never resolved here.
- A single unit is data, not a rule: confidence for a first-observation candidate stays low.

Return strict JSON only:
{"believed":"...","interventionTaught":"..."|null,"responseEvidenced":"...",
"candidatePrinciple":{"principle":"...","scope":{"domain":"relationship_nurture|sales|roadmap|delivery|client_success|finance|team|content|leadership|improvement","contextTags":["..."]},
"confidenceBoundary":"...","confidence":0.0,"contradictsExisting":"..."|null}|null,
"trainingDebt":{"whyTai":"...","judgmentMissing":"...","learnable":true,"graduationEvidence":"..."}|null}`;

/** The packet one reflection call sees: the chain, the prior, the priors. */
export function reflectionPacket(
  unit: LearningUnit,
  characterBibleRuntimeCard: string,
  priorPrinciples: Principle[],
): Record<string, unknown> {
  return {
    learningUnit: {
      context: unit.context,
      worldCardSummary: unit.worldCardSummary,
      decide: unit.decide,
      dimensional: unit.dimensional,
      editCorrection: unit.editCorrection,
      outcomeEvents: unit.outcomeEvents,
      stageTransitions: unit.stageTransitions,
    },
    characterBiblePrior: characterBibleRuntimeCard,
    priorPrinciples: priorPrinciples.map((principle) => ({
      id: principle.id,
      principle: principle.principle,
      scope: principle.scope,
      status: principle.status,
      confidence: principle.confidence,
    })),
    outcomeLegPresent: unit.outcomeEvents.length > 0,
  };
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Parse the model's answer into a Reflection, dropping anything unlawful. */
export function parseReflection(
  raw: string,
  provider: string,
  model: string,
  now: string,
): Reflection {
  const parsed = extractJsonObject(raw) as Record<string, unknown>;
  const candidateRaw = parsed["candidatePrinciple"] as Record<string, unknown> | null;
  const debtRaw = parsed["trainingDebt"] as Record<string, unknown> | null;

  let candidatePrinciple: CandidatePrinciple | null = null;
  if (candidateRaw && typeof candidateRaw === "object") {
    const scope = (candidateRaw["scope"] ?? {}) as Record<string, unknown>;
    const domain = str(scope["domain"]) as PrincipleDomain;
    candidatePrinciple = {
      principle: str(candidateRaw["principle"]),
      scope: {
        domain: PRINCIPLE_DOMAINS.includes(domain) ? domain : "relationship_nurture",
        contextTags: Array.isArray(scope["contextTags"])
          ? (scope["contextTags"] as unknown[]).filter((t): t is string => typeof t === "string")
          : [],
      },
      confidenceBoundary: str(candidateRaw["confidenceBoundary"]),
      confidence:
        typeof candidateRaw["confidence"] === "number"
          ? Math.max(0, Math.min(1, candidateRaw["confidence"]))
          : 0.3,
      contradictsExisting:
        typeof candidateRaw["contradictsExisting"] === "string"
          ? candidateRaw["contradictsExisting"]
          : null,
    };
    if (!candidatePrinciple.principle) candidatePrinciple = null;
  }

  let trainingDebt: TrainingDebtRead | null = null;
  if (debtRaw && typeof debtRaw === "object" && str(debtRaw["whyTai"])) {
    trainingDebt = {
      whyTai: str(debtRaw["whyTai"]),
      judgmentMissing: str(debtRaw["judgmentMissing"]),
      learnable: debtRaw["learnable"] === true,
      graduationEvidence: str(debtRaw["graduationEvidence"]),
    };
  }

  return {
    believed: str(parsed["believed"]),
    interventionTaught:
      typeof parsed["interventionTaught"] === "string" ? parsed["interventionTaught"] : null,
    responseEvidenced: str(parsed["responseEvidenced"]),
    candidatePrinciple,
    trainingDebt,
    producedAt: now,
    provider,
    model,
  };
}

export type ReflectionResult =
  | { status: "reflected"; reflection: Reflection; updatedRationale: Record<string, unknown> }
  | { status: "queued"; reason: string; updatedRationale: Record<string, unknown> | null }
  | { status: "nothing_to_learn" };

/**
 * Reflect on one unit through a caller the boundary already vetted. Pure of
 * persistence: the caller writes updatedRationale wherever the unit lives.
 * Fail-closed: a missing or failing provider queues instead of breaking.
 */
export async function reflectOnUnit(input: {
  callModel: RuntimeModelCaller;
  unit: LearningUnit;
  rationale: unknown;
  characterBibleRuntimeCard: string;
  priorPrinciples: Principle[];
  now?: string;
}): Promise<ReflectionResult> {
  if (!unitHasNewInformation(input.unit)) return { status: "nothing_to_learn" };
  const now = input.now ?? new Date().toISOString();
  try {
    const { raw, provider, model } = await input.callModel({
      instructions: REFLECTION_INSTRUCTIONS,
      input: JSON.stringify(
        reflectionPacket(input.unit, input.characterBibleRuntimeCard, input.priorPrinciples),
      ),
      webSearch: false,
    });
    const reflection = parseReflection(raw, provider, model, now);
    const updatedRationale = attachReflection(input.rationale, reflection);
    return { status: "reflected", reflection, updatedRationale };
  } catch (error) {
    if (error instanceof ProviderNotConfiguredError || error instanceof ProviderCallFailedError) {
      return {
        status: "queued",
        reason:
          error instanceof ProviderNotConfiguredError
            ? "No model is configured; the unit stays queued and nothing breaks."
            : "The provider call failed; the unit stays queued for the next pass.",
        updatedRationale: markReflectionPending(input.rationale, "tai_intervention", now),
      };
    }
    throw error;
  }
}

/**
 * The immediate path: a Tai intervention just happened on a draft. Verifies
 * access once through the boundary, reflects, and writes the reflection back
 * onto the draft's rationale. Best-effort by contract: every failure mode
 * returns instead of throwing, because this runs downstream of a human's
 * approve or discard and must never interfere with it.
 */
export async function reflectImmediately(input: {
  token: string;
  organizationId: string;
  writer: Client;
  draftId: string;
  unit: LearningUnit;
  rationale: unknown;
  characterBibleRuntimeCard: string;
  priorPrinciples: Principle[];
}): Promise<ReflectionResult | { status: "skipped"; reason: string }> {
  try {
    const callModel = await runtimeModelCaller({
      token: input.token,
      organizationId: input.organizationId,
      room: "comms",
      purpose: "reflection",
    });
    const result = await reflectOnUnit({
      callModel,
      unit: input.unit,
      rationale: input.rationale,
      characterBibleRuntimeCard: input.characterBibleRuntimeCard,
      priorPrinciples: input.priorPrinciples,
    });
    if (result.status !== "nothing_to_learn" && result.updatedRationale) {
      await input.writer
        .from("comms_drafts")
        .update({ rationale: result.updatedRationale, updated_at: new Date().toISOString() })
        .eq("id", input.draftId)
        .eq("organization_id", input.organizationId);
    }
    return result;
  } catch (error) {
    return {
      status: "skipped",
      reason: error instanceof Error ? error.message : "Reflection was skipped.",
    };
  }
}

/**
 * The queued path: drain reflection-pending units. Invoked by the weekly
 * consolidation or on demand; the product schedules nothing itself. Each
 * unit is processed independently; one failure queues that unit and the
 * batch continues.
 */
export async function processReflectionQueue(input: {
  callModel: RuntimeModelCaller;
  pending: { unit: LearningUnit; rationale: unknown }[];
  characterBibleRuntimeCard: string;
  priorPrinciples: Principle[];
  persist: (unitId: string, updatedRationale: Record<string, unknown>) => Promise<void>;
}): Promise<{ reflected: number; queued: number; skipped: number }> {
  let reflected = 0;
  let queued = 0;
  let skipped = 0;
  for (const entry of input.pending) {
    const result = await reflectOnUnit({
      callModel: input.callModel,
      unit: entry.unit,
      rationale: entry.rationale,
      characterBibleRuntimeCard: input.characterBibleRuntimeCard,
      priorPrinciples: input.priorPrinciples,
    });
    if (result.status === "reflected") {
      await input.persist(entry.unit.id, result.updatedRationale);
      reflected += 1;
    } else if (result.status === "queued") {
      if (result.updatedRationale) await input.persist(entry.unit.id, result.updatedRationale);
      queued += 1;
    } else {
      skipped += 1;
    }
  }
  return { reflected, queued, skipped };
}
