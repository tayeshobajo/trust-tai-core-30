/**
 * Roadmap draft composition.
 *
 * Deterministic and pure: shared evidence goes in, a structured draft comes
 * out. There is no model here, so there is nothing to hallucinate. Every
 * sentence is either copied from a stored fact, derived from the Trust Tai
 * method, or written as Unknown.
 *
 * Hard rules enforced here rather than left to judgement:
 *  - Point A contains observed facts only, each with its own evidence.
 *  - A proposed Point B is Inferred, never Decided.
 *  - No timeline, budget, commitment, requirement, or client preference is
 *    ever invented. If it is not in the source context, it is a decision to
 *    ask about, not a statement to make.
 */

import type { EvidenceRef } from "@/domain/confidence";
import type {
  Destination,
  NextMove,
  RoadmapNote,
  RoadmapSubjectKind,
  StageState,
  Tier,
  UNKNOWN_STATEMENT as UnknownType,
} from "@/domain/roadmap";
import { UNKNOWN_STATEMENT } from "@/domain/roadmap";

export interface OpenQuestion {
  question: string;
  whyItMatters: string;
  options?: string[];
  recommendation?: string;
  recommendationBecause?: string;
  evidence?: EvidenceRef[];
}

/** Everything the system already knows, gathered from shared entities. */
export interface RoadmapSourceContext {
  subject: { kind: RoadmapSubjectKind; id: string; label: string };
  /** What the person said they are trying to accomplish. */
  objective: string;
  /** Anything they added by hand. Treated as a human statement, not a fact. */
  extraContext?: string | undefined;
  observed: RoadmapNote[];
  inferred: RoadmapNote[];
  decided: RoadmapNote[];
  openQuestions: OpenQuestion[];
  /** Display name of the person who will carry this, when known. */
  ownerLabel?: string | undefined;
  ownerUserId?: string | undefined;
  generatedAt: string;
}

export interface DraftStage {
  position: number;
  title: string;
  intent: string;
  state: StageState;
  tier: Tier;
  ownerLabel?: string;
  evidence: EvidenceRef[];
}

export interface RoadmapDraft {
  title: string;
  pointA: RoadmapNote[];
  pointB: Destination;
  stages: DraftStage[];
  decisions: OpenQuestion[];
  nextMove: NextMove;
  /** What the system could not establish. Shown, never smoothed over. */
  unknowns: string[];
}

const METHOD_EVIDENCE: EvidenceRef[] = [
  { label: "Trust Tai method: intake, diagnosis, roadmap, build, stewardship", kind: "computed" },
];

function human(label: string): EvidenceRef[] {
  return [{ label, kind: "human" }];
}

/**
 * The Walk. A fixed Trust Tai sequence, trimmed to what this situation needs.
 * The sequence is method, not a claim about the client, so it is Inferred and
 * carries computed evidence rather than pretending to be observed.
 */
function walk(context: RoadmapSourceContext, unknowns: string[]): DraftStage[] {
  const stages: DraftStage[] = [];
  const owner = context.ownerLabel;
  const push = (title: string, intent: string, state: StageState = "mapped") => {
    stages.push({
      position: stages.length,
      title,
      intent,
      state,
      tier: "inferred",
      ...(owner ? { ownerLabel: owner } : {}),
      evidence: METHOD_EVIDENCE,
    });
  };

  if (unknowns.length > 0) {
    push(
      "Confirm current truth",
      `Close ${unknowns.length} open ${unknowns.length === 1 ? "gap" : "gaps"} before anything is committed.`,
      "in_build",
    );
  }

  push("Agree the destination", "Get explicit agreement on what Point B actually is.");
  push("Sequence the build order", "Decide what gets built first and what waits.");
  push("Build the first move", "Ship the smallest piece that proves the direction.");
  push("Hand over and steward", "Name who carries it once it is live.");

  return stages;
}

