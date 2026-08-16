/**
 * Question → Roadmap cycle (Conductor V3.2).
 *
 * Roadmap is not a task list. It is a leadership-facing sequence from Point A
 * — where the business actually stands, with proof — to a stronger Point B,
 * carried by meaningful milestones and blocked, when it is blocked, by a
 * decision only a person may make.
 *
 * This module lets a *question* reach that sequence without ever inventing it:
 *
 *   1. Identity is resolved from canonical shared entities and existing
 *      Roadmap state. No id is ever constructed. Two plausible subjects means
 *      ambiguity, and ambiguity is reported, not resolved.
 *   2. An existing roadmap is always preferred to a new shell, and an existing
 *      unresolved decision is always surfaced instead of a new one.
 *   3. Conductor may surface or request a decision. It may never answer one,
 *      and it may never reorder approved sequencing.
 *   4. Every sentence keeps its truth class: observed, inferred, decided.
 *
 * The canon read below maps the client-facing Roadmap doctrine onto the state
 * the Roadmap app already owns. It creates no second model: anchor proof is an
 * observed Point A note carrying evidence, the governing business thought is
 * the roadmap objective, milestones are stages, and the execution boundary is
 * what the Roadmap adapters can credibly do.
 */

import type { EvidenceRef } from "@/domain/confidence";
import type { ActionProposal } from "@/domain/intelligence-engine";
import type {
  Roadmap,
  RoadmapDecision,
  RoadmapNote,
  RoadmapStage,
  RoadmapSubjectKind,
  Tier,
} from "@/domain/roadmap";
import { UNKNOWN_STATEMENT, isActiveRoadmap, orderStages } from "@/domain/roadmap";

import type { CanonMilestone, MilestoneAttention, RoadmapCanonRead } from "@/domain/conductor";

import type { SuiteSnapshot } from "../derive";
import type { InputResolution } from "./payload-fill";

export type { CanonMilestone, MilestoneAttention, RoadmapCanonRead };

export const ROADMAP_SHELL_OPERATION = "roadmap.create_shell";
export const ROADMAP_DECISION_OPERATION = "roadmap.request_decision";

/* ------------------------------------------------------------- canon read */

const EXECUTION_BOUNDARY =
  "Conductor can open a draft roadmap or hold an open question. Sequencing and every decision stay with a person, in Roadmap.";

/** The strongest observed Point A note: observed tier, with real evidence. */
function anchorProofOf(notes: RoadmapNote[]): RoadmapNote | null {
  const proven = notes.filter(
    (note) =>
      note.tier === "observed" &&
      note.value.trim().length > 0 &&
      note.value.trim() !== UNKNOWN_STATEMENT &&
      note.evidence.some((ref) => ref.kind !== "computed"),
  );
  if (proven.length === 0) return null;
  return [...proven].sort((a, b) => b.evidence.length - a.evidence.length)[0]!;
}

/**
 * Which milestone deserves attention next.
 *
 * Decided by rule, before any wording, and only from what Roadmap records:
 *
 *   1. A milestone carrying an unresolved human decision.
 *   2. When Point B is not yet decided, the milestone that agrees the
 *      destination — because everything sequenced after it assumes that
 *      answer. This is sequence logic, not a recorded dependency.
 *   3. Otherwise the earliest unfinished milestone by sequence position,
 *      then by stage state, then by truth tier, then by having a named owner.
 *
 * No dependency is ever invented.
 */
const STATE_RANK: Record<string, number> = { blocked: 0, in_build: 1, mapped: 2, live: 3 };
const TIER_RANK: Record<Tier, number> = { decided: 0, observed: 1, inferred: 2 };

const DESTINATION_PATTERNS: RegExp[] = [
  /\bdestination\b/i,
  /\bpoint b\b/i,
  /\bagree(ment|d)?\b/i,
  /\bobjective\b/i,
];

function looksLikeDestinationWork(milestone: CanonMilestone): boolean {
  const text = `${milestone.title} ${milestone.intent ?? ""}`;
  return DESTINATION_PATTERNS.some((pattern) => pattern.test(text));
}

function unfinished(milestone: CanonMilestone): boolean {
  return milestone.state !== "live";
}

