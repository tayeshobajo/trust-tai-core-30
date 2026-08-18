/**
 * Comms → Roadmap handoff contract.
 *
 * Roadmap sequences work for a subject that already exists; it never invents a
 * company, a person, or a conversation. This module is the explicit gate on
 * that boundary: it decides whether a relationship carries enough real,
 * two-way evidence for sequencing to be honest, and it says plainly what is
 * missing when it does not.
 *
 * Pure and deterministic. It reads the relationship Comms already owns and
 * copies nothing: the handoff carries the relationship id, not its record.
 * A roadmap is still opened by a person pressing the button, nothing here
 * auto-creates one, and weak evidence refuses rather than guesses.
 */

import type { Relationship, RelationshipStage } from "@/domain/comms";
import type { ID } from "@/domain/entities";

/** Stages that mean the other side has actually engaged. */
const ENGAGED_STAGES: RelationshipStage[] = [
  "in_conversation",
  "meeting_set",
  "opportunity",
  "client",
];

/** Stages where sequencing a path would be premature by definition. */
const PREMATURE_STAGES: RelationshipStage[] = ["new", "researching", "ready_to_reach"];

const CLOSED_STAGES: RelationshipStage[] = ["archived"];

export interface RoadmapHandoffReadiness {
  ready: boolean;
  /** Plain-language reason, shown to the person. Always present. */
  because: string;
  /** What the handoff would carry across, for display before it happens. */
  carries: string[];
}

/**
 * The reference a roadmap receives. Stable ids and a label, never a copy of
 * the relationship, the contact, or the conversation.
 */
export interface RoadmapHandoffRef {
  kind: "relationship";
  id: ID;
  label: string;
  /** Carried so Roadmap can join back to Scout truth without re-researching. */
  prospectId?: ID;
  clientId?: ID;
  contactId?: ID;
}

export function roadmapHandoffReadiness(
  relationship: Relationship | null | undefined,
): RoadmapHandoffReadiness {
  if (!relationship) {
    return { ready: false, because: "Choose a relationship first.", carries: [] };
  }

  const subject = relationship.companyName || relationship.fullName;
  if (!subject.trim()) {
    return {
      ready: false,
      because: "This relationship has no company or person named yet.",
      carries: [],
    };
  }

  if (CLOSED_STAGES.includes(relationship.stage)) {
    return {
      ready: false,
      because: "This relationship is archived. Reopen it in Comms before sequencing a path.",
      carries: [],
    };
  }

  const engaged = ENGAGED_STAGES.includes(relationship.stage);
  const decided = relationship.decided.length > 0;
  const touched = Boolean(relationship.lastTouchAt);

  if (PREMATURE_STAGES.includes(relationship.stage) && !decided) {
    return {
      ready: false,
      because:
        "Nothing has been agreed with them yet. Have the conversation in Comms, or record what was decided, before sequencing a path.",
      carries: [],
    };
  }

  if (!engaged && !decided && !touched) {
    return {
      ready: false,
      because:
        "There is no two-way evidence on this relationship yet, no touch and nothing decided.",
      carries: [],
    };
  }

  const carries = [
    `${subject} as the roadmap subject, by reference`,
    `Comms stage: ${relationship.stage.replace(/_/g, " ")}`,
    ...(relationship.observed.length > 0
      ? [`${relationship.observed.length} observed note${relationship.observed.length === 1 ? "" : "s"}`]
      : []),
    ...(decided
      ? [`${relationship.decided.length} decision${relationship.decided.length === 1 ? "" : "s"} a person made`]
      : []),
    ...(relationship.prospectId ? ["The Scout prospect it came from"] : []),
  ];

  return {
    ready: true,
    because: engaged
      ? "They are engaged and the context is on record."
      : "There is enough on record to sequence a path honestly.",
    carries,
  };
}

/** The reference handed across the boundary. Ids only, never copied records. */
export function roadmapHandoffRef(relationship: Relationship): RoadmapHandoffRef {
  return {
    kind: "relationship",
    id: relationship.id,
    label: relationship.companyName || relationship.fullName,
    ...(relationship.prospectId ? { prospectId: relationship.prospectId } : {}),
    ...(relationship.clientId ? { clientId: relationship.clientId } : {}),
    ...(relationship.contactId ? { contactId: relationship.contactId } : {}),
  };
}
