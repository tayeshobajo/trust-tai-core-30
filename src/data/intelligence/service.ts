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
  packetFor,
  proposeActions,
  recommendationOutcomeDraft,
} from "./engine";


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

/** Assemble everything the current organization can legitimately read. */
export async function loadSuiteSnapshot(organizationId: ID): Promise<SuiteSnapshot> {
  const base = emptySnapshot(organizationId);
  const [
    candidates,
    relationships,
    roadmaps,
    decisions,
    projects,
    events,
    opsActivities,
    steward,
  ] = await Promise.all([
    safe("scout", base.candidates, () => scoutService.list(organizationId)),
    safe("comms", base.relationships, () => commsService.list(organizationId)),
    safe("roadmap", base.roadmaps, () => roadmapService.list(organizationId)),
    safe("roadmap", base.openDecisions, () => roadmapService.openDecisions(organizationId)),
    safe("projects", base.projects, () => projectsService.list(organizationId)),
    safe("activity", base.events, () => supabaseActivity.list({ organizationId, limit: 40 })),
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
  ]);

  const withheld: WithheldSource[] = [];
  for (const part of [
    candidates,
    relationships,
    roadmaps,
    decisions,
    projects,
    events,
    opsActivities,
    steward,
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
    projects: projects.value,
    events: events.value,
    opsActivities: opsActivities.value,
    steward: steward.value,
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
    const [snapshot, beliefs] = await Promise.all([
      loadSuiteSnapshot(organizationId),
      stewardService.memory(organizationId).catch(() => [] as MemoryBelief[]),
    ]);
    return engineRead(snapshot, {
      ...(reasoned ? { reasoned } : {}),
      suppressed: enginePatternsToSuppress(beliefs),
      favoured: engineFavouredPatterns(beliefs),
      decided: decidedStatements(beliefs),
    });
  },

  /** The only material the model stage may reason over. */
  async packet(organizationId: ID) {
    const [snapshot, beliefs] = await Promise.all([
      loadSuiteSnapshot(organizationId),
      stewardService.memory(organizationId).catch(() => [] as MemoryBelief[]),
    ]);
    return packetFor(snapshot, {
      suppressed: enginePatternsToSuppress(beliefs),
      decided: decidedStatements(beliefs),
    });
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
   * This is permission, not execution. The engine writes an auditable record
   * that names the person, the room, and the operation, then hands the person
   * to that room to do the work. Nothing is performed on their behalf.
   */
  async authorizeAction(input: {
    organizationId: ID;
    userId: ID;
    userName: string;
    proposal: ActionProposal;
    decision: ActionAuthorization["decision"];
    note?: string;
  }): Promise<ActionAuthorization> {
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
