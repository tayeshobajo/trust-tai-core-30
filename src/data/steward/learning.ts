/**
 * Learning: what Steward takes from a person's correction, and from evidence
 * that keeps repeating.
 *
 * Two rules govern everything here.
 *
 * A correction is never an overwrite. When someone rewrites "Prepare the
 * meeting" into "Prepare Tai's Monday Bioptrics briefing", Steward keeps both,
 * records which fields moved, and remembers the delta as decided truth taught
 * by a named person at a known time.
 *
 * A pattern is never a single event. Repeated evidence can only become an
 * inferred belief after it has been seen in `RECURRING_PATTERN_THRESHOLD`
 * distinct canonical conversations, and only from readings a person could have
 * acted on — never from passages Steward itself withheld.
 *
 * Pure functions only. Nothing here touches the network.
 */

import type { EvidenceRef } from "@/domain/confidence";
import { personKeyOf } from "@/domain/steward";
import type { InterpretedSignal } from "@/domain/steward-semantic";
import {
  RECURRING_PATTERN_THRESHOLD,
  isPersonSafeStatement,
  patternKeyOf,
  type CorrectionDraft,
  type MemoryBelief,
  type MemoryDraft,
  type MemoryFacet,
  type MemoryObservation,
} from "@/domain/steward-memory";

import {
  commitmentSubject,
  handoffSubject,
  personSubject,
  projectSubject,
} from "./memory-encoding";

/* ------------------------------------------------------- correction deltas */

/** The fields of a reading a person can put right before confirming. */
export interface InterpretationEdit {
  normalizedMeaning?: string;
  ownerName?: string | null;
  beneficiary?: string | null;
  projectLabel?: string | null;
  dueText?: string | null;
}

function changed(before: string | null | undefined, after: string | null | undefined): boolean {
  const left = (before ?? "").trim();
  const right = (after ?? "").trim();
  if (right.length === 0) return false;
  return left.toLowerCase() !== right.toLowerCase();
}

const FACET_SENTENCE: Record<MemoryFacet, (original: string, corrected: string) => string> = {
  meaning: (original, corrected) =>
    `Stated as “${corrected}”, not “${original || "an unstated reading"}”.`,
  owner: (original, corrected) =>
    `${corrected} carries this, not ${original || "an unnamed person"}.`,
  beneficiary: (original, corrected) => `This is prepared for ${corrected}.`,
  project: (original, corrected) => `This belongs to ${corrected}.`,
  timing: (original, corrected) => `Timing was set as “${corrected}”.`,
  responsibility: (_original, corrected) => corrected,
  relationship: (_original, corrected) => corrected,
  cadence: (_original, corrected) => corrected,
  status: (original, corrected) => `Moved from ${original || "its earlier state"} to ${corrected}.`,
  other: (_original, corrected) => corrected,
};

/**
 * What a person taught Steward by editing a reading before confirming it.
 *
 * One draft per field that actually moved. An unchanged field teaches nothing,
 * and a cleared field is treated as "no correction" rather than as a deletion,
 * because absence of typing is not an instruction.
 */
export function correctionsFromEdit(input: {
  signal: Pick<
    InterpretedSignal,
    "id" | "normalizedMeaning" | "ownerName" | "beneficiary" | "projectLabel" | "dueText" | "evidence"
  >;
  edit: InterpretationEdit;
  conversationId?: string;
  commitmentId?: string;
}): CorrectionDraft[] {
  const { signal, edit } = input;
  const drafts: CorrectionDraft[] = [];

  const ownerName = (edit.ownerName ?? signal.ownerName ?? "").trim();
  const personKey = ownerName ? personKeyOf({ name: ownerName }) : "";
  const projectLabel = (edit.projectLabel ?? signal.projectLabel ?? "").trim();

  const add = (facet: MemoryFacet, original: string, corrected: string) => {
    const statement = FACET_SENTENCE[facet](original, corrected);
    if (!isPersonSafeStatement(statement)) return;
    drafts.push({
      facet,
      subjectKey: personKey ? personSubject(personKey) : commitmentSubject(signal.id),
      subjectLabel: ownerName || "This commitment",
      original,
      corrected,
      statement,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.commitmentId ? { commitmentId: input.commitmentId } : {}),
      candidateId: signal.id,
      ...(personKey ? { personKey, personName: ownerName } : {}),
      ...(projectLabel ? { projectLabel } : {}),
      evidence: signal.evidence,
    });
  };

  if (changed(signal.normalizedMeaning, edit.normalizedMeaning)) {
    add("meaning", signal.normalizedMeaning, (edit.normalizedMeaning ?? "").trim());
  }
  if (changed(signal.ownerName, edit.ownerName)) {
    add("owner", signal.ownerName ?? "", (edit.ownerName ?? "").trim());
  }
  if (changed(signal.beneficiary, edit.beneficiary)) {
    add("beneficiary", signal.beneficiary ?? "", (edit.beneficiary ?? "").trim());
  }
  if (changed(signal.projectLabel, edit.projectLabel)) {
    add("project", signal.projectLabel ?? "", (edit.projectLabel ?? "").trim());
  }
  if (changed(signal.dueText, edit.dueText)) {
    add("timing", signal.dueText ?? "", (edit.dueText ?? "").trim());
  }

  return drafts;
}

