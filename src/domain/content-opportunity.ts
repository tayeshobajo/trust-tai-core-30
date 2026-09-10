/**
 * The Studio content opportunity, as a contract.
 *
 * Canon 28: Website observes demand, Studio turns demand into a story, humans
 * decide what is published. An opportunity is the object in between. It is
 * derived per request from observed truth; it is not a stored score and it is
 * never an instruction to write.
 *
 * Naming note: `ContentOpportunity` in `@/domain/website-analytics` is the
 * Website room's own deterministic coverage report and keeps that name. This
 * is the Studio-side object, so it is `StudioOpportunity` to keep both
 * importable in the same file without either shadowing the other.
 *
 * Truth semantics:
 *  - observed numbers are numbers or `null`; never a filled-in zero
 *  - intent, action and rationale are inference until a person decides
 *  - a human decision is explicit, attributed, timestamped, and outranks any
 *    later inference about the same subject
 *  - competing pages are carried as conflicts, never silently resolved
 */

import type { ID, ISODateTime } from "./entities";

/** What Studio would do about the demand. `no_action` is a real answer. */
export const OPPORTUNITY_ACTIONS = [
  "new_post",
  "update_existing",
  "internal_link",
  "landing_page",
  "faq",
  "no_action",
] as const;

export type OpportunityAction = (typeof OPPORTUNITY_ACTIONS)[number];

export const OPPORTUNITY_ACTION_LABEL: Record<OpportunityAction, string> = {
  new_post: "Write something new",
  update_existing: "Update the page that already ranks",
  internal_link: "Link an existing page to this one",
  landing_page: "Give this its own landing page",
  faq: "Answer it plainly on an FAQ",
  no_action: "Leave it alone",
};

/** What the opportunity is about. A phrase people typed, or a page we own. */
export interface OpportunitySubject {
  kind: "query_cluster" | "page";
  /** Stable key: the normalized query or the normalized path. */
  key: string;
  label: string;
}

/** Observed only. Null means not reported, which is not the same as zero. */
export interface OpportunityObservation {
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  averagePosition: number | null;
  change: number | null;
  window: { start: string | null; end: string | null; daysWithData: number; read: boolean };
  paths: { path: string; impressions: number }[];
}

export interface OpportunityConflict {
  kind: "competing_pages" | "already_ranks" | "brand_conflict";
  detail: string;
  paths: string[];
}

export interface OpportunityEvidence {
  ref: string;
  label: string;
  sourceLabel: string;
  url?: string;
  at?: ISODateTime;
}

/**
 * Words, not scores. `thin` is the honest answer when the window is short or
 * the phrase sits under the demand floor.
 */
export type OpportunityConfidence = "observed" | "supported" | "thin";

/** The human decision. Explicit, attributed, and stronger than inference. */
export type OpportunityDecisionState = "open" | "brief_built" | "dismissed" | "acted";

export interface OpportunityDecision {
  state: OpportunityDecisionState;
  decidedBy?: ID;
  decidedAt?: ISODateTime;
  note?: string;
}

export const OPEN_DECISION: OpportunityDecision = { state: "open" };

export interface StudioOpportunity {
  /** Deterministic from subject and window. Never random, never stored yet. */
  id: string;
  organizationId: ID;
  subject: OpportunitySubject;
  /** The phrasings people actually used, verbatim. Evidence, not a brief. */
  audienceLanguage: string[];
  observed: OpportunityObservation;
  /** Inferred unless a person said otherwise. */
  intent: string | null;
  action: OpportunityAction;
  /** Why now, in plain language. Inference. */
  rationale: string;
  /** Other readings that were considered and not chosen. */
  alternatives: { action: OpportunityAction; because: string }[];
  conflicts: OpportunityConflict[];
  confidence: OpportunityConfidence;
  /** Sentences explaining thin or unknown data, shown as written. */
  because: string[];
  evidence: OpportunityEvidence[];
  decision: OpportunityDecision;
}

/** A stable id, so the same demand in the same window is the same object. */
export function opportunityId(subject: OpportunitySubject, windowStart: string | null): string {
  const key = subject.key.trim().toLowerCase().replace(/\s+/g, "-");
  return `${subject.kind}:${key}:${windowStart ?? "unknown-window"}`;
}

/** A decided opportunity is never re-derived away by a later inference. */
export function isHumanDecided(decision: OpportunityDecision): boolean {
  return decision.state !== "open";
}

/**
 * Apply recorded human decisions over freshly derived opportunities. The
 * inference keeps its evidence, but the decision, and therefore what a surface
 * may do with it, belongs to the person.
 */
export function applyDecisions(
  derived: StudioOpportunity[],
  decisions: Record<string, OpportunityDecision>,
): StudioOpportunity[] {
  return derived.map((opportunity) => {
    const decided = decisions[opportunity.id];
    return decided && isHumanDecided(decided) ? { ...opportunity, decision: decided } : opportunity;
  });
}
