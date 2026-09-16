/**
 * Discovery, written down properly.
 *
 * A discovery record holds what the client wants, what stands in the way, who
 * is involved, what we still do not know about money and timing, how they will
 * judge success, and where each of those came from. The raw notes stay exactly
 * as taken and stay reachable; the structured read never replaces them.
 *
 * Approving a discovery opens one roadmap. Only one, ever, per discovery.
 */

import type { ID, ISODateTime } from "./entities";

export interface DiscoverySource {
  sourceId: string;
  label: string;
  occurredAt: ISODateTime;
  /** Untouched. The structured fields below point back at this. */
  rawText: string;
}

export interface DiscoveryField {
  statement: string;
  groundedIn: string[];
}

export interface Stakeholder {
  label: string;
  role: string;
  groundedIn: string[];
}

/** Something we do not know. Named, not guessed at. */
export interface DiscoveryUnknown {
  topic: "budget" | "timing" | "other";
  question: string;
}

export type DiscoveryState = "draft" | "ready_for_review" | "approved" | "parked";

export interface DiscoveryRecord {
  key: string;
  organizationId: ID;
  clientRef: string;
  desiredOutcome: DiscoveryField | null;
  constraints: DiscoveryField[];
  stakeholders: Stakeholder[];
  unknowns: DiscoveryUnknown[];
  successMeasure: DiscoveryField | null;
  sources: DiscoverySource[];
  state: DiscoveryState;
  ownerUserId?: ID;
  approvedBy?: ID;
  approvedAt?: ISODateTime;
}

export function discoveryKey(organizationId: ID, clientRef: string): string {
  return `${organizationId}::discovery::${clientRef}`;
}

export interface DiscoveryReadiness {
  ready: boolean;
  missing: string[];
}

/**
 * What still has to be captured. Budget and timing may be unknown, but the
 * unknown has to be written down as a question rather than left blank.
 */
export function discoveryReadiness(record: DiscoveryRecord): DiscoveryReadiness {
  const missing: string[] = [];
  if (!record.desiredOutcome) missing.push("What they want to be true afterwards.");
  if (!record.successMeasure) missing.push("How they will judge whether it worked.");
  if (record.stakeholders.length === 0) missing.push("Who is involved in the decision.");
  if (record.sources.length === 0) missing.push("Where any of this came from.");
  for (const topic of ["budget", "timing"] as const) {
    const known = record.constraints.some((entry) =>
      entry.statement.toLowerCase().includes(topic),
    );
    const named = record.unknowns.some((entry) => entry.topic === topic);
    if (!known && !named) {
      missing.push(
        topic === "budget"
          ? "Budget: either what they said, or the question we still need to ask."
          : "Timing: either what they said, or the question we still need to ask.",
      );
    }
  }
  const ungrounded = [
    record.desiredOutcome,
    record.successMeasure,
    ...record.constraints,
  ].some((field) => field !== null && field !== undefined && field.groundedIn.length === 0);
  if (ungrounded) missing.push("Every captured line needs the note it came from.");
  return { ready: missing.length === 0, missing };
}

/* ----------------------------------------------------------- the handoff */

export interface RoadmapOpening {
  key: string;
  organizationId: ID;
  clientRef: string;
  discoveryKey: string;
  title: string;
  objective: string;
  ownerUserId: ID;
  /** Carried across so the roadmap can show where each line came from. */
  sourceRefs: { sourceId: string; label: string; occurredAt: ISODateTime }[];
  /** The questions discovery did not settle. They travel, they do not vanish. */
  unansweredQuestions: string[];
  openedBy: ID;
  openedAt: ISODateTime;
}

export type RoadmapHandoff =
  | { opened: true; opening: RoadmapOpening }
  | { opened: false; because: string }
  | { opened: false; duplicate: true; key: string; because: string };

/**
 * Open the roadmap that follows an approved discovery. A draft, a parked
 * record, an unapproved one or one without an owner opens nothing, and a
 * second attempt returns the first key instead of a second roadmap.
 */
export function roadmapHandoffFor(input: {
  record: DiscoveryRecord;
  by: { userId: ID };
  at: ISODateTime;
  existingKeys?: string[];
}): RoadmapHandoff {
  const { record } = input;
  if (record.state !== "approved" || !record.approvedBy) {
    return { opened: false, because: "Discovery has not been approved by anyone yet." };
  }
  const readiness = discoveryReadiness(record);
  if (!readiness.ready) {
    return { opened: false, because: `Discovery is incomplete: ${readiness.missing[0]}` };
  }
  if (!record.ownerUserId) {
    return { opened: false, because: "This discovery has no owner, so nothing can be handed over." };
  }

  const key = `${record.key}::roadmap`;
  if ((input.existingKeys ?? []).includes(key)) {
    return {
      opened: false,
      duplicate: true,
      key,
      because: "A roadmap was already opened from this discovery.",
    };
  }

  return {
    opened: true,
    opening: {
      key,
      organizationId: record.organizationId,
      clientRef: record.clientRef,
      discoveryKey: record.key,
      title: `Roadmap from discovery`,
      objective: record.desiredOutcome?.statement ?? "",
      ownerUserId: record.ownerUserId,
      sourceRefs: record.sources.map((source) => ({
        sourceId: source.sourceId,
        label: source.label,
        occurredAt: source.occurredAt,
      })),
      unansweredQuestions: record.unknowns.map((entry) => entry.question),
      openedBy: input.by.userId,
      openedAt: input.at,
    },
  };
}

/** The raw notes, always reachable from the structured read. */
export function rawNotesOf(record: DiscoveryRecord) {
  return record.sources.map((source) => ({
    sourceId: source.sourceId,
    label: source.label,
    occurredAt: source.occurredAt,
    rawText: source.rawText,
  }));
}
