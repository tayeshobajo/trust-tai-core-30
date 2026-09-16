/**
 * Where a client actually stands, in one place.
 *
 * Anyone picking this client up mid-stream needs six answers without reading
 * every tab: what stage they are at, what outcome was agreed, what the next
 * move is, who owns it, what is blocking it, and which version of the scope
 * those answers came from.
 *
 * This composes answers the owning rooms already recorded. It never invents
 * one. Each line is either a fact with the room behind it, or an honest
 * "not recorded" / "could not be read". An outcome nobody approved is shown as
 * inferred, never as agreed, and a room that failed to read is never rendered
 * as an absence of work.
 */

import type { ID } from "@/domain/entities";
import type { ExecutionProject } from "@/domain/projects";
import { isOpenProject, type RoadmapOutcome, type RoomRead } from "@/domain/client-shell";

export type ContinuityCertainty =
  /** A person decided or recorded this. */
  | "decided"
  /** Read from work in progress, not separately approved. */
  | "observed"
  /** Derived by the system and not confirmed by a person. */
  | "inferred"
  /** The room has nothing recorded. */
  | "not_recorded"
  /** The room could not be read at all. */
  | "unreadable";

export interface ContinuityLine {
  id:
    | "stage"
    | "outcome"
    | "next_action"
    | "owner"
    | "blocker"
    | "scope_version";
  label: string;
  value: string;
  certainty: ContinuityCertainty;
  /** Where the answer came from, so it can be checked. */
  evidenceHref?: string;
  evidenceLabel?: string;
}

export interface ClientContinuityInput {
  clientId: ID;
  roadmap: RoomRead<RoadmapOutcome | null> | null;
  projects: RoomRead<ExecutionProject[]> | null;
}

const NOT_RECORDED = "Not recorded";
const STILL_READING = "Still reading";

function roadmapLink(outcome: RoadmapOutcome): { evidenceHref: string; evidenceLabel: string } {
  return {
    evidenceHref: `/modules/roadmap/${outcome.roadmapId}`,
    evidenceLabel: outcome.title,
  };
}

/**
 * Read the roadmap once and answer each question from it, keeping the
 * difference between "no roadmap read yet", "read and empty" and "read and
 * failed" visible in every line rather than flattening them into one blank.
 */
function fromRoadmap(
  read: ClientContinuityInput["roadmap"],
  question: (outcome: RoadmapOutcome) => Omit<ContinuityLine, "id" | "label">,
): Omit<ContinuityLine, "id" | "label"> {
  if (read === null) return { value: STILL_READING, certainty: "not_recorded" };
  if (!read.available) return { value: read.because, certainty: "unreadable" };
  if (!read.value) return { value: NOT_RECORDED, certainty: "not_recorded" };
  return question(read.value);
}

/** The six continuity answers, always in the same order. */
export function clientContinuity(input: ClientContinuityInput): ContinuityLine[] {
  const stage = fromRoadmap(input.roadmap, (outcome) => ({
    value: outcome.milestone
      ? `${outcome.milestone}${outcome.milestoneStateLabel ? ` · ${outcome.milestoneStateLabel}` : ""}`
      : outcome.statusLabel,
    certainty: outcome.milestone ? "observed" : "inferred",
    ...roadmapLink(outcome),
  }));

  const outcome = fromRoadmap(input.roadmap, (read) => {
    if (!read.destination) return { value: NOT_RECORDED, certainty: "not_recorded" };
    return {
      value: read.destination,
      // Only a person approving Point B makes this an agreed outcome.
      certainty: read.destinationTier === "decided" ? "decided" : "inferred",
      ...roadmapLink(read),
    };
  });

  const nextAction = fromRoadmap(input.roadmap, (read) =>
    read.nextMove
      ? { value: read.nextMove, certainty: "decided", ...roadmapLink(read) }
      : { value: NOT_RECORDED, certainty: "not_recorded" },
  );

  const blocker = fromRoadmap(input.roadmap, (read) => {
    if (read.milestoneBlocked && read.milestone) {
      return {
        value: `${read.milestone} is blocked`,
        certainty: "observed",
        ...roadmapLink(read),
      };
    }
    if (read.openDecisions > 0) {
      return {
        value:
          read.openDecisions === 1
            ? "One decision is waiting on a person"
            : `${read.openDecisions} decisions are waiting on a person`,
        certainty: "observed",
        ...roadmapLink(read),
      };
    }
    return { value: "Nothing recorded as blocking", certainty: "observed" };
  });

  /**
   * Ownership comes from open delivery work, because that is where a named
   * lead is actually recorded. No open work means nobody is holding it, which
   * is worth saying out loud rather than leaving blank.
   */
  const owner = ((): Omit<ContinuityLine, "id" | "label"> => {
    const read = input.projects;
    if (read === null) return { value: STILL_READING, certainty: "not_recorded" };
    if (!read.available) return { value: read.because, certainty: "unreadable" };
    const open = read.value.filter(isOpenProject);
    const named = open.find((project) => (project.ownerLabel ?? "").trim());
    if (named) {
      return {
        value: named.ownerLabel as string,
        certainty: "decided",
        evidenceHref: `/modules/projects`,
        evidenceLabel: named.name,
      };
    }
    if (open.length > 0) {
      return { value: "Open work has no named owner", certainty: "not_recorded" };
    }
    return { value: "No open delivery work", certainty: "observed" };
  })();

  const scopeVersion = fromRoadmap(input.roadmap, (read) => ({
    // The roadmap a client is being run against is the version everything else
    // must be read against.
    value: `${read.title} · ${read.statusLabel}`,
    certainty: "decided",
    ...roadmapLink(read),
  }));

  return [
    { id: "stage", label: "Stage", ...stage },
    { id: "outcome", label: "Agreed outcome", ...outcome },
    { id: "next_action", label: "Next action", ...nextAction },
    { id: "owner", label: "Owner", ...owner },
    { id: "blocker", label: "Blocker", ...blocker },
    { id: "scope_version", label: "Scope version", ...scopeVersion },
  ];
}
