/**
 * The one place intelligence reads the suite from.
 *
 * It reads Scout, Comms and Roadmap through their existing services, so RLS
 * and organization boundaries are enforced exactly as they already are. A room
 * that fails to read is not guessed at: it is reported as withheld and every
 * downstream answer stays honest about the gap.
 *
 * Reads broadly, writes nothing.
 */

import { commsService } from "@/data/supabase/comms-service";
import { projectsService } from "@/data/supabase/projects-service";
import { roadmapService } from "@/data/supabase/roadmap-service";
import { scoutService } from "@/data/supabase/scout-service";
import { supabaseActivity } from "@/data/supabase/activities";
import { stewardService } from "@/data/supabase/steward-service";
import { assertSameOrganization, type AccessContext } from "@/domain/access";
import { assertCanAuthorizeAction } from "@/domain/action-authority";
import type { ID } from "@/domain/entities";
import type { AskAnswer, ContextBundle, Signal, WithheldSource } from "@/domain/signals";
import type { EntityRef } from "@/domain/entities";
import type { MemoryBelief } from "@/domain/steward-memory";
import type {
  ActionAuthorization,
  ActionProposal,
  EngineRead,
  Hypothesis,
  Recommendation,
  RecommendationDecision,
} from "@/domain/intelligence-engine";
import {
  decidedStatements,
  engineFavouredPatterns,
  enginePatternsToSuppress,
  engineRead,
  learningTrail,
  packetFor,
  proposeActions,
  recommendationOutcomeDraft,
  snapshotFingerprint,
  type LearningTrail,
} from "./engine";

/**
 * One read, taken from a snapshot that has already been loaded.
 *
 * Learned memory travels inside the snapshot, so a read never costs a second
 * pass over the ledger and can never disagree with the evidence it was taken
 * with.
 */
function readFromSnapshot(snapshot: SuiteSnapshot, reasoned?: Hypothesis[]): EngineRead {
  const beliefs = snapshot.memory;
  return engineRead(snapshot, {
    ...(reasoned ? { reasoned } : {}),
    suppressed: enginePatternsToSuppress(beliefs),
    favoured: engineFavouredPatterns(beliefs),
    decided: decidedStatements(beliefs),
  });
}

/** The packet for a snapshot already in hand. */
function packetFromSnapshot(snapshot: SuiteSnapshot) {
  return packetFor(snapshot, {
    suppressed: enginePatternsToSuppress(snapshot.memory),
    decided: decidedStatements(snapshot.memory),
  });
}


import {
  answer as deriveAnswer,
  bundleFor,
  deriveSignals,
  emptySnapshot,
  type SuiteSnapshot,
} from "./derive";

async function safe<T>(
  appId: string,
  fallback: T,
  read: () => Promise<T>,
): Promise<{ value: T; withheld?: WithheldSource }> {
  try {
    return { value: await read() };
  } catch {
    return { value: fallback, withheld: { appId, reason: "unauthorized" } };
  }
}

/**
 * How much of the shared activity record the engine reads.
 *
 * Wide enough that cadence and recurrence across every room are countable,
 * bounded so one workspace can never make a read unbounded.
 */
export const ACTIVITY_READ_LIMIT = 250;

