/**
 * Trust Tai OS, the agency journey contract.
 *
 * One ordered journey from a sourced company to a cared-for client, plus the
 * lost, deferred and reopened paths that real work actually takes. This module
 * is pure and deterministic: it owns no state, writes nothing, and creates no
 * parallel CRM. Each stage names the room that already owns its state, and a
 * handoff carries canonical ids by reference, never a copy of a record.
 *
 * Three rules are enforced here rather than left to each room:
 *   1. Ids survive. A handoff must carry the same company/person ids and the
 *      original source reference it received.
 *   2. A handoff is complete only when the owning service confirms its write.
 *      A prepared handoff is reported as partial, never as done.
 *   3. A due date exists only because an authorised person decided it.
 *
 * See docs/agency-journey-contract.md.
 */

import type { ID, ISODateTime } from "./entities";

/* ------------------------------------------------------------------ stages */

export type JourneyStage =
  | "source"
  | "qualify"
  | "discovery"
  | "roadmap"
  | "proposal"
  | "agreement"
  | "delivery"
  | "care";

/** Where an item sits relative to the ordinary path. */
export type JourneyPath = "active" | "lost" | "deferred" | "reopened";

export interface StageContract {
  stage: JourneyStage;
  /** Plain-language name shown to a person. */
  label: string;
  /** Registry app id of the room that owns this stage's state. */
  owningApp: ID;
  /** What the stage needs before it can do useful work. */
  inputs: string[];
  /** The state this room owns and nobody else writes. */
  ownedState: string[];
  /** What the stage produces when it succeeds. */
  outcome: string;
  /** Who decides that the outcome happened. Always a person. */
  decisionOwner: string;
  /** The next stage on the ordinary path, absent for the last stage. */
  handsTo?: JourneyStage;
}

export const JOURNEY: StageContract[] = [
  {
    stage: "source",
    label: "Source",
    owningApp: "scout",
    inputs: ["ICP profile", "a company name or website"],
    ownedState: ["prospects", "fit evidence", "sourcing activity"],
    outcome: "A company on record with where it came from.",
    decisionOwner: "Whoever curates Scout",
    handsTo: "qualify",
  },
  {
    stage: "qualify",
    label: "Qualify",
    owningApp: "scout",
    inputs: ["prospect", "observed evidence"],
    ownedState: ["prospect status", "fit read", "route-to-comms record"],
    outcome: "A judged fit with the reason written down.",
    decisionOwner: "Whoever curates Scout",
    handsTo: "discovery",
  },
  {
    stage: "discovery",
    label: "Discovery",
    owningApp: "comms",
    inputs: ["qualified prospect", "a contactable person"],
    ownedState: ["relationships", "conversations", "promises", "meetings"],
    outcome: "A two-way conversation with what they actually need on record.",
    decisionOwner: "The relationship owner in Comms",
    handsTo: "roadmap",
  },
  {
    stage: "roadmap",
    label: "Roadmap",
    owningApp: "roadmap",
    inputs: ["relationship with recorded need", "Point A facts"],
    ownedState: ["roadmaps", "milestones", "sequencing", "approval state"],
    outcome: "A sequenced path from Point A to Point B a person approved.",
    decisionOwner: "The roadmap approver",
    handsTo: "proposal",
  },
  {
    stage: "proposal",
    label: "Proposal",
    owningApp: "comms",
    inputs: ["approved milestones", "commercial truth entered by a person"],
    ownedState: ["proposal drafts", "versions", "review findings"],
    outcome: "A proposal a person approved, ready to be sent by a person.",
    decisionOwner: "Tai, or a named approver",
    handsTo: "agreement",
  },
  {
    stage: "agreement",
    label: "Agreement and onboarding",
    owningApp: "clients",
    inputs: ["approved proposal", "signature or acceptance recorded by a person"],
    ownedState: ["client record", "tier", "commercial truth", "onboarding state"],
    outcome: "A client on the book with an owner and an agreed scope.",
    decisionOwner: "Tai",
    handsTo: "delivery",
  },
  {
    stage: "delivery",
    label: "Delivery",
    owningApp: "projects",
    inputs: ["client", "approved milestone"],
    ownedState: ["projects", "delivery state", "routed work", "acceptance"],
    outcome: "Work shipped and accepted by the person who asked for it.",
    decisionOwner: "The project owner",
    handsTo: "care",
  },
  {
    stage: "care",
    label: "Care and outcome review",
    owningApp: "clients",
    inputs: ["accepted delivery", "measured outcome"],
    ownedState: ["review cadence", "health", "renewal and growth notes"],
    outcome: "A reviewed outcome, and either growth or an honest close.",
    decisionOwner: "The client owner",
  },
];

