/**
 * Roadmap → Comms, for a client copy.
 *
 * A client copy is written in Roadmap and delivered in Comms. This module is
 * the boundary: it finds the conversation this roadmap already belongs to and
 * leaves a draft there for a person to review. It never creates a
 * relationship, never invents a contact, and never sends anything.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import { clientCopyBody, clientCopySubject } from "@/data/roadmap/detail/client-copy";
import type { CommsDraft, Relationship } from "@/domain/comms";
import type { ID } from "@/domain/entities";
import type { Roadmap } from "@/domain/roadmap";
import type { RoadmapExport } from "@/domain/roadmap-exports";

import { commsService, type CommsContext } from "./comms-service";
import { RELATIONSHIP_COLUMNS, toRelationship, type RelationshipRow } from "./comms-schema";

/**
 * The conversation this roadmap belongs to, by reference only.
 *
 * Tried in order of certainty: the relationship the roadmap was opened from,
 * then the client, then the Scout prospect it came from. No match is a real
 * answer, the person is told to open the conversation in Comms first.
 */
export async function relationshipForRoadmap(
  roadmap: Roadmap,
  organizationId: ID,
): Promise<Relationship | null> {
  const attempts: { column: string; value: ID }[] = [
    ...(roadmap.relationshipId ? [{ column: "id", value: roadmap.relationshipId }] : []),
    ...(roadmap.clientId ? [{ column: "client_id", value: roadmap.clientId }] : []),
    ...(roadmap.prospectId ? [{ column: "prospect_id", value: roadmap.prospectId }] : []),
  ];

  for (const attempt of attempts) {
    const { data, error } = await supabase
      .from("comms_relationships")
      .select(RELATIONSHIP_COLUMNS)
      .eq("organization_id", organizationId)
      .eq(attempt.column, attempt.value)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return toRelationship(data as unknown as RelationshipRow);
  }
  return null;
}

/**
 * Leave the frozen copy in Comms as a draft that needs human review.
 * Sending stays a human act, in Comms, exactly as it is for every other draft.
 */
export async function handClientCopyToComms(
  entry: RoadmapExport,
  relationship: Relationship,
  context: CommsContext,
): Promise<CommsDraft> {
  return commsService.saveDraft(
    {
      relationship,
      register: "follow_up",
      intent: `Send the ${entry.snapshot.company} roadmap, version ${entry.version}`,
      subject: clientCopySubject(entry.snapshot, entry.version),
      body: clientCopyBody(entry),
      reviewState: "needs_human_review",
      rationale: {
        source: "roadmap_client_copy",
        roadmap_id: entry.roadmapId,
        export_id: entry.id,
        version: entry.version,
        point_b_proposed: entry.snapshot.pointBProposed,
      },
      evidence: [
        {
          label: `Roadmap client copy ${entry.version}, frozen ${new Date(entry.createdAt).toLocaleDateString()}`,
          kind: "human",
        },
        ...entry.snapshot.evidence.map((item) => ({
          label: item.label,
          kind: item.url ? ("page" as const) : ("human" as const),
          ...(item.url ? { url: item.url } : {}),
        })),
      ],
    },
    context,
  );
}
