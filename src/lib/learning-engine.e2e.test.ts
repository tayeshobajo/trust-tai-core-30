/**
 * THE END-TO-END PROOF (Step 5, Tai's most important deliverable):
 *
 *   Tai correction -> learned principle -> later similar situation ->
 *   changed clone decision.
 *
 * The clone must demonstrably become DIFFERENT because it learned, not show
 * a dashboard saying learning occurred. This file walks the full arc with
 * fixtures over the real modules: assembly (learning-unit), reflection
 * (reflection.server with a stubbed model caller through the same
 * RuntimeModelCaller shape the boundary hands out), consolidation
 * (consolidation.server + principle-lifecycle), and retrieval
 * (scout-retrieval), asserting at the end that the retrieval packet the
 * decision consumes carries the principle and that the draft-instinct
 * fixture behaves differently because of it.
 */

import { describe, expect, it } from "vitest";

import { buildDimensionalRecord } from "@/domain/dimensional-record";
import { buildEditCorrection } from "@/domain/edit-correction";
import {
  assembleLearningUnit,
  type CandidatePrinciple,
  type LearningUnit,
  type Reflection,
} from "@/domain/learning-unit";
import { promotionReading, type Principle } from "@/domain/principle-lifecycle";
import type { RuntimeModelCaller } from "@/lib/intelligence-runtime.server";
import { reflectOnUnit } from "@/lib/reflection.server";
import { consolidate, influencingPrinciples } from "@/lib/consolidation.server";
import {
  composeScoutRetrieval,
  principlesForScope,
  scoutRetrievalPacket,
  type RetrievalPrinciple,
} from "@/lib/scout-retrieval";

const NOW = "2026-09-24T12:00:00.000Z";
const PRINCIPLE_TEXT =
  "Tai tends toward staying with the person's moment on milestone news, except when help was explicitly requested, where evidence suggests offering it directly.";

/* ------------------------------------------------------------- fixtures */

/**
 * The clone's drafting instinct, as a deterministic fixture: it reads the
 * same packet the real DECIDE/draft path consumes. Without a correction or
 * learned principle about staying with the moment, the instinct on an
 * expansion announcement is to pitch the website. With one in the
 * humanCorrections lane (which outranks inference, permanently), it stays
 * with the moment. This models exactly where DECIDE's inputs change: the
 * retrieval packet's corrections lane.
 */
function draftInstinct(packet: Record<string, unknown>): string {
  const corrections = packet["humanCorrections"] as { lesson: string }[];
  const learned = corrections.some((entry) =>
    entry.lesson.toLowerCase().includes("staying with the person's moment"),
  );
  return learned
    ? "Congratulations on the second office. That is a real milestone, and it says a lot about the trust you have built."
    : "Congratulations on the second office! By the way, I noticed your website does not mention the new location yet. We build sites that...";
}

function expansionRationale(draftedBody: string) {
  return {
    drafted_body: draftedBody,
    decide: { action: "congratulate", confidence: 0.8, rationale: ["Expansion observed."] },
    world_card: { summary: "Agency announced a second office (expansion milestone)." },
    dimensional: buildDimensionalRecord({
      register: "warm_intro",
      decideAction: "congratulate",
      relationshipStage: "aware",
      archetype: "agency",
      confidence: 0.8,
      voice: "pass",
      truth: "pass",
      now: NOW,
    }),
  };
}

function unitFor(
  relationshipId: string,
  draftId: string,
  rationale: Record<string, unknown>,
  contextTags: string[] = ["milestone_event"],
): LearningUnit {
  return assembleLearningUnit({
    organizationId: "org-1",
    relationshipId,
    draftId,
    rationale,
    contextTags,
    domain: "relationship_nurture",
    now: NOW,
  });
}

/** The stubbed model: same RuntimeModelCaller shape the boundary returns. */
function modelReturning(reflection: Record<string, unknown>): RuntimeModelCaller {
  return async () => ({ raw: JSON.stringify(reflection), provider: "test", model: "test" });
}