function bySequence(a: CanonMilestone, b: CanonMilestone): number {
  return (
    a.position - b.position ||
    (STATE_RANK[a.state] ?? 9) - (STATE_RANK[b.state] ?? 9) ||
    TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
    Number(Boolean(b.ownerLabel ?? b.ownerUserId)) - Number(Boolean(a.ownerLabel ?? a.ownerUserId)) ||
    a.id.localeCompare(b.id)
  );
}

export function milestoneAttentionOf(input: {
  milestones: CanonMilestone[];
  openDecisions: RoadmapDecision[];
  pointB: { tier: "inferred" | "decided" } | null;
}): MilestoneAttention | null {
  const open = [...input.milestones].filter(unfinished).sort(bySequence);
  if (open.length === 0) return null;

  /* 1. An unresolved human decision sitting on a milestone outranks sequence. */
  for (const milestone of open) {
    const decision = input.openDecisions.find((row) => row.stageId === milestone.id);
    if (decision) {
      return {
        milestone,
        rule: "open_decision",
        because: `An unresolved decision sits on this milestone: "${decision.question}". Only you can answer it.`,
        decisionId: decision.id,
      };
    }
  }

  /* 2. An undecided destination comes before anything sequenced after it. */
  if (input.pointB?.tier !== "decided" && input.openDecisions.length > 0) {
    const destination = open.find(looksLikeDestinationWork);
    if (destination) {
      return {
        milestone: destination,
        rule: "destination_first",
        because:
          "Point B is not decided yet, and the milestones after this one assume the answer. That is sequence logic, not a recorded dependency.",
        ...(input.openDecisions[0] ? { decisionId: input.openDecisions[0].id } : {}),
      };
    }
}

/* --------------------------------------------------------- progression */

/**
 * What changed once a person answered a decision (V3.4).
 *
 * Read from Roadmap truth only, and computed the same deterministic way twice:
 * attention as it stood while the most recently resolved decision was still
 * open, and attention as it stands now. If those differ, that difference is
 * the progression — nothing is moved, resolved, reordered or completed here.
 */
export function milestoneProgressionOf(input: {
  milestones: CanonMilestone[];
  /** Every decision on this roadmap, open and resolved. */
  decisions: RoadmapDecision[];
  pointB: { tier: "inferred" | "decided" } | null;
}): MilestoneProgression | null {
  const open = input.decisions.filter((row) => row.status === "open");
  const resolved = input.decisions
    .filter((row) => row.status !== "open")
    .sort((a, b) =>
      (b.resolvedAt ?? b.updatedAt).localeCompare(a.resolvedAt ?? a.updatedAt),
    );
  const latest = resolved[0];
  if (!latest) return null;

  const before = milestoneAttentionOf({
    milestones: input.milestones,
    openDecisions: [...open, latest],
    pointB: input.pointB,
  });
  if (!before) return null;

  const after = milestoneAttentionOf({
    milestones: input.milestones,
    openDecisions: open,
    pointB: input.pointB,
  });

  const decisionDriven =
    (before.rule === "open_decision" || before.rule === "destination_first") &&
    before.decisionId === latest.id;
  const moved = after?.milestone.id !== before.milestone.id;
  if (!moved && !decisionDriven) return null;

  const statement = after
    ? moved
      ? `“${latest.question}” is now resolved (${latest.status}), so attention moves from “${before.milestone.title}” to “${after.milestone.title}” (${after.milestone.state.replace(/_/g, " ")}, ${after.milestone.tier}). ${after.because}`
      : `“${latest.question}” is now resolved (${latest.status}), so that reason no longer holds attention on “${before.milestone.title}”. It still deserves attention, now for a different reason. ${before.because}`
    : `“${latest.question}” is now resolved (${latest.status}), and every milestone on this roadmap is already live, so no milestone is waiting on you here.`;

  return {
    decisionId: latest.id,
    question: latest.question,
    resolution: latest.status as "approved" | "declined" | "deferred",
    ...(latest.resolvedAt ? { resolvedAt: latest.resolvedAt } : {}),
    from: before.milestone,
    to: after?.milestone ?? null,
    clearedDecisionReason: decisionDriven,
    statement,
  };
}


  /* 3. Earliest unfinished milestone in the recorded sequence. */
  const first = open[0]!;
  return {
    milestone: first,
    rule: "sequence_position",
    because: `Earliest unfinished milestone in the recorded sequence (position ${first.position}, ${first.state.replace(/_/g, " ")}, ${first.tier}). No dependency is recorded against it.`,
  };
}