/** Assemble everything the current organization can legitimately read. */
export async function loadSuiteSnapshot(organizationId: ID): Promise<SuiteSnapshot> {
  const base = emptySnapshot(organizationId);
  const [
    candidates,
    relationships,
    roadmaps,
    decisions,
    resolved,
    stages,
    projects,
    events,
    opsActivities,
    steward,
    memory,
  ] = await Promise.all([
    safe("scout", base.candidates, () => scoutService.list(organizationId)),
    safe("comms", base.relationships, () => commsService.list(organizationId)),
    safe("roadmap", base.roadmaps, () => roadmapService.list(organizationId)),
    safe("roadmap", base.openDecisions, () => roadmapService.openDecisions(organizationId)),
    /* Answered decisions: what a person decided, never re-decided here. */
    safe("roadmap", base.resolvedDecisions, () =>
      roadmapService.resolvedDecisions(organizationId),
    ),
    /* Milestones. A failed read stays null: unknown is said, never guessed. */
    safe("roadmap", base.roadmapStages, () => roadmapService.stagesByRoadmap(organizationId)),
    safe("projects", base.projects, () => projectsService.list(organizationId)),
    safe("activity", base.events, () =>
      supabaseActivity.list({ organizationId, limit: ACTIVITY_READ_LIMIT }),
    ),
    safe("ops", base.opsActivities, () =>
      supabaseActivity.list({ organizationId, appIds: ["ops"], limit: 60 }),
    ),
    /* Steward may not be provisioned in a workspace yet; that is withheld, not empty. */
    safe("steward", base.steward, async () => {
      const [commitments, conversations] = await Promise.all([
        stewardService.commitments(organizationId),
        stewardService.conversations(organizationId),
      ]);
      return {
        commitments,
        conversations: conversations.map((conversation) => ({
          id: conversation.id,
          title: conversation.title,
          occurredAt: conversation.occurredAt,
          ...(conversation.sourceUrl ? { url: conversation.sourceUrl } : {}),
        })),
      };
    }),
    /* Learned memory is evidence too: what a person decided is the strongest kind. */
    safe("steward", base.memory, () => stewardService.memory(organizationId)),
  ]);

  const withheld: WithheldSource[] = [];
  for (const part of [
    candidates,
    relationships,
    roadmaps,
    decisions,
    resolved,
    stages,
    projects,
    events,
    opsActivities,
    steward,
    memory,
  ]) {
    if (part.withheld && !withheld.some((w) => w.appId === part.withheld?.appId)) {
      withheld.push(part.withheld);
    }
  }

  return {
    ...base,
    candidates: candidates.value,
    relationships: relationships.value,
    roadmaps: roadmaps.value,
    openDecisions: decisions.value,
    resolvedDecisions: resolved.value,
    roadmapStages: stages.value,
    projects: projects.value,
    events: events.value,
    opsActivities: opsActivities.value,
    steward: steward.value,
    memory: memory.value,
    withheld,
  };
}



