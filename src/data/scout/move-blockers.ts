/**
 * Scout, the guided blocker flow behind "Resolve N blockers".
 *
 * A blocked first message is never a dead end and never a hunt: each blocker
 * is shown with the exact plain-language action that clears it, and progress
 * is counted honestly as the underlying evidence changes. Every action reuses
 * an existing governed mechanism, confirming an address, refreshing the
 * company read, or the canonical People area, so this flow adds no parallel
 * verification or research path.
 *
 * Pure and deterministic; nothing here fetches, sends, or mutates.
 */

import {
  buildHandoffBlockers,
  type HandoffBlocker,
  type HandoffBlockerKind,
} from "@/data/comms-handoff";
import type { Person } from "@/domain/people";
import type { ResearchCoverage } from "@/domain/prospect-modules";
import type { ProspectCandidate } from "@/domain/scout";

import type { RecommendedMoveAction } from "./recommended-move";

export type MoveBlockerActionKind = "confirm_email" | "run_research" | "open_people";

export interface MoveBlocker {
  /** Stable identity for the row: the kind plus the person it concerns. */
  key: string;
  /** What stands in the way, in the draft's own words. */
  message: string;
  /** What resolving it actually means, in plain language. */
  detail: string;
  action: { kind: MoveBlockerActionKind; label: string };
  /** The person the action acts on, when the blocker is about a person. */
  person?: Person;
}

const BLOCKER_DETAIL: Record<HandoffBlockerKind, string> = {
  no_person:
    "Find or add the founder or decision maker, the People area holds the governed ingest and the manual add.",
  no_decision_maker:
    "Someone on record needs to be the person who decides. The People area holds the governed ingest and the manual add.",
  no_role: "Record the role so the brief knows who it is addressing.",
  no_email:
    "Add the address you already know, or ingest from an approved source, the People area holds both.",
  email_unverified:
    "A person confirms the address is real. That confirmation is what makes it safely reachable.",
  not_scored:
    "Scout reads the company's public pages against the ICP before any relationship move is honest.",
  thin_coverage:
    "Scout re-reads the public pages, so the brief rests on the full evidence and not a partial read.",
};

const BLOCKER_ACTION: Record<HandoffBlockerKind, { kind: MoveBlockerActionKind; label: string }> = {
  no_person: { kind: "open_people", label: "Open People" },
  no_decision_maker: { kind: "open_people", label: "Open People" },
  no_role: { kind: "open_people", label: "Open People" },
  no_email: { kind: "open_people", label: "Open People" },
  email_unverified: { kind: "confirm_email", label: "Confirm this address" },
  not_scored: { kind: "run_research", label: "Research this company" },
  thin_coverage: { kind: "run_research", label: "Refresh the company read" },
};

/**
 * The blockers between this company and a safe first message, each carrying
 * its own next action. Derived from the same structured blockers the handoff
 * draft lists, so the count and wording always match.
 */
export function buildMoveBlockers(input: {
  candidate: ProspectCandidate;
  people: Person[];
  coverage: ResearchCoverage;
}): MoveBlocker[] {
  return buildHandoffBlockers(input).map((blocker) => {
    const person = blocker.personId
      ? input.people.find((entry) => entry.id === blocker.personId)
: undefined;
    return {
      key: blocker.personId ? `${blocker.kind}:${blocker.personId}`: blocker.kind,
      message: blocker.message,
      detail: BLOCKER_DETAIL[blocker.kind],
      action: BLOCKER_ACTION[blocker.kind],
...(person ? { person }: {}),
    };
  });
}

/**
 * Honest progress through the flow. `total` is the number of blockers when
 * the flow was opened; `remaining` is the live count. Progress can only come
 * from the evidence actually changing, a refresh makes it visible.
 */
export function blockerProgress(
  total: number,
  remaining: number,
): { resolved: number; total: number; done: boolean } {
  const resolved = Math.min(Math.max(total - remaining, 0), total);
  return { resolved, total, done: total > 0 && remaining === 0 };
}

/**
 * The final blocker has cleared when the move now offers the first message
 * and the handoff behind it is ready. The recommendation advances on its
 * own, the person never has to rediscover what to do.
 */
export function advanceAfterBlockers(input: {
  flowOpen: boolean;
  firstMessageReady: boolean;
  primaryKind: RecommendedMoveAction;
}): boolean {
  return (
    input.flowOpen &&
    input.firstMessageReady &&
    input.primaryKind === "prepare_first_message"
  );
}