/** Map Roadmap state onto the canonical concepts. Read-only and pure. */
export function readRoadmapCanon(input: {
  roadmap: Roadmap;
  decisions: RoadmapDecision[];
  /**
   * Stages as Roadmap holds them. An empty array is a real, read, empty
   * sequence. `undefined` means stages could not be read at all.
   */
  stages?: RoadmapStage[] | undefined;
}): RoadmapCanonRead {
  const { roadmap } = input;
  const open = input.decisions.filter(
    (decision) => decision.roadmapId === roadmap.id && decision.status === "open",
  );
  const stages = input.stages ? orderStages(input.stages) : undefined;
  const milestones: CanonMilestone[] = (stages ?? []).map((stage) => ({
    id: stage.id,
    roadmapId: stage.roadmapId,
    position: stage.position,
    title: stage.title,
    ...(stage.intent ? { intent: stage.intent } : {}),
    state: stage.state,
    tier: stage.tier,
    ...(stage.ownerLabel ? { ownerLabel: stage.ownerLabel } : {}),
    ...(stage.ownerUserId ? { ownerUserId: stage.ownerUserId } : {}),
    evidence: stage.evidence,
  }));
  const pointB = roadmap.pointB
    ? {
        statement: roadmap.pointB.statement,
        tier: roadmap.pointB.tier,
        because: roadmap.pointB.because,
      }
    : null;

  return {
    roadmapId: roadmap.id,
    subjectLabel: roadmap.subjectLabel,
    status: roadmap.status,
    governingThought: roadmap.objective.trim() || UNKNOWN_STATEMENT,
    pointA: roadmap.pointA.filter((note) => note.tier === "observed"),
    anchorProof: anchorProofOf(roadmap.pointA),
    pointB,
    milestones,
    milestonesKnown: Boolean(stages),
    milestoneAttention: stages
      ? milestoneAttentionOf({ milestones, openDecisions: open, pointB })
      : null,
    openDecisions: open,

    nextMove: roadmap.nextMove
      ? {
          action: roadmap.nextMove.action,
          because: roadmap.nextMove.because,
          tier: roadmap.nextMove.tier,
        }
      : null,
    executionBoundary: EXECUTION_BOUNDARY,
    evidence: [
      { label: `Roadmap "${roadmap.title}" as recorded in Roadmap`, kind: "computed" },
      ...(stages
        ? ([
            {
              label: `${stages.length} milestone${stages.length === 1 ? "" : "s"} read from Roadmap's own sequence`,
              kind: "computed",
            },
          ] as EvidenceRef[])
        : ([
            { label: "Milestones could not be read, so none are claimed", kind: "computed" },
          ] as EvidenceRef[])),
    ],
  };
}

/** Roadmap language, not task language. Every clause keeps its truth class. */
export function describeRoadmapCanon(canon: RoadmapCanonRead): string {
  const parts: string[] = [];

  parts.push(
    canon.pointA.length > 0
      ? `Point A for ${canon.subjectLabel}: ${canon.pointA[0]!.value} (observed).`
      : `Point A for ${canon.subjectLabel} is not established — no observed position is on record.`,
  );

  if (canon.anchorProof) {
    parts.push(`The proof that matters: ${canon.anchorProof.value}.`);
  } else {
    parts.push("No single piece of proof yet anchors this position.");
  }

  parts.push(
    canon.pointB
      ? canon.pointB.tier === "decided"
        ? `Point B is decided: ${canon.pointB.statement}.`
        : `Point B is still inferred, not decided: ${canon.pointB.statement}.`
      : "Point B has not been stated, so nothing below it can be sequenced honestly.",
  );

  if (canon.milestonesKnown) {
    parts.push(
      canon.milestones.length > 0
        ? `${canon.milestones.length} milestone${canon.milestones.length === 1 ? " is" : "s are"} sequenced; the first is "${canon.milestones[0]!.title}".`
        : "No milestones are sequenced yet.",
    );
    if (canon.milestoneAttention) {
      const { milestone, because } = canon.milestoneAttention;
      parts.push(
        `The milestone that deserves attention next is "${milestone.title}" (${milestone.state.replace(/_/g, " ")}, ${milestone.tier}). ${because}`,
      );
    }
  } else {
    parts.push("Milestones could not be read, so I am not claiming what is sequenced.");
  }

  parts.push(
    canon.openDecisions.length > 0
      ? `${canon.openDecisions.length} decision${canon.openDecisions.length === 1 ? "" : "s"} on this roadmap ${canon.openDecisions.length === 1 ? "is" : "are"} waiting on you: "${canon.openDecisions[0]!.question}"`
      : "No decision on this roadmap is waiting on you.",
  );

  return parts.join(" ");
}