export function stageContract(stage: JourneyStage): StageContract {
  const found = JOURNEY.find((entry) => entry.stage === stage);
  if (!found) throw new Error(`Unknown journey stage: ${stage}`);
  return found;
}

/**
 * Allowed moves. Forward one step on the ordinary path, plus the honest
 * detours: anything active may be lost or deferred, and anything lost or
 * deferred may be reopened at the stage it left.
 */
export function canAdvance(from: JourneyStage, to: JourneyStage): boolean {
  return stageContract(from).handsTo === to;
}

export function nextStage(from: JourneyStage): JourneyStage | undefined {
  return stageContract(from).handsTo;
}

export function canChangePath(from: JourneyPath, to: JourneyPath): boolean {
  if (from === to) return false;
  if (to === "lost" || to === "deferred") return from === "active" || from === "reopened";
  if (to === "reopened") return from === "lost" || from === "deferred";
  return false;
}

/* ---------------------------------------------------------------- subjects */

/**
 * The canonical identity a journey item carries end to end. Ids only. If the
 * item was sourced, `sourceRef` is the original reference and it never changes
 * shape as the item moves.
 */
export interface JourneySubject {
  organizationId: ID;
  /** The company, whichever canonical form exists yet. At least one required. */
  prospectId?: ID;
  clientId?: ID;
  /** The person, when one is known. */
  contactId?: ID;
  relationshipId?: ID;
  /** Where this company originally came from, carried forward unchanged. */
  sourceRef?: string;
  /** Display label only. Never used as an identity. */
  label: string;
}

export function subjectIdentity(subject: JourneySubject): string {
  const company = subject.clientId
    ? `client:${subject.clientId}`
    : subject.prospectId
      ? `prospect:${subject.prospectId}`
      : "company:unknown";
  const person = subject.relationshipId
    ? `relationship:${subject.relationshipId}`
    : subject.contactId
      ? `contact:${subject.contactId}`
      : "person:none";
  return `${company}|${person}`;
}

/**
 * True when the receiving subject kept every id and the source reference the
 * sending subject carried. Gaining ids is normal, losing one is a break.
 */
export function idsSurvive(
  before: JourneySubject,
  after: JourneySubject,
): { ok: boolean; lost: string[] } {
  const lost: string[] = [];
  if (before.organizationId !== after.organizationId) lost.push("organization");
  for (const key of ["prospectId", "clientId", "contactId", "relationshipId"] as const) {
    const was = before[key];
    if (was && after[key] !== was) lost.push(key);
  }
  if (before.sourceRef && after.sourceRef !== before.sourceRef) lost.push("sourceRef");
  return { ok: lost.length === 0, lost };
}

/* ---------------------------------------------------------------- handoffs */

/** A handoff is only ever real once the receiving room has written its state. */
export type HandoffState = "prepared" | "written" | "confirmed" | "refused";

export interface HandoffEvidence {
  label: string;
  /** Read from a record, inferred by intelligence, or decided by a person. */
  tier: "fact" | "inference" | "decision";
  ref?: string;
}

export interface JourneyHandoff {
  from: JourneyStage;
  to: JourneyStage;
  subject: JourneySubject;
  /** Registry app id that will write the receiving state. */
  owningApp: ID;
  evidence: HandoffEvidence[];
  state: HandoffState;
  /** The receiving room's own record id. Required before `confirmed`. */
  receiptRef?: string;
  /** The person who authorised the move, when a decision was required. */
  decidedBy?: ID;
  decidedAt?: ISODateTime;
  /** Set only alongside an authorised decision. */
  dueAt?: ISODateTime;
  /** Why it did not happen, when refused. */
  because?: string;
}

/**
 * The idempotent key for a handoff. The same company, the same person and the
 * same step always produce the same key, so a repeated attempt updates one
 * record instead of creating a second one.
 */
export function handoffKey(handoff: {
  from: JourneyStage;
  to: JourneyStage;
  subject: JourneySubject;
}): string {
  return [
    handoff.subject.organizationId,
    `${handoff.from}->${handoff.to}`,
    subjectIdentity(handoff.subject),
    handoff.subject.sourceRef ?? "source:none",
  ].join("::");
}

