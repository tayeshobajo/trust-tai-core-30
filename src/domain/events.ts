/**
 * Trust Tai OS — shared suite event vocabulary.
 *
 * The nervous system of the suite is one stream, not a message bus and not a
 * second event store. Every event written here lands in the existing
 * `public.activities` table through the existing `ActivityStream` contract.
 *
 * This file exists so the apps agree on *which* events matter across rooms.
 * An app may still record its own local `entity.action` history; only the
 * events listed here are promised to other rooms and read by intelligence.
 */

import type { ActivityName, Provenance } from "./activity";
import type { EntityRef, ID, ISODateTime } from "./entities";

/**
 * Only business rooms emit cross-app suite events, because only they own the
 * state a suite event reports. Pulse (visibility) and Steward (interpretation)
 * read this vocabulary; they never author it. Steward's own interpretation and
 * memory history stays local to Steward's ledger.
 */
export type SuiteAppId = "scout" | "comms" | "roadmap" | "projects" | "studio" | "ops";

export interface SuiteEventDefinition {
  name: ActivityName;
  /** The room that is allowed to emit it. Others may only read it. */
  emittedBy: SuiteAppId;
  /** Plain-language meaning. Shown in docs and in the Pulse evidence trail. */
  meaning: string;
}

/**
 * The stable cross-app vocabulary. Adding an entry is a product decision;
 * renaming one is a breaking change for every reader.
 */
export const SUITE_EVENTS = {
  PROSPECT_DISCOVERED: {
    name: "prospect.discovered",
    emittedBy: "scout",
    meaning: "Scout sourced a company that had not been seen before.",
  },
  PROSPECT_QUALIFIED: {
    name: "prospect.qualified",
    emittedBy: "scout",
    meaning: "A person judged a company worth pursuing.",
  },
  PROSPECT_HANDED_OVER: {
    name: "prospect.handed_over",
    emittedBy: "scout",
    meaning: "A qualified company was routed to Comms with its context intact.",
  },
  CONTACT_DISCOVERED: {
    name: "contact.discovered",
    emittedBy: "scout",
    meaning: "A decision-maker was found for a company already on record.",
  },
  RELATIONSHIP_CREATED: {
    name: "relationship.created",
    emittedBy: "comms",
    meaning: "A person became a tracked relationship.",
  },
  RELATIONSHIP_MESSAGE_RECEIVED: {
    name: "relationship.message_received",
    emittedBy: "comms",
    meaning: "They wrote to us. The clock on a reply starts here.",
  },
  RELATIONSHIP_PROMISE_CREATED: {
    name: "relationship.promise_created",
    emittedBy: "comms",
    meaning: "We committed to do something by a date.",
  },
  RELATIONSHIP_STAGE_CHANGED: {
    name: "relationship.stage_changed",
    emittedBy: "comms",
    meaning: "The relationship moved forward or back a stage.",
  },
  ROADMAP_CREATED: {
    name: "roadmap.created",
    emittedBy: "roadmap",
    meaning: "A Point A to Point B roadmap was opened for a company or person.",
  },
  ROADMAP_MILESTONE_APPROVED: {
    name: "roadmap.milestone_approved",
    emittedBy: "roadmap",
    meaning: "A human approved a milestone, making it Decided truth.",
  },
  ROADMAP_DECISION_REQUESTED: {
    name: "roadmap.decision_requested",
    emittedBy: "roadmap",
    meaning: "Roadmap raised a question only a person can answer.",
  },
  ROADMAP_DECISION_RESOLVED: {
    name: "roadmap.decision_resolved",
    emittedBy: "roadmap",
    meaning: "A person answered an open roadmap decision.",
  },
  PROJECT_STARTED: {
    name: "project.started",
    emittedBy: "projects",
    meaning: "Approved work entered execution with an owner.",
  },
  PROJECT_BLOCKED: {
    name: "project.blocked",
    emittedBy: "projects",
    meaning: "Execution stopped and needs a decision or a dependency.",
  },
  PROJECT_COMPLETED: {
    name: "project.completed",
    emittedBy: "projects",
    meaning: "The committed outcome was delivered.",
  },
  CONTENT_PUBLISHED: {
    name: "content.published",
    emittedBy: "studio",
    meaning: "An asset went live for a client or for Trust Tai.",
  },
} as const satisfies Record<string, SuiteEventDefinition>;

export type SuiteEventKey = keyof typeof SUITE_EVENTS;
export type SuiteEventName = (typeof SUITE_EVENTS)[SuiteEventKey]["name"];

export const SUITE_EVENT_LIST: SuiteEventDefinition[] = Object.values(SUITE_EVENTS);

export function suiteEvent(name: string): SuiteEventDefinition | undefined {
  return SUITE_EVENT_LIST.find((definition) => definition.name === name);
}

export function isSuiteEvent(name: string): name is SuiteEventName {
  return SUITE_EVENT_LIST.some((definition) => definition.name === name);
}

/** The smallest useful envelope an emitting app has to fill in. */
export interface SuiteEventInput {
  key: SuiteEventKey;
  organizationId: ID;
  /** The person whose action caused it, or the system that observed it. */
  actor: Provenance["actor"];
  subject: EntityRef;
  summary: string;
  related?: EntityRef[];
  metadata?: Record<string, unknown>;
  /**
   * Stable key for "the same happening", so a retried write does not create a
   * second event. Required wherever a handoff can plausibly be retried.
   */
  sourceEventKey?: string;
  /** Model or rule output is `inferred`; anything read or done is `observed`. */
  confidence?: "observed" | "inferred";
  occurredAt?: ISODateTime;
}