/* ------------------------------------------------------ question language */

const ROADMAP_PATTERNS: RegExp[] = [
  /\broadmaps?\b/i,
  /\bpoint (a|b)\b/i,
  /\bmilestones?\b/i,
  /\bsequence\b/i,
  /\bdestination\b/i,
];

/** An explicit ask to map, sequence or build a path for a subject. */
const MAPPING_PATTERNS: RegExp[] = [
  /\b(map|sequence|build|draft|open|start|create) (out |up )?(a |the |our |their )?(roadmap|path|sequence|plan for)\b/i,
  /\b(map|sequence|draft|open|start|create)\b[^.?]{0,24}\broadmap for\b/i,
];

/**
 * A question that genuinely poses a choice. Narrow on purpose: a question
 * about a roadmap is not automatically a new decision for that roadmap.
 */
const DECISION_PATTERNS: RegExp[] = [
  /\bshould (we|i|they)\b[^.?]*\bor\b/i,
  /\bwhich\b[^.?]*\bshould (we|i)\b/i,
  /\b(do|should) we (go|move|commit|invest|prioritis|prioritiz)\w*\b[^.?]*\bor\b/i,
  /\bdecide between\b/i,
];

export function isRoadmapQuestion(question: string): boolean {
  return ROADMAP_PATTERNS.some((pattern) => pattern.test(question));
}

export function asksToMap(question: string): boolean {
  return MAPPING_PATTERNS.some((pattern) => pattern.test(question));
}

export function posesDecision(question: string): boolean {
  return DECISION_PATTERNS.some((pattern) => pattern.test(question));
}

/* ------------------------------------------------------------- duplication */

const STOP_WORDS = new Set([
  "the","a","an","is","are","was","were","be","to","of","for","and","or","we","i","our","us",
  "should","do","does","did","this","that","it","in","on","with","right","now","next","what",
  "which","how","can","could","would","will","shall","need","needs","really","still","one",
]);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word)),
  );
}

/**
 * Two questions are materially the same when their meaningful words largely
 * coincide. Deterministic, symmetric, and deliberately generous: a false
 * "same" surfaces the existing decision, which is the safe failure.
 */
export function isMateriallySameQuestion(a: string, b: string): boolean {
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 || right.size === 0) return false;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  const smaller = Math.min(left.size, right.size);
  const union = left.size + right.size - shared;
  return shared / smaller >= 0.7 || shared / union >= 0.5;
}

/** The open decision that already asks this, if one does. */
export function existingEquivalentDecision(
  question: string,
  decisions: RoadmapDecision[],
): RoadmapDecision | undefined {
  return decisions.find(
    (decision) => decision.status === "open" && isMateriallySameQuestion(decision.question, question),
  );
}

/* -------------------------------------------------------- subject identity */

export interface RoadmapSubjectCandidate {
  kind: RoadmapSubjectKind;
  id: string;
  label: string;
  /** An existing roadmap for this subject, when one exists. */
  roadmap?: Roadmap;
}

export type RoadmapSubjectResolution =
  | { status: "resolved"; subject: RoadmapSubjectCandidate; because: string }
  | { status: "ambiguous"; candidates: RoadmapSubjectCandidate[]; because: string }
  | { status: "none"; because: string };

function mentions(question: string, label: string): boolean {
  const name = label.trim().toLowerCase();
  if (name.length < 3) return false;
  return question.toLowerCase().includes(name);
}