export interface HandoffValidation {
  ok: boolean;
  /** Plain-language reason, always present. */
  because: string;
  /** What must be true before it can be handed over. */
  blocking: string[];
  key: string;
  /** What a reader should be told this handoff currently is. */
  progress: "not ready" | "prepared, not written" | "written, not confirmed" | "complete";
}

const STAGES_REQUIRING_DECISION: JourneyStage[] = ["agreement", "delivery"];

export function validateHandoff(handoff: JourneyHandoff): HandoffValidation {
  const key = handoffKey(handoff);
  const blocking: string[] = [];

  if (!canAdvance(handoff.from, handoff.to)) {
    blocking.push(`${handoff.from} does not hand over to ${handoff.to}.`);
  }
  if (!handoff.subject.organizationId) {
    blocking.push("The handoff carries no organization.");
  }
  if (!handoff.subject.prospectId && !handoff.subject.clientId) {
    blocking.push("The handoff carries no company id.");
  }
  if (handoff.owningApp !== stageContract(handoff.to).owningApp) {
    blocking.push(
      `Only ${stageContract(handoff.to).owningApp} may write ${handoff.to} state.`,
    );
  }
  if (handoff.evidence.length === 0) {
    blocking.push("Nothing on record supports this handoff yet.");
  }
  if (STAGES_REQUIRING_DECISION.includes(handoff.to) && !handoff.decidedBy) {
    blocking.push(`Moving to ${handoff.to} needs a person to decide it.`);
  }
  if (handoff.dueAt && !(handoff.decidedBy && handoff.decidedAt)) {
    blocking.push("A due date can only come from an authorised decision.");
  }
  if (handoff.state === "confirmed" && !handoff.receiptRef) {
    blocking.push("The receiving room has not returned a record for this handoff.");
  }

  const progress: HandoffValidation["progress"] =
    blocking.length > 0
      ? "not ready"
      : handoff.state === "confirmed" && handoff.receiptRef
        ? "complete"
        : handoff.state === "written"
          ? "written, not confirmed"
          : "prepared, not written";

  return {
    ok: blocking.length === 0,
    because:
      blocking.length > 0
        ? blocking[0]!
        : progress === "complete"
          ? `${stageContract(handoff.to).label} has this on record.`
          : "Ready to hand over.",
    blocking,
    key,
    progress,
  };
}

/** A handoff counts as done only when the owning service confirmed its write. */
export function isHandoffComplete(handoff: JourneyHandoff): boolean {
  return validateHandoff(handoff).progress === "complete";
}

/* ------------------------------------------------------------ active items */

/**
 * The shape every room must be able to answer for anything still open. An
 * unassigned item is allowed, an item that hides its lack of owner is not.
 */
export interface JourneyItem {
  key: string;
  stage: JourneyStage;
  path: JourneyPath;
  subject: JourneySubject;
  ownerUserId?: ID;
  ownerLabel?: string;
  nextAction?: string;
  evidence: HandoffEvidence[];
  blockedBecause?: string;
  dueAt?: ISODateTime;
  dueDecidedBy?: ID;
}

export interface ItemReadiness {
  ownerState: "assigned" | "unassigned";
  ownerLabel: string;
  nextAction: string;
  hasEvidence: boolean;
  blockedBecause?: string;
  /** Problems with the record itself, not with the work. */
  contractBreaks: string[];
}

export function itemReadiness(item: JourneyItem): ItemReadiness {
  const contractBreaks: string[] = [];
  if (item.dueAt && !item.dueDecidedBy) {
    contractBreaks.push("This due date was not set by an authorised decision.");
  }
  if (item.path === "active" && !item.nextAction && !item.blockedBecause) {
    contractBreaks.push("No next action and no blocking reason.");
  }
  if (item.evidence.length === 0) {
    contractBreaks.push("Nothing on record supports this item.");
  }

  return {
    ownerState: item.ownerUserId ? "assigned" : "unassigned",
    ownerLabel: item.ownerUserId ? (item.ownerLabel ?? "Assigned") : "Unassigned",
    nextAction:
      item.nextAction ??
      (item.blockedBecause ? "Blocked, see the reason" : "No next action recorded"),
    hasEvidence: item.evidence.length > 0,
    ...(item.blockedBecause ? { blockedBecause: item.blockedBecause } : {}),
    contractBreaks,
  };
}
