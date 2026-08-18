/**
 * Trust Tai OS, Comms interaction contracts.
 *
 * Relationships are kept warm by what actually happened, so every interaction
 * Tai records lands on the same timeline as the ones a connected mailbox
 * observed. The difference is provenance, never invention: a manual capture
 * says "Added by Tai" and an integration says where it came from.
 *
 * Nothing here needs a new table. Interactions are `comms_touches`,
 * commitments and relationship memory are structured `MemoryItem` rows inside
 * the relationship the memory belongs to, and relationship intent lives in the
 * relationship's own metadata.
 */

import type { ISODateTime } from "./entities";
import type { MemoryItem, Relationship, ThreadChannel } from "./comms";

/* ------------------------------------------------------- interaction kinds */

export type InteractionType =
  | "they_texted"
  | "i_texted"
  | "phone_call"
  | "meeting"
  | "linkedin"
  | "message"
  | "email_they"
  | "email_we"
  | "note"
  | "transcript";

export interface InteractionDefinition {
  type: InteractionType;
  label: string;
  channel: ThreadChannel;
  direction: "inbound" | "outbound";
  /** Free text capture that deserves a derived read before it is saved. */
  narrative: boolean;
  placeholder: string;
}

export const INTERACTION_TYPES: InteractionDefinition[] = [
  {
    type: "they_texted",
    label: "They texted me",
    channel: "text",
    direction: "inbound",
    narrative: false,
    placeholder: "What did they say?",
  },
  {
    type: "i_texted",
    label: "I texted them",
    channel: "text",
    direction: "outbound",
    narrative: false,
    placeholder: "What did you say?",
  },
  {
    type: "phone_call",
    label: "Phone call",
    channel: "call",
    direction: "outbound",
    narrative: true,
    placeholder: "Tell it the way you would tell a colleague. What was the call about?",
  },
  {
    type: "meeting",
    label: "Meeting",
    channel: "meeting",
    direction: "outbound",
    narrative: true,
    placeholder: "What happened in the meeting, and what came out of it?",
  },
  {
    type: "linkedin",
    label: "LinkedIn / social",
    channel: "linkedin",
    direction: "outbound",
    narrative: false,
    placeholder: "What was exchanged?",
  },
  {
    type: "message",
    label: "WhatsApp / other message",
    channel: "message",
    direction: "outbound",
    narrative: false,
    placeholder: "What was exchanged?",
  },
  {
    type: "email_they",
    label: "Email, they wrote",
    channel: "email",
    direction: "inbound",
    narrative: false,
    placeholder: "What did they write?",
  },
  {
    type: "email_we",
    label: "Email, we wrote",
    channel: "email",
    direction: "outbound",
    narrative: false,
    placeholder: "What did you write?",
  },
  {
    type: "note",
    label: "Add a note",
    channel: "note",
    direction: "outbound",
    narrative: false,
    placeholder: "Anything worth remembering about this relationship.",
  },
  {
    type: "transcript",
    label: "Upload conversation",
    channel: "meeting",
    direction: "outbound",
    narrative: true,
    placeholder: "Paste the conversation or transcript here.",
  },
];

export function interactionDefinition(type: InteractionType): InteractionDefinition {
  return INTERACTION_TYPES.find((entry) => entry.type === type) ?? INTERACTION_TYPES[0]!;
}

/** Manual captures always carry who put them on the record. */
export function manualProvenance(userLabel: string): { label: string; kind: "human" } {
  return { label: `Added by ${userLabel}`, kind: "human" };
}

/* ------------------------------------------------------------- commitments */

/** Memory rows in this category are promises, not general context. */
export const COMMITMENT_CATEGORY = "commitment";

export interface Commitment {
  id: string;
  text: string;
  owner: "us" | "them" | "unknown";
  due?: ISODateTime;
  status: "open" | "kept" | "released";
  at: ISODateTime;
  addedBy?: string;
}

function commitmentOwner(value?: string): Commitment["owner"] {
  if (value === "us" || value === "them") return value;
  return "unknown";
}

