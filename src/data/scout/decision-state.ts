/**
 * Scout, Tai Decision State, pure logic.
 *
 * Research produces evidence. This module turns that evidence into one calm
 * human decision. It suggests; it never decides, never sends anything, and
 * never creates a Roadmap or a Project.
 *
 * Everything here is deterministic over a candidate, its review, its coverage
 * and its recorded history. No model is called and no state is written.
 */

import type { ActivityEvent } from "@/domain/activity";
import type { ProspectCandidate } from "@/domain/scout";
import type { Contradiction, ScoutRead } from "./research-brief";
import type { ResearchPermission } from "./research-consent";
import type { EvidenceReview } from "./research-workspace";

/* ------------------------------------------------------------- the moves - */

export type DecisionMoveKey = "qualify" | "ask_question" | "hold" | "pass" | "explore_roadmap";

export interface DecisionMove {
  key: DecisionMoveKey;
  label: string;
  /** One line, shown before the move is committed. */
  consequence: string;
  available: boolean;
  /** Present only when the move is unavailable. */
  unavailableBecause?: string;
}

export const DECISION_MOVE_LABEL: Record<DecisionMoveKey, string> = {
  qualify: "Qualify",
  ask_question: "Ask one more question",
  hold: "Hold",
  pass: "Pass",
  explore_roadmap: "Explore Roadmap",
};

export const DECISION_MOVE_CONSEQUENCE: Record<DecisionMoveKey, string> = {
  qualify: "Marks this prospect as qualified in Scout. Nothing is sent automatically.",
  ask_question: "Saves a draft question for review. Nothing is sent from here.",
  hold: "Keeps the prospect in Scout without advancing it.",
  pass: "Marks this prospect as not moving forward. The history is preserved.",
  explore_roadmap:
    "Records that a Roadmap may be worth exploring. No Roadmap is created in this phase.",
};

/* --------------------------------------------------------- suggested move - */

export interface SuggestedDecision {
  key: DecisionMoveKey;
  label: string;
  /** Why this move, grounded in what is on the page. */
  because: string;
}

export interface DecisionStateView {
  /** True when this company came through the TrustTai.com intake. */
  inbound: boolean;
  /** Where the evidence stands right now, in plain words. */
  evidenceLine: string;
  /** What research permission allows, in the permission layer's words. */
  permissionLine: string;
  read: ScoutRead;
  suggested: SuggestedDecision;
  moves: DecisionMove[];
  /** A first draft of the question worth asking, when one is groundable. */
  draftQuestion: string | null;
  record: DecisionRecordEntry[];
}

export interface DecisionRecordEntry {
  at: string;
  label: string;
  actor: string;
  byPerson: boolean;
  move: DecisionMoveKey | null;
}

const RECORDED_NAMES = new Set([
  "prospect.decided",
  "prospect.qualified",
  "prospect.status_changed",
  "prospect.handed_over",
  "prospect.question_drafted",
  "prospect.roadmap_intent",
]);

function moveOf(event: ActivityEvent): DecisionMoveKey | null {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const raw = payload["scout_decision_move"];
  return typeof raw === "string" && raw in DECISION_MOVE_LABEL ? (raw as DecisionMoveKey) : null;
}

/** Everything a person or the system already settled here, newest first. */
export function decisionRecord(events: ActivityEvent[]): DecisionRecordEntry[] {
  return events
    .filter((event) => RECORDED_NAMES.has(event.name))
    .slice()
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
    .map((event) => ({
      at: event.occurredAt,
      label: event.summary || event.name.replace(/[._]/g, " "),
      actor:
        event.provenance.actor.label ??
        (event.provenance.actor.type === "user" ? "A person here" : "Trust Tai OS"),
      byPerson: event.provenance.actor.type === "user",
      move: moveOf(event),
    }));
}

const STRONG_SCORE = 68;
const WEAK_SCORE = 32;
const MIN_COVERAGE_AREAS = 3;

