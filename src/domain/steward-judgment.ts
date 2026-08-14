/**
 * Trust Tai OS — Steward Judgment contracts.
 *
 * Judgment answers one human question: what deserves this person's attention
 * now? It is not a priority algorithm, not a task list and not a score. It
 * reads canonical truth that other rooms already own and produces an
 * explainable attention recommendation, or says plainly that nothing needs
 * anyone right now.
 *
 * Judgment writes nothing and owns nothing. Every item points back at the
 * canonical work it rests on.
 */

import type { EvidenceRef } from "./confidence";
import type { ID, ISODateTime } from "./entities";
import type { TruthTier } from "./signals";

/** The only five human states v1 will resolve into. */
export type JudgmentState =
  | "needs_you"
  | "waiting"
  | "newly_unblocked"
  | "promise_at_risk"
  | "nothing_needs_you";

export const JUDGMENT_STATE_LABEL: Record<JudgmentState, string> = {
  needs_you: "Needs you",
  waiting: "Waiting",
  newly_unblocked: "Newly unblocked",
  promise_at_risk: "Promise at risk",
  nothing_needs_you: "Nothing needs you",
};

/** States that can legitimately interrupt a person. */
export const ACTIONABLE_STATES: JudgmentState[] = [
  "needs_you",
  "newly_unblocked",
  "promise_at_risk",
];

/**
 * When two readings describe the same canonical work, the stronger state wins
 * and the weaker one's evidence is folded in. Higher is stronger.
 */
export const STATE_STRENGTH: Record<JudgmentState, number> = {
  newly_unblocked: 4,
  promise_at_risk: 3,
  needs_you: 2,
  waiting: 1,
  nothing_needs_you: 0,
};

/** Canonical work an attention item refers to. Never invented, never duplicated. */
export interface JudgmentRefs {
  commitmentId?: ID;
  conversationId?: ID;
  projectId?: ID;
  relationshipId?: ID;
  decisionId?: ID;
  activityId?: ID;
  /** Ops groups its events by chain, not by row. */
  opsChainKey?: string;
  /** The person the work concerns, when one is known. */
  personKey?: string;
}

/** Someone whose own move is held up by this work, when the record says so. */
export interface WaitingParty {
  name: string;
  personKey?: string;
}

/**
 * One thing Steward believes deserves a person's attention, with everything a
 * person needs to check that belief for themselves.
 */
export interface AttentionItem {
  /** Stable across reads of the same canonical work for the same person. */
  id: ID;
  /** Whose attention this is for. */
  forPersonKey: string;
  forName: string;
  state: JudgmentState;
  /** One line, in plain language. Never a score, never a scolding. */
  headline: string;
  /** Why this is here now rather than simply existing. */
  whyNow: string;
  refs: JudgmentRefs;
  evidence: EvidenceRef[];
  /** Rooms whose records this judgment rests on, e.g. ["steward", "ops"]. */
  sourceApps: string[];
  /** The move, if the record actually contains one. */
  nextMove?: string;
  /** Who is held up, when a person is named. */
  waitingOn?: WaitingParty;
  beneficiary?: string;
  /** The change that produced this judgment, when it is known. */
  changedAt?: ISODateTime;
  tier: TruthTier;
  destination: { appId: string; label: string; route: string };
  /**
   * Ordering only. Not shown, not a priority score, and never a judgement of a
   * person: it exists so two identical reads order identically.
   */
  order: number;
  /** Stable shape of this reading, so dismissals can be counted honestly. */
  patternKey: string;
}

/** What Steward is watching but did not think worth interrupting anyone for. */
export interface WatchNote {
  label: string;
  because: string;
}

/** One person's answer. Composed only of canonical reads. */
export interface JudgmentRead {
  forPersonKey: string;
  forName: string;
  /** "One thing needs you." / "Nothing needs you right now." */
  headline: string;
  /** The smallest set that earned an interruption. Capped. */
  items: AttentionItem[];
  /** Correctly waiting work, shown quietly and never as a chase. */
  waiting: AttentionItem[];
  /** Qualifying items beyond the cap, so the count stays honest. */
  deferred: number;
  watching: WatchNote[];
  generatedAt: ISODateTime;
}

/** At most this many items may interrupt a person at once. */
export const MAX_ATTENTION_ITEMS = 3;

/** At most this much waiting work is shown, quietly. */
export const MAX_WAITING_ITEMS = 3;

/** Days a promise may sit with no movement before a follow-up becomes meaningful. */
export const WAITING_FOLLOW_UP_DAYS = 7;

/** How near a stated due date counts as a meaningful timing boundary, in days. */
export const AT_RISK_WINDOW_DAYS = 1;

export function judgmentHeadline(count: number): string {
  if (count === 0) return "Nothing needs you right now.";
  if (count === 1) return "One thing needs you.";
  return `${count} things need you.`;
}