export function isCommitment(item: MemoryItem): boolean {
  return item.category === COMMITMENT_CATEGORY;
}

/** Every promise on record for this relationship, open ones first. */
export function commitmentsOf(relationship: Relationship): Commitment[] {
  const items = [...relationship.decided, ...relationship.observed].filter(isCommitment);
  return items
    .map((item, index) => ({
      id: `${item.at}:${index}`,
      text: item.value,
      owner: commitmentOwner(item.owner),
      ...(item.due ? { due: item.due } : {}),
      status: item.status ?? ("open" as const),
      at: item.at,
      ...(item.addedBy ? { addedBy: item.addedBy } : {}),
    }))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "open" ? -1 : 1;
      const dueA = a.due ? Date.parse(a.due) : Number.MAX_SAFE_INTEGER;
      const dueB = b.due ? Date.parse(b.due) : Number.MAX_SAFE_INTEGER;
      return dueA - dueB;
    });
}

export function openCommitments(relationship: Relationship): Commitment[] {
  return commitmentsOf(relationship).filter((entry) => entry.status === "open");
}

export const COMMITMENT_OWNER_LABEL: Record<Commitment["owner"], string> = {
  us: "We owe this",
  them: "They owe this",
  unknown: "Owner not set",
};

/* --------------------------------------------------------- memory keeping */

/** The kinds of relationship memory Comms deliberately accumulates. */
export const MEMORY_CATEGORIES = [
  "How we met",
  "What they care about",
  "Preferences",
  "Commitment",
  "Last meaningful interaction",
  "Important context",
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

/* -------------------------------------------------------- relationship intent */

/**
 * What kind of relationship this is. Different intents keep different healthy
 * rhythms, so a partner going quiet for a month is not the same event as a
 * live prospect going quiet for a month.
 */
export type RelationshipIntent =
  | "prospect"
  | "active_client"
  | "past_client"
  | "partner"
  | "referral"
  | "community"
  | "vendor"
  | "personal";

export const RELATIONSHIP_INTENTS: RelationshipIntent[] = [
  "prospect",
  "active_client",
  "past_client",
  "partner",
  "referral",
  "community",
  "vendor",
  "personal",
];

export const INTENT_LABEL: Record<RelationshipIntent, string> = {
  prospect: "Prospect",
  active_client: "Active client",
  past_client: "Past client",
  partner: "Partner",
  referral: "Referral relationship",
  community: "Community",
  vendor: "Vendor",
  personal: "Personal",
};

/** Days of quiet that are normal for this kind of relationship. */
export const INTENT_RHYTHM_DAYS: Record<RelationshipIntent, number> = {
  prospect: 14,
  active_client: 14,
  past_client: 120,
  partner: 45,
  referral: 60,
  community: 90,
  vendor: 90,
  personal: 60,
};

export const INTENT_RHYTHM_LABEL: Record<RelationshipIntent, string> = {
  prospect: "Every couple of weeks while the conversation is live",
  active_client: "Every couple of weeks through delivery",
  past_client: "A few times a year, when there is something real to say",
  partner: "Roughly monthly",
  referral: "Every couple of months",
  community: "Quarterly",
  vendor: "Quarterly, or when work requires it",
  personal: "Whenever it is genuine",
};

/** Intent is stored on the relationship's metadata, so no schema is added. */
export function intentOf(relationship: Relationship): RelationshipIntent | null {
  const raw = relationship.metadata["intent"];
  return RELATIONSHIP_INTENTS.includes(raw as RelationshipIntent)
    ? (raw as RelationshipIntent)
    : null;
}

/** Falls back to the closest reasonable reading of the lifecycle stage. */
export function effectiveIntent(relationship: Relationship): RelationshipIntent {
  const explicit = intentOf(relationship);
  if (explicit) return explicit;
  if (relationship.stage === "client") return "active_client";
  if (relationship.stage === "nurture" || relationship.stage === "dormant") return "community";
  return "prospect";
}

export function rhythmDaysFor(relationship: Relationship): number {
  return INTENT_RHYTHM_DAYS[effectiveIntent(relationship)];
}
