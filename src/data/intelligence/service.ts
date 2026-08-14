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
import type { ID } from "@/domain/entities";
import type { AskAnswer, ContextBundle, Signal, WithheldSource } from "@/domain/signals";
import type { EntityRef } from "@/domain/entities";

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
  const [candidates, relationships, roadmaps, decisions, projects, events, opsActivities] =
    await Promise.all([
    safe("scout", base.candidates, () => scoutService.list(organizationId)),
    safe("comms", base.relationships, () => commsService.list(organizationId)),
    safe("roadmap", base.roadmaps, () => roadmapService.list(organizationId)),
    safe("roadmap", base.openDecisions, () => roadmapService.openDecisions(organizationId)),
    safe("projects", base.projects, () => projectsService.list(organizationId)),
    safe("activity", base.events, () => supabaseActivity.list({ organizationId, limit: 40 })),
    safe("ops", base.opsActivities, () =>
      supabaseActivity.list({ organizationId, appIds: ["ops"], limit: 60 }),
    ),
  ]);

  const withheld: WithheldSource[] = [];
  for (const part of [candidates, relationships, roadmaps, decisions, projects, events, opsActivities]) {
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
};