function suggestMove(input: {
  candidate: ProspectCandidate;
  review: EvidenceReview;
  permission: ResearchPermission;
  conflicts: Contradiction[];
  checkedCount: number;
  inbound: boolean;
}): SuggestedDecision {
  const { candidate, review, permission, conflicts, checkedCount, inbound } = input;
  const status = candidate.prospect.status;
  const score = candidate.evaluation.scoreable ? candidate.evaluation.score : null;

  if (status === "passed" || status === "archived") {
    return {
      key: "hold",
      label: "Keep watching",
      because: "Someone here already decided this one is not for now. The record stands.",
    };
  }
  if (status === "qualified" || status === "ready_for_comms") {
    return {
      key: "explore_roadmap",
      label: "Explore a Roadmap",
      because:
        "This company is already qualified, so the next honest question is what a first path would look like.",
    };
  }
  if (conflicts.length > 0) {
    return {
      key: "ask_question",
      label: "Learn one more thing",
      because: `What they said and what we read disagree on ${conflicts.length === 1 ? "one point" : `${conflicts.length} points`}. Only they can settle it.`,
    };
  }
  if (!permission.canResearch && review.observed.length === 0) {
    return {
      key: "ask_question",
      label: "Learn one more thing",
      because: inbound
        ? "Nothing public has been read, and permission to research is not settled. Their own answer is the only evidence available."
        : "Nothing has been read yet, so a direct question is the only way forward.",
    };
  }
  if (review.observed.length === 0) {
    return {
      key: "hold",
      label: "Keep watching",
      because: "Nothing has been read yet, so there is nothing to decide on.",
    };
  }
  if (checkedCount < MIN_COVERAGE_AREAS) {
    return {
      key: "hold",
      label: "Keep watching",
      because: `Only ${checkedCount} of the areas Scout checks have any evidence behind them. That is too thin to act on.`,
    };
  }
  if (score !== null && score >= STRONG_SCORE && review.observed.length >= 3) {
    return {
      key: "qualify",
      label: "Qualify",
      because: `Fit reads ${score} out of 100 and ${review.observed.length} observations stand behind it.`,
    };
  }
  if (score !== null && score <= WEAK_SCORE) {
    return {
      key: "pass",
      label: "Pass",
      because: `Fit reads ${score} out of 100 against the current targeting. Nothing observed argues otherwise.`,
    };
  }
  return {
    key: "hold",
    label: "Keep watching",
    because: review.totalClaims
      ? `${review.totalClaims - review.corroboratedClaims} of ${review.totalClaims} stated claims are still unchecked, so the read is not settled.`
      : "The evidence is real but does not yet point one way.",
  };
}

/** The single question worth asking, drawn from evidence where possible. */
export function draftQuestionFor(input: {
  candidate: ProspectCandidate;
  review: EvidenceReview;
  conflicts: Contradiction[];
}): string | null {
  const { candidate, review, conflicts } = input;
  const name = candidate.prospect.name;
  const conflict = conflicts[0];
  if (conflict) {
    return `Hi, one thing we want to get right before we go further. You told us: "${conflict.stated}" Reading your public pages, we saw: "${conflict.observed}" Which of those is closest to how it feels day to day for ${name} right now?`;
  }
  const unverified = review.claims.find((claim) => claim.standing === "unverified");
  if (unverified) {
    return `Hi, one question so we do not guess. You mentioned: "${unverified.statement}" What has already been tried on that, and what got in the way?`;
  }
  if (review.observed.length > 0) {
    const first = review.observed[0]!;
    return `Hi, one question before we go further. We read this about ${name}: "${first.statement}" Is that still current, and is it something you want to change this year?`;
  }
  return null;
}

export function buildDecisionState(input: {
  candidate: ProspectCandidate;
  review: EvidenceReview;
  read: ScoutRead;
  conflicts: Contradiction[];
  permission: ResearchPermission;
  coverage: { checkedCount: number; total: number };
  events: ActivityEvent[];
}): DecisionStateView {
  const { candidate, review, read, conflicts, permission, coverage, events } = input;
  const inbound = Boolean(candidate.stated);
  const status = candidate.prospect.status;

  const suggested = suggestMove({
    candidate,
    review,
    permission,
    conflicts,
    checkedCount: coverage.checkedCount,
    inbound,
  });

  const moves: DecisionMove[] = [
    {
      key: "qualify",
      label: DECISION_MOVE_LABEL.qualify,
      consequence: DECISION_MOVE_CONSEQUENCE.qualify,
      available: status !== "qualified" && status !== "ready_for_comms",
      ...(status === "qualified" || status === "ready_for_comms"
        ? { unavailableBecause: "This company is already qualified in Scout." }
        : {}),
    },
    {
      key: "ask_question",
      label: DECISION_MOVE_LABEL.ask_question,
      consequence: DECISION_MOVE_CONSEQUENCE.ask_question,
      available: true,
    },
    {
      key: "hold",
      label: DECISION_MOVE_LABEL.hold,
      consequence: DECISION_MOVE_CONSEQUENCE.hold,
      available: true,
    },
    {
      key: "pass",
      label: DECISION_MOVE_LABEL.pass,
      consequence: DECISION_MOVE_CONSEQUENCE.pass,
      available: status !== "passed",
      ...(status === "passed" ? { unavailableBecause: "This company was already passed." } : {}),
    },
    {
      key: "explore_roadmap",
      label: DECISION_MOVE_LABEL.explore_roadmap,
      consequence: DECISION_MOVE_CONSEQUENCE.explore_roadmap,
      available: review.observed.length > 0 || inbound,
      ...(review.observed.length > 0 || inbound
        ? {}
        : { unavailableBecause: "There is nothing on file yet to carry into a Roadmap." }),
    },
  ];

  const evidenceLine =
    review.observed.length === 0
      ? "Nothing public has been read yet."
      : `${review.observed.length} observation${review.observed.length === 1 ? "" : "s"} on file, covering ${coverage.checkedCount} of ${coverage.total} areas Scout checks.`;

  return {
    inbound,
    evidenceLine,
    permissionLine: permission.because,
    read,
    suggested,
    moves,
    draftQuestion: draftQuestionFor({ candidate, review, conflicts }),
    record: decisionRecord(events),
  };
}