export const intelligenceService = {
  snapshot: loadSuiteSnapshot,

  /** Signals across the suite, most urgent first. Derived on read. */
  async signals(organizationId: ID): Promise<Signal[]> {
    return deriveSignals(await loadSuiteSnapshot(organizationId));
  },

  /** Everything known about a subject, or about the organization as a whole. */
  async context(organizationId: ID, subject?: EntityRef): Promise<ContextBundle> {
    return bundleFor(await loadSuiteSnapshot(organizationId), { subject });
  },

  /** Ask in plain language. Answers only from retrieved evidence. */
  async ask(organizationId: ID, question: string, subject?: EntityRef): Promise<AskAnswer> {
    return deriveAnswer(await loadSuiteSnapshot(organizationId), question, { subject });
  },

  /**
   * The Intelligence Engine's read of the business.
   *
   * Reads the suite and whatever the workspace has already learned, then
   * derives observations, readings and proposals. Reasoned hypotheses from the
   * model stage are passed in already verified; without them the read is
   * deterministic and says so.
   */
  async engine(organizationId: ID, reasoned?: Hypothesis[]): Promise<EngineRead> {
    const snapshot = await loadSuiteSnapshot(organizationId);
    return readFromSnapshot(snapshot, reasoned);
  },

  /**
   * One complete run: the snapshot, the read taken from it, and the
   * fingerprint that says whether anything has moved since. Callers that
   * schedule runs use this so the suite is read once, not three times.
   */
  async run(organizationId: ID, reasoned?: Hypothesis[]) {
    const snapshot = await loadSuiteSnapshot(organizationId);
    return {
      read: readFromSnapshot(snapshot, reasoned),
      packet: packetFromSnapshot(snapshot),
      fingerprint: snapshotFingerprint(snapshot),
      trail: learningTrail(snapshot.memory),
    };
  },

  /** The only material the model stage may reason over. */
  async packet(organizationId: ID) {
    return packetFromSnapshot(await loadSuiteSnapshot(organizationId));
  },

  /**
   * What the engine has learned from this workspace's decisions, in full.
   *
   * Read straight from the append-only belief ledger, so the trail is the
   * record itself rather than a summary of it.
   */
  async learning(organizationId: ID): Promise<LearningTrail> {
    const beliefs = await stewardService
      .memory(organizationId)
      .catch(() => [] as MemoryBelief[]);
    return learningTrail(beliefs);
  },



  /**
   * Record what a person decided about a proposal. This is the only write the
   * engine makes, it is append-only, and it is always a person's decision.
   */
  async decide(input: {
    organizationId: ID;
    userId: ID;
    userName: string;
    recommendation: Recommendation;
    decision: RecommendationDecision;
    editedText?: string;
  }): Promise<void> {
    await stewardService.rememberOne({
      organizationId: input.organizationId,
      userId: input.userId,
      userName: input.userName,
      draft: recommendationOutcomeDraft({
        recommendation: input.recommendation,
        decision: input.decision,
        ...(input.editedText ? { editedText: input.editedText } : {}),
      }),
    });
  },
  /**
   * The bounded, reversible actions a proposal may offer. Pure and read-only:
   * offering an action is not the same as being allowed to take it.
   */
  actions(recommendation: Recommendation): ActionProposal[] {
    return proposeActions(recommendation);
  },

  /**
   * Record a person's authorisation of a bounded action.
   *
   * This is permission, not execution. Authority is checked first: the room
   * that owns the change decides which roles may approve work in it, and a
   * refusal writes nothing. Otherwise the engine writes an auditable record
   * that names the person, the room, and the operation, then hands the person
   * to that room to do the work. Nothing is performed on their behalf.
   */
  async authorizeAction(input: {
    organizationId: ID;
    userId: ID;
    userName: string;
    access: AccessContext;
    proposal: ActionProposal;
    decision: ActionAuthorization["decision"];
    note?: string;
  }): Promise<ActionAuthorization> {
    assertSameOrganization(input.access, input.organizationId);
    assertCanAuthorizeAction(input.access, input.proposal);

    const at = new Date().toISOString();
    const authorization: ActionAuthorization = {
      proposalId: input.proposal.id,
      recommendationId: input.proposal.recommendationId,
      appId: input.proposal.appId,
      operation: input.proposal.operation,
      decision: input.decision,
      ...(input.note ? { note: input.note } : {}),
      authorizedBy: { id: input.userId, label: input.userName },
      at,
    };

    await supabaseActivity.record({
      organizationId: input.organizationId,
      name: input.decision === "authorized" ? "decision.approved" : "decision.decided",
      subject: {
        type: "decision",
        id: input.proposal.id,
        label: input.proposal.title,
      },
      summary:
        input.decision === "authorized"
          ? `${input.userName} authorised "${input.proposal.title}" in ${input.proposal.appId}. The work is done there, by a person.`
          : `${input.userName} declined "${input.proposal.title}".`,
      payload: {
        operation: input.proposal.operation,
        recommendationId: input.proposal.recommendationId,
        reversible: input.proposal.reversible,
        willDo: input.proposal.willDo,
        willNotDo: input.proposal.willNotDo,
        route: input.proposal.route,
        ...(input.note ? { note: input.note } : {}),
      },
      provenance: {
        appId: "intelligence",
        actor: { type: "user", id: input.userId, label: input.userName },
        observedAt: at,
        confidence: "observed",
      },
      occurredAt: at,
    });

    return authorization;
  },
};
