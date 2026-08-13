/**
 * Scout → Comms receiver.
 *
 * A handoff arrives as a brief. Comms turns it into a relationship with the
 * brief's context intact: the named contact, why now, and every required item
 * kept in its own tier. Nothing is inferred here and nothing is sent.
 *
 * If Comms is not provisioned in this backend, the handoff still succeeds in
 * Scout. Scout's job does not depend on Comms being installed.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import { HANDOFF_INTENT_LABEL, type HandoffDraft } from "@/domain/comms-handoff";
import type { MemoryItem, Relationship } from "@/domain/comms";
import type { ID } from "@/domain/entities";

import { commsService, type CommsContext } from "./comms-service";
import { isNotProvisioned, RELATIONSHIP_COLUMNS, toRelationship, type RelationshipRow } from "./comms-schema";

function memoryFromBrief(draft: HandoffDraft): {
  observed: MemoryItem[];
  inferred: MemoryItem[];
  decided: MemoryItem[];
} {
  const at = draft.generatedAt;
  const observed: MemoryItem[] = [];
  const inferred: MemoryItem[] = [];
  const decided: MemoryItem[] = [];

  for (const item of draft.requiredContext) {
    const memory: MemoryItem = {
      label: item.label,
      value: item.value,
      tier: item.tier === "fact" ? "observed" : item.tier === "inference" ? "inferred" : "decided",
      evidence: item.evidence,
      at,
    };
    if (memory.tier === "observed") observed.push(memory);
    else if (memory.tier === "inferred") inferred.push(memory);
    else decided.push(memory);
  }

  decided.push({
    label: "Why we are reaching out",
    value: `${HANDOFF_INTENT_LABEL[draft.intent]}. ${draft.intentBecause}`,
    tier: "decided",
    evidence: [{ label: "Handed over from Scout by a person", kind: "human" }],
    at,
  });

  return { observed, inferred, decided };
}

/** The relationship already carried across for this prospect, if any. */
async function existing(prospectId: ID, organizationId: ID): Promise<Relationship | null> {
  const { data, error } = await supabase
    .from("comms_relationships")
    .select(RELATIONSHIP_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("prospect_id", prospectId)
    .maybeSingle();
  if (error) throw error;
  return data ? toRelationship(data as unknown as RelationshipRow) : null;
}

/**
 * Open the relationship in Comms. Returns the relationship, or null when Comms
 * is not provisioned in this backend.
 */
export async function receiveScoutHandoff(
  draft: HandoffDraft,
  context: CommsContext,
): Promise<Relationship | null> {
  const primary = draft.targets.find((target) => target.rank === "primary") ?? null;
  const contact = primary ?? draft.contact;

  try {
    const already = await existing(draft.prospectId, context.organizationId);
    if (already) return already;

    const memory = memoryFromBrief(draft);
    return await commsService.create(
      {
        fullName: contact?.fullName ?? draft.companyName,
        companyName: draft.companyName,
        email: contact?.email,
        source: "scout_handoff",
        stage: "ready_to_reach",
        prospectId: draft.prospectId,
        ...(primary?.personId ? { contactId: primary.personId } : {}),
        nextAction: `${HANDOFF_INTENT_LABEL[draft.intent]} with ${contact?.fullName ?? "a named contact"}.`,
        observed: memory.observed,
        inferred: memory.inferred,
        decided: memory.decided,
        metadata: {
          scout_handoff: {
            prospect_id: draft.prospectId,
            website_url: draft.websiteUrl ?? null,
            intent: draft.intent,
            confidence: draft.confidence.level,
            generated_at: draft.generatedAt,
          },
        },
      },
      context,
    );
  } catch (error) {
    if (isNotProvisioned(error)) return null;
    throw error;
  }
}