/** A correction, as it will be written to the append-only ledger. */
export function correctionToDraft(
  correction: CorrectionDraft,
  supersedesId?: string,
): MemoryDraft {
  return {
    subjectKey: correction.subjectKey,
    subjectLabel: correction.subjectLabel,
    statement: correction.statement,
    /* A person said it, so it is decided, and its authority is human. */
    tier: "decided",
    authority: "human",
    ...(supersedesId ? { supersedesId } : {}),
    evidence: [
      ...correction.evidence,
      {
        kind: "human" as const,
        label: `Corrected by a person: “${correction.original || "nothing stated"}” → “${correction.corrected}”`,
      },
    ] satisfies EvidenceRef[],
    meta: {
      kind: "correction",
      facet: correction.facet,
      ...(correction.personKey ? { personKey: correction.personKey } : {}),
      ...(correction.personName ? { personName: correction.personName } : {}),
      ...(correction.projectLabel ? { projectLabel: correction.projectLabel } : {}),
      original: correction.original,
      corrected: correction.corrected,
      ...(correction.conversationId ? { conversationId: correction.conversationId } : {}),
      ...(correction.commitmentId ? { commitmentId: correction.commitmentId } : {}),
      ...(correction.candidateId ? { candidateId: correction.candidateId } : {}),
    },
  };
}

/* ------------------------------------------------------- repeated evidence */

/** Dispositions that may teach. Withheld readings teach nothing, by law. */
const TEACHABLE = new Set(["commitment", "dependency", "decision"]);

const RESPONSIBILITY_STOPWORDS =
  /^(the|a|an|this|that|these|those|it|them|him|her|us|we|i|you)$/i;

/** A short noun-ish subject for a responsibility, e.g. "weekly planning document". */
function subjectOf(meaning: string): string {
  const words = meaning
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !RESPONSIBILITY_STOPWORDS.test(word));
  return words.slice(0, 6).join(" ");
}

/**
 * What one conversation offers as evidence of a recurring shape of work.
 *
 * Several mentions of the same flow inside one meeting collapse to a single
 * observation: a meeting repeating itself is not the work repeating itself.
 */