/**
 * Resolve which client, prospect, relationship or roadmap a question is about,
 * from canonical entities only. Never constructs an id; never picks between
 * two plausible subjects.
 */
export function resolveRoadmapSubject(input: {
  snapshot: SuiteSnapshot;
  question: string;
}): RoadmapSubjectResolution {
  const { snapshot, question } = input;

  const fromRoadmaps: RoadmapSubjectCandidate[] = snapshot.roadmaps.map((roadmap) => ({
    kind: (roadmap.clientId ? "client" : roadmap.prospectId ? "prospect" : "relationship") as RoadmapSubjectKind,
    id: roadmap.clientId ?? roadmap.prospectId ?? roadmap.relationshipId ?? roadmap.id,
    label: roadmap.subjectLabel,
    roadmap,
  }));

  const fromProspects: RoadmapSubjectCandidate[] = snapshot.candidates.map((candidate) => ({
    kind: "prospect" as RoadmapSubjectKind,
    id: candidate.prospect.id,
    label: candidate.prospect.name,
  }));

  const fromRelationships: RoadmapSubjectCandidate[] = snapshot.relationships.map((row) => ({
    kind: "relationship" as RoadmapSubjectKind,
    id: row.id,
    label: row.companyName ?? row.fullName,
  }));

  const named = [...fromRoadmaps, ...fromProspects, ...fromRelationships].filter((candidate) =>
    mentions(question, candidate.label),
  );

  if (named.length === 1) {
    return {
      status: "resolved",
      subject: named[0]!,
      because: `The question names ${named[0]!.label}, which exists in this organisation.`,
    };
  }
  if (named.length > 1) {
    /* Two records for the same company is not ambiguity; prefer the roadmap. */
    const labels = new Set(named.map((row) => row.label.toLowerCase()));
    if (labels.size === 1) {
      const preferred = named.find((row) => row.roadmap) ?? named[0]!;
      return {
        status: "resolved",
        subject: preferred,
        because: `The question names ${preferred.label}, which exists in this organisation.`,
      };
    }
    return {
      status: "ambiguous",
      candidates: named,
      because: `The question could be about ${named
        .slice(0, 3)
        .map((row) => row.label)
        .join(", ")}. Name one and I will read its roadmap.`,
    };
  }

  /* Nothing named. One active roadmap is an unambiguous subject; more is not. */
  const active = fromRoadmaps.filter((row) => row.roadmap && isActiveRoadmap(row.roadmap));
  if (active.length === 1) {
    return {
      status: "resolved",
      subject: active[0]!,
      because: `Only one roadmap is active in this organisation: ${active[0]!.label}.`,
    };
  }
  if (active.length > 1) {
    return {
      status: "ambiguous",
      candidates: active,
      because: `${active.length} roadmaps are active. Name the one you mean.`,
    };
  }
  return {
    status: "none",
    because: "No roadmap and no named client, prospect or relationship matched this question.",
  };
}

/* ------------------------------------------------------------------ cycle */

export interface RoadmapCycleResult {
  answer: string;
  canon?: RoadmapCanonRead;
  nextMove?: { statement: string; appId: string; route: string; routeLabel: string } | undefined;
  proposals: ActionProposal[];
  resolutions: Record<string, InputResolution>;
  evidence: EvidenceRef[];
}

function shellProposal(input: {
  subject: RoadmapSubjectCandidate;
  objective: string;
  because: string;
}): ActionProposal {
  return {
    id: `act:roadmap:shell:${input.subject.kind}:${input.subject.id}`,
    recommendationId: "rec:roadmap:no_roadmap",
    appId: "roadmap",
    operation: ROADMAP_SHELL_OPERATION,
    title: `Open a draft roadmap for ${input.subject.label}`,
    summary: `Roadmap opens a draft from what this organisation already knows about ${input.subject.label}. Nothing is sequenced and nothing is decided.`,
    willDo: [
      `Open a draft roadmap for ${input.subject.label}`,
      "Carry across the observed facts already on record as Point A",
    ],
    willNotDo: ["Decide the destination", "Commit to any sequence, date or scope"],
    payload: {
      subjectKind: input.subject.kind,
      subjectId: input.subject.id,
      subjectLabel: input.subject.label,
      objective: input.objective,
      inputResolution: "resolved",
      inputProvenance: {
        kind: "canonical_entity",
        recordId: input.subject.id,
        entity: input.subject.kind,
        basis: "observed",
      },
    },
    reversible: true,
    route: "/modules/roadmap",
    routeLabel: "Open Roadmap",
    requiresApproval: true,
  };
}