const CANDIDATE_REFLECTION = {
  believed: "Congratulate the expansion and attach a website pitch, confidence 0.8.",
  interventionTaught:
    "Tai removed the pitch entirely. Do not rush congratulations into opportunity.",
  responseEvidenced: "No outcome data yet; this unit learns from the intervention leg only.",
  candidatePrinciple: {
    principle: PRINCIPLE_TEXT,
    scope: { domain: "relationship_nurture", contextTags: ["milestone_event"] },
    confidenceBoundary:
      "Milestone and expansion touches only; does not cover cold first contact or an explicit request for help.",
    confidence: 0.3,
    contradictsExisting: null,
  },
  trainingDebt: {
    whyTai: "The clone could not weigh relationship-advance against sale-advance.",
    judgmentMissing: "When a touch has earned an offer and when it has not.",
    learnable: true,
    graduationEvidence: "Three milestone touches approved unedited with healthy replies.",
  },
};

/* ------------------------------------------------------------- the arc */

describe("end to end: Tai correction -> principle -> changed decision", () => {
  it("walks the full arc and the clone demonstrably changes", async () => {
    /* (a) The clone drafts for an expansion announcement. No principle
       exists, so the packet's corrections lane is empty and the instinct
       is to pitch the website. */
    const packetBefore = scoutRetrievalPacket(
      composeScoutRetrieval({
        organizationId: "org-1",
        now: NOW,
        subject: "Rivera Creative announced a second office",
      }),
    );
    expect(JSON.stringify(packetBefore)).not.toContain("staying with the person's moment");
    const draftBefore = draftInstinct(packetBefore);
    expect(draftBefore).toContain("your website");

    /* (b) Tai edits to stay with the moment. The edit-correction is
       captured exactly as setDraftState/approveVersion capture it, and the
       immediate reflection produces a candidate principle scoped
       relationship_nurture / milestone_event. */
    const correction = buildEditCorrection({
      situation: {
        register: "warm_intro",
        intent: "congratulate",
        decideAction: "congratulate",
        worldCardSummary: "Agency announced a second office (expansion milestone).",
      },
      draftedBody: draftBefore,
      approvedBody:
        "Congratulations on the second office. That is a real milestone, and it says a lot about the trust you have built.",
      decision: "approved",
      now: NOW,
    })!;
    expect(correction.decision).toBe("approved_with_edits");

    const rationale1 = {
      ...expansionRationale(draftBefore),
      correction,
      dimensional: { ...expansionRationale(draftBefore).dimensional, tai_intervention: "edited" },
    };
    const unit1 = unitFor("rel-1", "draft-1", rationale1);
    const reflected = await reflectOnUnit({
      callModel: modelReturning(CANDIDATE_REFLECTION),
      unit: unit1,
      rationale: rationale1,
      characterBibleRuntimeCard: "prior",
      priorPrinciples: [],
      now: NOW,
    });
    expect(reflected.status).toBe("reflected");
    if (reflected.status !== "reflected") throw new Error("unreachable");
    const candidate1 = reflected.reflection.candidatePrinciple!;
    expect(candidate1.scope).toEqual({
      domain: "relationship_nurture",
      contextTags: ["milestone_event"],
    });
    const unit1Reflected: LearningUnit = { ...unit1, reflection: reflected.reflection };

    /* (c) Two more supporting units on DIFFERENT relationships. The
       consolidation pass clusters all three candidates: the first is
       genuinely new (provisional), the next two reinforce it, and the
       third promotes it to active (3 units across 3 relationships). */
    const unit2: LearningUnit = {
      ...unitFor("rel-2", "draft-2", {
        ...expansionRationale("Congrats! Also, about your site..."),
      }),
      reflection: { ...(reflected.reflection as Reflection) },
    };
    const unit3: LearningUnit = {
      ...unitFor("rel-3", "draft-3", {
        ...expansionRationale("Congrats! Quick thought on your web presence..."),
      }),
      reflection: { ...(reflected.reflection as Reflection) },
    };
    const result = consolidate({
      existingPrinciples: [],
      candidates: [
        { candidate: candidate1, unit: unit1Reflected },
        { candidate: { ...candidate1 }, unit: unit2 },
        { candidate: { ...candidate1 }, unit: unit3 },
      ],
      units: [unit1Reflected, unit2, unit3],
      decisionClassSummaries: [],
      now: NOW,
    });
    expect(result.newProvisional).toHaveLength(1);
    const promoted = influencingPrinciples([...result.principles, ...result.newProvisional]);
    expect(promoted).toHaveLength(1);
    expect(promoted[0]!.status).toBe("active");
    expect(promoted[0]!.relationshipsObserved.sort()).toEqual(["rel-1", "rel-2", "rel-3"]);
    /* All evidence shares one context, so the scope stays milestone_event. */
    expect(promoted[0]!.scope.contextTags).toEqual(["milestone_event"]);

    /* The training-debt report led with why Tai was needed. */
    expect(result.trainingDebt.topDebtItems[0]?.whyTai).toContain("relationship-advance");

    /* (d) A LATER similar situation. The active principle flows into the
       corrections lane for its scope, the retrieval packet the decision
       consumes carries the principle text, and the draft instinct
       demonstrably differs from (a). */
    const stored: RetrievalPrinciple = {
      id: promoted[0]!.id,
      organizationId: "org-1",
      principle: promoted[0]!.principle,
      scope: promoted[0]!.scope,
      status: promoted[0]!.status,
      confidence: promoted[0]!.confidence,
      lastValidatedAt: NOW,
    };
    const inScope = principlesForScope([stored], {
      domain: "relationship_nurture",
      contextTags: ["milestone_event"],
    });
    expect(inScope).toHaveLength(1);
    const packetAfter = scoutRetrievalPacket(
      composeScoutRetrieval({
        organizationId: "org-1",
        now: NOW,
        subject: "Hale & Porter announced a second studio",
        principles: inScope,
      }),
    );
    const corrections = packetAfter["humanCorrections"] as { lesson: string }[];
    expect(corrections.some((entry) => entry.lesson.includes(PRINCIPLE_TEXT))).toBe(true);

    const draftAfter = draftInstinct(packetAfter);
    expect(draftAfter).not.toContain("website");
    expect(draftAfter).toContain("real milestone");
    expect(draftAfter).not.toEqual(draftBefore);

    /* Scope discipline: the same principle does NOT leak into an unrelated
       read (different domain, different context). */
    expect(
      principlesForScope([stored], { domain: "sales", contextTags: ["milestone_event"] }),
    ).toHaveLength(0);
    expect(
      principlesForScope([stored], {
        domain: "relationship_nurture",
        contextTags: ["cold_first_touch"],
      }),
    ).toHaveLength(0);
  });

  it("reflection cannot mutate evidence: the events after reflecting are byte-identical", async () => {
    const rationale = expansionRationale("Congrats! About your website...");
    const withEvents = {
      ...rationale,
      dimensional: {
        ...rationale.dimensional,
        tai_intervention: "edited",
        outcome_events: [
          { kind: "reply_observed", observed_at: NOW, channel: "email_gmail", message_ref: "m1" },
        ],
      },
    };
    const frozen = JSON.stringify(withEvents.dimensional.outcome_events);
    const unit = unitFor("rel-1", "draft-1", withEvents);
    const result = await reflectOnUnit({
      callModel: modelReturning(CANDIDATE_REFLECTION),
      unit,
      rationale: withEvents,
      characterBibleRuntimeCard: "prior",
      priorPrinciples: [],
      now: NOW,
    });
    if (result.status !== "reflected") throw new Error("expected a reflection");
    const after = (result.updatedRationale["dimensional"] as Record<string, unknown>)[
      "outcome_events"
    ];
    expect(JSON.stringify(after)).toBe(frozen);
    /* And the reflection landed beside the evidence, never inside it. */
    expect(
      (result.updatedRationale["learning"] as Record<string, unknown>)["reflection"],
    ).toBeTruthy();
  });

  it("fails closed: no model configured queues the unit and nothing breaks", async () => {
    const { ProviderNotConfiguredError } = await import("@/lib/intelligence-runtime.server");
    const failing: RuntimeModelCaller = async () => {
      throw new ProviderNotConfiguredError("none");
    };
    const rationale = {
      ...expansionRationale("Congrats!"),
      dimensional: { ...expansionRationale("Congrats!").dimensional, tai_intervention: "edited" },
    };
    const result = await reflectOnUnit({
      callModel: failing,
      unit: unitFor("rel-1", "draft-1", rationale),
      rationale,
      characterBibleRuntimeCard: "prior",
      priorPrinciples: [],
      now: NOW,
    });
    expect(result.status).toBe("queued");
    if (result.status !== "queued") throw new Error("unreachable");
    expect(
      (result.updatedRationale?.["learning"] as Record<string, unknown>)["reflection_pending"],
    ).toBe(true);
  });

  it("contradiction moves an active principle to challenged, reduces confidence, and flags Tai", () => {
    const active: Principle = {
      id: "p-active",
      organizationId: "org-1",
      principle: PRINCIPLE_TEXT,
      scope: { domain: "relationship_nurture", contextTags: ["milestone_event"] },
      status: "active",
      source: "inferred",
      confidence: 0.7,
      supportingEvidence: [],
      contradictingEvidence: [],
      contextsObserved: ["milestone_event"],
      relationshipsObserved: ["rel-1"],
      lastValidatedAt: NOW,
      supersededBy: null,
      transitionReason: null,
    };
    const contradicting: CandidatePrinciple = {
      ...CANDIDATE_REFLECTION.candidatePrinciple,
      scope: { domain: "relationship_nurture", contextTags: ["milestone_event"] },
      principle:
        "On milestone news, moving straight to a concrete offer produced the stronger response.",
      contradictsExisting: "p-active",
    };
    const unit = unitFor("rel-4", "draft-9", {
      ...expansionRationale("draft"),
    });
    const result = consolidate({
      existingPrinciples: [active],
      candidates: [{ candidate: contradicting, unit }],
      units: [unit],
      decisionClassSummaries: [],
      now: NOW,
    });
    const challenged = result.principles.find((p) => p.id === "p-active")!;
    expect(challenged.status).toBe("challenged");
    expect(challenged.confidence).toBeLessThan(0.7);
    expect(result.contradictionsForTai).toHaveLength(1);
    expect(result.contradictionsForTai[0]).toContain("needs Tai");
    /* Contradictions never auto-resolve: no supersession happened here. */
    expect(challenged.supersededBy).toBeNull();
  });

  it("promotion is blocked without enough relationships, and context diversity gates universality", () => {
    const singleRel: Principle = {
      id: "p-1",
      organizationId: "org-1",
      principle: PRINCIPLE_TEXT,
      scope: { domain: "relationship_nurture", contextTags: ["milestone_event"] },
      status: "provisional",
      source: "inferred",
      confidence: 0.3,
      supportingEvidence: [
        { unitId: "u1", relationshipId: "rel-1", contextTags: ["milestone_event"], capturedAt: NOW },
        { unitId: "u2", relationshipId: "rel-1", contextTags: ["milestone_event"], capturedAt: NOW },
        { unitId: "u3", relationshipId: "rel-1", contextTags: ["milestone_event"], capturedAt: NOW },
      ],
      contradictingEvidence: [],
      contextsObserved: ["milestone_event"],
      relationshipsObserved: ["rel-1"],
      lastValidatedAt: NOW,
      supersededBy: null,
      transitionReason: null,
    };
    expect(promotionReading(singleRel).eligible).toBe(false);

    const diverse = {
      ...singleRel,
      supportingEvidence: [
        { unitId: "u1", relationshipId: "rel-1", contextTags: ["milestone_event"], capturedAt: NOW },
        { unitId: "u2", relationshipId: "rel-2", contextTags: ["award_announcement"], capturedAt: NOW },
        { unitId: "u3", relationshipId: "rel-3", contextTags: ["milestone_event"], capturedAt: NOW },
      ],
    };
    const reading = promotionReading(diverse);
    expect(reading.eligible).toBe(true);
    expect(reading.universalWithinDomain).toBe(true);
  });

  it("tai_confirmed promotes immediately with scope and evidence preserved", () => {
    const confirmed: Principle = {
      id: "p-tai",
      organizationId: "org-1",
      principle: PRINCIPLE_TEXT,
      scope: { domain: "relationship_nurture", contextTags: ["milestone_event"] },
      status: "provisional",
      source: "tai_confirmed",
      confidence: 0.6,
      supportingEvidence: [
        { unitId: "u1", relationshipId: "rel-1", contextTags: ["milestone_event"], capturedAt: NOW },
      ],
      contradictingEvidence: [],
      contextsObserved: ["milestone_event"],
      relationshipsObserved: ["rel-1"],
      lastValidatedAt: NOW,
      supersededBy: null,
      transitionReason: null,
    };
    const reading = promotionReading(confirmed);
    expect(reading.eligible).toBe(true);
    expect(reading.earnedScope?.contextTags).toEqual(["milestone_event"]);
    expect(reading.because).toContain("evidence and scope preserved");
  });
});