export function observationsFromSignals(input: {
  signals: InterpretedSignal[];
  conversationId: string;
  conversationTitle: string;
}): MemoryObservation[] {
  const byKey = new Map<string, MemoryObservation>();

  for (const signal of input.signals) {
    if (!TEACHABLE.has(signal.disposition)) continue;
    const ownerName = (signal.ownerName ?? "").trim();
    if (!ownerName) continue;
    const subject = subjectOf(signal.normalizedMeaning);
    if (!subject) continue;
    const personKey = personKeyOf({ name: ownerName });

    const push = (observation: MemoryObservation) => {
      if (!isPersonSafeStatement(observation.statement)) return;
      /* One conversation, one vote per pattern. */
      if (!byKey.has(observation.patternKey)) byKey.set(observation.patternKey, observation);
    };

    push({
      patternKey: patternKeyOf({ relation: "carries", personKey, subject }),
      kind: "responsibility",
      facet: "responsibility",
      relation: "carries",
      personKey,
      personName: ownerName,
      ...(signal.projectLabel ? { projectLabel: signal.projectLabel } : {}),
      statement: `${ownerName} often carries ${subject}.`,
      conversationId: input.conversationId,
      conversationTitle: input.conversationTitle,
      evidence: signal.evidence,
    });

    const blockedBy = (signal.blockedBy ?? "").trim();
    if (blockedBy && blockedBy.toLowerCase() !== ownerName.toLowerCase()) {
      const counterpartKey = personKeyOf({ name: blockedBy });
      push({
        patternKey: patternKeyOf({
          relation: "depends_on",
          personKey,
          counterpartKey,
          subject,
        }),
        kind: "handoff",
        facet: "relationship",
        relation: "depends_on",
        personKey,
        personName: ownerName,
        counterpartKey,
        counterpartName: blockedBy,
        statement: `${ownerName} usually waits on ${blockedBy} before ${subject} can move.`,
        conversationId: input.conversationId,
        conversationTitle: input.conversationTitle,
        evidence: signal.evidence,
      });
    }

    const beneficiary = (signal.beneficiary ?? "").trim();
    if (beneficiary && beneficiary.toLowerCase() !== ownerName.toLowerCase()) {
      const counterpartKey = personKeyOf({ name: beneficiary });
      push({
        patternKey: patternKeyOf({
          relation: "prepares_for",
          personKey,
          counterpartKey,
          subject,
        }),
        kind: "handoff",
        facet: "relationship",
        relation: "prepares_for",
        personKey,
        personName: ownerName,
        counterpartKey,
        counterpartName: beneficiary,
        statement: `${ownerName} usually prepares ${subject} for ${beneficiary}.`,
        conversationId: input.conversationId,
        conversationTitle: input.conversationTitle,
        evidence: signal.evidence,
      });
    }
  }

  return [...byKey.values()];
}

/**
 * Repeated evidence read from canonical truth.
 *
 * Confirmed commitments are the strongest evidence Steward has, because a
 * person put their name to each one, and they persist across every
 * conversation. Counting patterns here — rather than from one meeting's
 * interpretation — means a belief only forms from work the organization
 * actually agreed it was doing.
 */
export function observationsFromCommitments(input: {
  commitments: Commitment[];
  conversationTitleById?: Record<string, string>;
}): MemoryObservation[] {
  const observations: MemoryObservation[] = [];
  const seen = new Set<string>();

  for (const commitment of input.commitments) {
    const ownerName = commitment.ownerName.trim();
    if (!ownerName) continue;
    const subject = subjectOf(commitment.what);
    if (!subject) continue;
    const personKey = personKeyOf({
      email: commitment.ownerEmail ?? null,
      name: ownerName,
    });
    const conversationId = commitment.conversationId || commitment.id;
    const conversationTitle =
      input.conversationTitleById?.[conversationId] ?? "an earlier conversation";

    const push = (observation: MemoryObservation) => {
      if (!isPersonSafeStatement(observation.statement)) return;
      /* One conversation, one vote per pattern. */
      const key = `${observation.patternKey}|${observation.conversationId}`;
      if (seen.has(key)) return;
      seen.add(key);
      observations.push(observation);
    };

    push({
      patternKey: patternKeyOf({ relation: "carries", personKey, subject }),
      kind: "responsibility",
      facet: "responsibility",
      relation: "carries",
      personKey,
      personName: ownerName,
      statement: `${ownerName} often carries ${subject}.`,
      conversationId,
      conversationTitle,
      evidence: commitment.evidence,
    });

    const beneficiary = (commitment.beneficiary ?? "").trim();
    if (beneficiary && beneficiary.toLowerCase() !== ownerName.toLowerCase()) {
      const counterpartKey = personKeyOf({ name: beneficiary });
      push({
        patternKey: patternKeyOf({
          relation: "prepares_for",
          personKey,
          counterpartKey,
          subject,
        }),
        kind: "handoff",
        facet: "relationship",
        relation: "prepares_for",
        personKey,
        personName: ownerName,
        counterpartKey,
        counterpartName: beneficiary,
        statement: `${ownerName} usually prepares ${subject} for ${beneficiary}.`,
        conversationId,
        conversationTitle,
        evidence: commitment.evidence,
      });
    }
  }

  return observations;
}

/**

 * Patterns that have earned an inferred belief.
 *
 * A pattern needs `RECURRING_PATTERN_THRESHOLD` distinct conversations. Ones
 * already held — and ones a person has decided against — are left alone, so
 * Steward never re-proposes something it has been corrected on.
 */