function decisionProposal(input: {
  canon: RoadmapCanonRead;
  question: string;
  whyItMatters: string;
}): ActionProposal {
  return {
    id: `act:roadmap:decision:${input.canon.roadmapId}`,
    recommendationId: "rec:roadmap:open_decision",
    appId: "roadmap",
    operation: ROADMAP_DECISION_OPERATION,
    title: `Hold this as an open decision on ${input.canon.subjectLabel}'s roadmap`,
    summary:
      "Roadmap records the question as open, against the roadmap it belongs to, waiting for your answer. No answer is recorded and no sequencing changes.",
    willDo: ["Record the question as an open decision in Roadmap"],
    willNotDo: ["Answer the decision", "Change the sequence or the destination"],
    payload: {
      roadmapId: input.canon.roadmapId,
      question: input.question,
      whyItMatters: input.whyItMatters,
      subjectLabel: input.canon.subjectLabel,
      inputResolution: "resolved",
      inputProvenance: {
        kind: "roadmaps",
        recordId: input.canon.roadmapId,
        basis: "decided",
      },
    },
    reversible: true,
    route: `/modules/roadmap/${input.canon.roadmapId}`,
    routeLabel: "Open the roadmap",
    requiresApproval: true,
  };
}

/**
 * Answer a Roadmap question from real Roadmap state, and offer a governed
 * Roadmap action only when the state genuinely warrants one.
 */