function destination(context: RoadmapSourceContext): Destination {
  const objective = context.objective.trim();
  const decidedDestination = context.decided.find((note) =>
    /destination|outcome|goal|objective/i.test(note.label),
  );

  if (decidedDestination) {
    return {
      statement: decidedDestination.value,
      tier: "decided",
      because: `${decidedDestination.label} was decided by a person.`,
      evidence: decidedDestination.evidence,
    };
  }

  return {
    statement: objective || UNKNOWN_STATEMENT,
    tier: "inferred",
    because: objective
      ? "Taken from what was entered when this roadmap was created. It stays a proposal until you approve it."
      : "Nothing on record states where this should end up.",
    evidence: objective
      ? human("Entered by a person when the roadmap was created")
      : [],
  };
}

/** What we cannot establish from the evidence we hold. */
function findUnknowns(context: RoadmapSourceContext): string[] {
  const unknowns: string[] = [];
  if (context.observed.length === 0) {
    unknowns.push("No observed facts are on record for this subject yet.");
  }
  if (!context.ownerLabel) {
    unknowns.push("No one is named as carrying this yet.");
  }
  if (!context.objective.trim()) {
    unknowns.push("The destination has not been stated.");
  }
  return unknowns;
}

function decisions(
  context: RoadmapSourceContext,
  pointB: Destination,
  unknowns: string[],
): OpenQuestion[] {
  const list: OpenQuestion[] = [];

  if (pointB.tier === "inferred") {
    list.push({
      question: `Is "${pointB.statement}" the right destination?`,
      whyItMatters:
        "Everything sequenced below assumes this destination. Until it is approved it stays a proposal.",
      options: ["Approve as written", "Change the destination", "Not yet, needs more evidence"],
      ...(context.observed.length > 0
        ? {
            recommendation: "Approve as written",
            recommendationBecause: `There ${context.observed.length === 1 ? "is" : "are"} ${context.observed.length} observed ${context.observed.length === 1 ? "fact" : "facts"} on record supporting this direction.`,
          }
        : {}),
      evidence: pointB.evidence,
    });
  }

  if (unknowns.some((entry) => entry.startsWith("No one is named"))) {
    list.push({
      question: "Who carries this roadmap?",
      whyItMatters: "A roadmap with no owner does not move. Ownership is a person, not a team.",
      evidence: [{ label: "No owner recorded on this roadmap", kind: "computed" }],
    });
  }

  for (const question of context.openQuestions) list.push(question);

  return list;
}

function nextMove(
  context: RoadmapSourceContext,
  open: OpenQuestion[],
  stages: DraftStage[],
): NextMove {
  const first = open[0];
  if (first) {
    return {
      action: first.question,
      because: first.whyItMatters,
      tier: "inferred",
      ...(context.ownerLabel ? { ownerLabel: context.ownerLabel } : {}),
      ...(context.ownerUserId ? { ownerUserId: context.ownerUserId } : {}),
    };
  }

  const stage = stages[0];
  return {
    action: stage ? stage.title : "Add the first stage of the walk",
    because: stage ? stage.intent : "A roadmap needs at least one step to be useful.",
    tier: "inferred",
    ...(context.ownerLabel ? { ownerLabel: context.ownerLabel } : {}),
    ...(context.ownerUserId ? { ownerUserId: context.ownerUserId } : {}),
  };
}

/** Compose one roadmap draft. Pure: the same context always drafts the same. */
export function composeRoadmapDraft(context: RoadmapSourceContext): RoadmapDraft {
  // Point A is observed truth only. An inference is never promoted into it.
  const pointA: RoadmapNote[] = context.observed.filter(
    (note) => note.tier === "observed" && note.value.trim().length > 0,
  );

  if (pointA.length === 0) {
    pointA.push({
      label: "Current truth",
      value: UNKNOWN_STATEMENT,
      tier: "observed",
      evidence: [{ label: "Nothing observed is on record for this subject", kind: "computed" }],
      at: context.generatedAt,
    });
  }

  const unknowns = findUnknowns(context);
  const pointB = destination(context);
  const stages = walk(context, unknowns);
  const open = decisions(context, pointB, unknowns);

  return {
    title: `${context.subject.label} · ${context.objective.trim() || "Path to be agreed"}`,
    pointA,
    pointB,
    stages,
    decisions: open,
    nextMove: nextMove(context, open, stages),
    unknowns,
  };
}

export type { UnknownType };