export function accumulatePatterns(input: {
  observations: MemoryObservation[];
  existing: MemoryBelief[];
  threshold?: number;
}): MemoryDraft[] {
  const threshold = input.threshold ?? RECURRING_PATTERN_THRESHOLD;
  const held = new Set(
    input.existing
      .filter((belief) => belief.meta.patternKey)
      .map((belief) => belief.meta.patternKey as string),
  );
  const decidedSubjects = new Set(
    input.existing
      .filter((belief) => belief.tier === "decided")
      .map((belief) => `${belief.subjectKey}|${belief.meta.facet}`),
  );

  const grouped = new Map<string, MemoryObservation[]>();
  for (const observation of input.observations) {
    const list = grouped.get(observation.patternKey) ?? [];
    list.push(observation);
    grouped.set(observation.patternKey, list);
  }

  const drafts: MemoryDraft[] = [];
  for (const [patternKey, group] of grouped) {
    if (held.has(patternKey)) continue;
    const sources = [...new Set(group.map((observation) => observation.conversationId))];
    if (sources.length < threshold) continue;

    const first = group[0]!;
    const subjectKey =
      first.counterpartKey
        ? handoffSubject(first.personKey, first.counterpartKey)
        : personSubject(first.personKey);
    if (decidedSubjects.has(`${subjectKey}|${first.facet}`)) continue;

    drafts.push({
      subjectKey,
      subjectLabel: first.personName,
      statement: first.statement,
      /* Repetition is a reading, never a decision. */
      tier: "inferred",
      authority: "source",
      evidence: [
        ...group.slice(0, 6).map((observation) => ({
          kind: "computed" as const,
          label: `Seen in “${observation.conversationTitle}”`,
        })),
        {
          kind: "computed" as const,
          label: `Held after ${sources.length} separate conversations said the same thing.`,
        },
      ],
      meta: {
        kind: first.kind,
        facet: first.facet,
        relation: first.relation,
        personKey: first.personKey,
        personName: first.personName,
        ...(first.counterpartKey ? { counterpartKey: first.counterpartKey } : {}),
        ...(first.counterpartName ? { counterpartName: first.counterpartName } : {}),
        ...(first.projectLabel ? { projectLabel: first.projectLabel } : {}),
        patternKey,
        sourceConversationIds: sources,
      },
    });
  }

  return drafts;
}

/* --------------------------------------------------------------- resolution */

/**
 * What Steward currently holds, once history is applied.
 *
 * Superseded beliefs drop out, retired ones drop out, and where a decided
 * human correction and an inferred pattern speak about the same subject and
 * facet, the person wins. Nothing is deleted: this is a read, not a write.
 */
export function resolveMemory(beliefs: MemoryBelief[]): MemoryBelief[] {
  const superseded = new Set(
    beliefs.map((belief) => belief.supersedesId).filter((id): id is string => Boolean(id)),
  );
  const live = beliefs.filter(
    (belief) => !superseded.has(belief.id) && belief.meta.retired !== true,
  );

  const decidedSlots = new Set(
    live
      .filter((belief) => belief.tier === "decided")
      .map((belief) => `${belief.subjectKey}|${belief.meta.facet}`),
  );

  return live.filter((belief) => {
    if (belief.tier === "decided") return true;
    return !decidedSlots.has(`${belief.subjectKey}|${belief.meta.facet}`);
  });
}

/* ------------------------------------------------------- feedback, bounded */

/** What a person did with a reading. Structured feedback, not a score. */
export type LearningOutcome =
  | "confirmed"
  | "edited_then_confirmed"
  | "dismissed_as_context"
  | "marked_kept"
  | "marked_waiting"
  | "released"
  | "belief_corrected"
  | "belief_retired";

export interface OutcomeRecord {
  patternKey: string;
  outcome: LearningOutcome;
}

/** How many dismissals it takes before Steward stops raising a shape of reading. */
export const DISMISSAL_SUPPRESSION_THRESHOLD = 2;

/**
 * Patterns Steward should stop raising, because people keep saying they are
 * only context. Explicit and countable — no hidden weighting.
 */
export function suppressedPatterns(
  records: OutcomeRecord[],
  threshold = DISMISSAL_SUPPRESSION_THRESHOLD,
): string[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    if (record.outcome !== "dismissed_as_context") continue;
    counts.set(record.patternKey, (counts.get(record.patternKey) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= threshold)
    .map(([patternKey]) => patternKey);
}

/** Project context worth remembering, expressed as a subject key. */
export function projectMemorySubject(label: string): string {
  return projectSubject(label);
}