export function planRoadmapCycle(input: {
  snapshot: SuiteSnapshot;
  question: string;
  /** Stages, when a caller already read them. Absent means milestones unknown. */
  stagesByRoadmap?: Record<string, RoadmapStage[]>;
}): RoadmapCycleResult {
  const { snapshot, question } = input;
  const resolution = resolveRoadmapSubject({ snapshot, question });
  const resolutions: Record<string, InputResolution> = {};

  if (resolution.status === "ambiguous") {
    return {
      answer: `I will not guess which roadmap you mean. ${resolution.because}`,
      proposals: [],
      resolutions: {},
      evidence: [{ label: "More than one subject matched this question", kind: "computed" }],
    };
  }

  if (resolution.status === "none") {
    return {
      answer:
        "No roadmap exists for anything this question names, and no client, prospect or relationship on record matches it. Name the company and I will read or open its roadmap.",
      proposals: [],
      resolutions: {},
      evidence: [{ label: "No canonical subject matched this question", kind: "computed" }],
    };
  }

  const subject = resolution.subject;

  /* ------------------------------------------------- an existing roadmap */
  if (subject.roadmap) {
    const canon = readRoadmapCanon({
      roadmap: subject.roadmap,
      decisions: snapshot.openDecisions,
      /*
       * Stages come from the caller when it already read them, otherwise from
       * the snapshot. A snapshot that read stages successfully but holds none
       * for this roadmap is an empty sequence, not an unknown one.
       */
      ...(input.stagesByRoadmap?.[subject.roadmap.id]
        ? { stages: input.stagesByRoadmap[subject.roadmap.id]! }
        : snapshot.roadmapStages
          ? { stages: snapshot.roadmapStages[subject.roadmap.id] ?? [] }
          : {}),
    });

    const existingDecision = canon.openDecisions[0];
    const duplicate = posesDecision(question)
      ? existingEquivalentDecision(question, canon.openDecisions)
      : undefined;

    /*
     * A decision already waiting is the next move. Conductor surfaces it; it
     * does not manufacture a second way to ask the same thing.
     */
    if (existingDecision && (duplicate || !posesDecision(question))) {
      return {
        answer: `${describeRoadmapCanon(canon)} It already exists in Roadmap as an open decision and needs your answer — I have not raised another.`,
        canon,
        nextMove: {
          statement: `Answer the open decision on ${canon.subjectLabel}'s roadmap: ${existingDecision.question}`,
          appId: "roadmap",
          route: `/modules/roadmap/${canon.roadmapId}`,
          routeLabel: "Open the roadmap",
        },
        proposals: [],
        resolutions: {},
        evidence: [
          { label: `Open decision recorded on ${canon.subjectLabel}'s roadmap`, kind: "human" },
        ],
      };
    }

    /* A question that genuinely poses an unasked choice may become one. */
    if (posesDecision(question) && !duplicate) {
      const proposal = decisionProposal({
        canon,
        question: question.trim(),
        whyItMatters: canon.pointB
          ? `Point B for ${canon.subjectLabel} is ${canon.pointB.tier}: ${canon.pointB.statement}. This choice changes what the sequence to it must contain.`
          : `${canon.subjectLabel}'s destination is not yet stated, and this choice bears on it.`,
      });
      resolutions[proposal.id] = {
        operation: ROADMAP_DECISION_OPERATION,
        status: "resolved",
        because: `Attached to ${canon.subjectLabel}'s existing roadmap. Roadmap will hold it open; only you answer it.`,
        missing: [],
        source: {
          kind: "roadmaps",
          recordId: canon.roadmapId,
          fields: ["roadmapId", "question", "whyItMatters"],
        },
      };
      return {
        answer: `${describeRoadmapCanon(canon)} That choice is not on the roadmap yet, so I can hold it there as an open decision for you to answer.`,
        canon,
        nextMove: {
          statement: `Decide this on ${canon.subjectLabel}'s roadmap.`,
          appId: "roadmap",
          route: `/modules/roadmap/${canon.roadmapId}`,
          routeLabel: "Open the roadmap",
        },
        proposals: [proposal],
        resolutions,
        evidence: [
          { label: `Read of ${canon.subjectLabel}'s roadmap in Roadmap`, kind: "computed" },
        ],
      };
    }

    /* Nothing to ask and nothing waiting: a pure, honest read. */
    return {
      answer: `${describeRoadmapCanon(canon)} ${canon.executionBoundary}`,
      canon,
      nextMove: canon.nextMove
        ? {
            statement: canon.nextMove.action,
            appId: "roadmap",
            route: `/modules/roadmap/${canon.roadmapId}`,
            routeLabel: "Open the roadmap",
          }
        : undefined,
      proposals: [],
      resolutions: {},
      evidence: [{ label: `Read of ${canon.subjectLabel}'s roadmap in Roadmap`, kind: "computed" }],
    };
  }

  /* -------------------------------------------------- no roadmap exists */
  if (!asksToMap(question)) {
    return {
      answer: `${subject.label} has no roadmap on record. I will not open one from a question about it — ask me to map ${subject.label} if that is what you want.`,
      proposals: [],
      resolutions: {},
      evidence: [{ label: `No roadmap exists for ${subject.label}`, kind: "computed" }],
    };
  }

  const objective = question.trim();
  if (objective.length < 12) {
    return {
      answer: `${subject.label} has no roadmap, and this question does not state what the roadmap is for. Say what ${subject.label} should be able to do that it cannot do today, and I will open a draft.`,
      proposals: [],
      resolutions: {},
      evidence: [{ label: "No governing objective stated", kind: "computed" }],
    };
  }

  const proposal = shellProposal({
    subject,
    objective,
    because: resolution.because,
  });
  resolutions[proposal.id] = {
    operation: ROADMAP_SHELL_OPERATION,
    status: "resolved",
    because: `Subject resolved to an existing ${subject.kind} record. ${resolution.because}`,
    missing: [],
    source: {
      kind: `${subject.kind}s`,
      recordId: subject.id,
      fields: ["subjectKind", "subjectId", "objective"],
    },
  };

  return {
    answer: `${subject.label} has no roadmap yet, so there is no Point A on record and no destination to sequence towards. I can open a draft from what this organisation already observes about ${subject.label}; the destination and the sequence remain yours to decide.`,
    nextMove: {
      statement: `Open a draft roadmap for ${subject.label}.`,
      appId: "roadmap",
      route: "/modules/roadmap",
      routeLabel: "Open Roadmap",
    },
    proposals: [proposal],
    resolutions,
    evidence: [
      { label: `${subject.label} exists as a ${subject.kind} in this organisation`, kind: "computed" },
    ],
  };
}
