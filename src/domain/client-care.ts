/**
 * After delivery: care, triage, outcome review and what comes next.
 *
 * Ops owns the technical care. Clients owns the account. Roadmap owns what the
 * client does next. This module prepares those readings and refuses the three
 * mistakes that make them dishonest:
 *
 *   - calling something healthy because nothing has been read
 *   - counting output volume as value the client received
 *   - selling to somebody who is currently complaining
 *
 * Nothing here fixes, sends or commits anything. Every remediation is a
 * suggestion for a person, and every renewal is a proposal for a person.
 */

import type { ID, ISODateTime } from "./entities";
import type { MetricClass, TruthClass } from "./outcomes";
import { metricClassOf } from "./outcomes";

/* ----------------------------------------------------------- care plan */

export const CARE_CHECKLIST_ORDER = [
  "support_boundaries",
  "care_owner",
  "monitoring_references",
  "review_date",
] as const;

export type CareChecklistItemKey = (typeof CARE_CHECKLIST_ORDER)[number];

export const CARE_CHECKLIST_LABEL: Record<CareChecklistItemKey, string> = {
  support_boundaries: "What we look after, and what we do not",
  care_owner: "Who looks after it",
  monitoring_references: "Where we watch it",
  review_date: "When we review it",
};

export interface CareChecklistItem {
  key: CareChecklistItemKey;
  label: string;
  /** What was recorded. Empty means nobody has recorded it yet. */
  value: string;
  recordedBy?: ID;
  recordedAt?: ISODateTime;
}

export type CareHealth = "healthy" | "attention" | "incident" | "unknown";

export interface CarePlan {
  key: string;
  organizationId: ID;
  clientRef: string;
  /** The accepted milestone this care follows from. */
  fromMilestoneId: string;
  checklist: CareChecklistItem[];
  /** Never guessed. Unread stays unknown, with the reason. */
  health: CareHealth;
  healthBecause: string;
  createdBy: ID;
  createdAt: ISODateTime;
}

export type CarePlanOutcome =
  | { created: true; plan: CarePlan; alreadyExisted: boolean }
  | { created: false; because: string };

/**
 * Accepted delivery opens exactly one care plan for that milestone. Asking
 * again returns the first one. Nothing is created before acceptance.
 */
export function openCarePlan(input: {
  organizationId: ID;
  clientRef: string;
  milestoneId: string;
  milestoneAccepted: boolean;
  by: ID;
  at: ISODateTime;
  recorded?: Partial<Record<CareChecklistItemKey, string>> | undefined;
  existing?: CarePlan[];
}): CarePlanOutcome {
  const key = `${input.clientRef}::care::${input.milestoneId}`;
  const existing = (input.existing ?? []).find((plan) => plan.key === key);
  if (existing) return { created: true, plan: existing, alreadyExisted: true };
  if (!input.milestoneAccepted) {
    return { created: false, because: "The milestone has not been accepted yet." };
  }
  if (!input.by.trim()) return { created: false, because: "Say who is opening this." };

  const checklist = CARE_CHECKLIST_ORDER.map((itemKey) => {
    const value = input.recorded?.[itemKey]?.trim() ?? "";
    return {
      key: itemKey,
      label: CARE_CHECKLIST_LABEL[itemKey],
      value,
      ...(value ? { recordedBy: input.by, recordedAt: input.at } : {}),
    } satisfies CareChecklistItem;
  });

  return {
    created: true,
    alreadyExisted: false,
    plan: {
      key,
      organizationId: input.organizationId,
      clientRef: input.clientRef,
      fromMilestoneId: input.milestoneId,
      checklist,
      // Nothing has been read yet, so nothing is claimed.
      health: "unknown",
      healthBecause: "Nothing has been read from monitoring yet.",
      createdBy: input.by,
      createdAt: input.at,
    },
  };
}

/** What is still missing from the care plan, in plain words. */
export function careGaps(plan: CarePlan): string[] {
  return plan.checklist
    .filter((item) => !item.value)
    .map((item) => `${item.label} is not recorded yet.`);
}

export interface HealthReading {
  source: string;
  observedAt: ISODateTime;
  /** Null means the source could not be read at all. */
  state: Exclude<CareHealth, "unknown"> | null;
  note: string;
}

/** Read health from what monitoring actually said. Silence is never health. */
export function readCareHealth(input: {
  plan: CarePlan;
  readings: HealthReading[];
}): { health: CareHealth; because: string } {
  const monitoring = input.plan.checklist.find((item) => item.key === "monitoring_references");
  if (!monitoring?.value) {
    return { health: "unknown", because: "No monitoring reference has been recorded." };
  }
  if (input.readings.length === 0) {
    return { health: "unknown", because: "Nothing has been read from monitoring yet." };
  }
  const unreadable = input.readings.filter((reading) => reading.state === null);
  if (unreadable.length === input.readings.length) {
    return {
      health: "unknown",
      because: `Monitoring could not be read (${unreadable.map((reading) => reading.source).join(", ")}).`,
    };
  }
  const states = input.readings
    .map((reading) => reading.state)
    .filter((state): state is Exclude<CareHealth, "unknown"> => state !== null);
  const worst: CareHealth = states.includes("incident")
    ? "incident"
    : states.includes("attention")
      ? "attention"
      : "healthy";
  const partial =
    unreadable.length > 0
      ? ` Some sources could not be read (${unreadable.map((reading) => reading.source).join(", ")}), so this is a partial reading.`
      : "";
  return {
    health: worst,
    because: `Read from ${states.length} monitoring source(s).${partial}`,
  };
}

/* -------------------------------------------------------------- triage */

export interface HealthEvent {
  id: string;
  clientRef: string;
  source: string;
  /** Stable identity of the underlying problem, for grouping repeats. */
  signature: string;
  occurredAt: ISODateTime;
  summary: string;
}

export interface TriageSuggestion {
  signature: string;
  clientRef: string;
  /** The events this suggestion stands on. */
  eventIds: string[];
  occurrences: number;
  firstSeenAt: ISODateTime;
  lastSeenAt: ISODateTime;
  suggestion: string;
  /** Always true. Nothing here is carried out by the system. */
  needsPersonToAct: true;
  ownerLabel: string;
}

const DESTRUCTIVE = [
  "delete",
  "drop ",
  "truncate",
  "restart",
  "reset",
  "revoke",
  "rotate",
  "wipe",
  "restore",
];

/** A suggestion that would destroy or disrupt something is refused outright. */
export function suggestionIsPermitted(text: string): boolean {
  const lower = text.toLowerCase();
  return !DESTRUCTIVE.some((word) => lower.includes(word));
}

/** Group repeats into one suggestion each. Ten alerts are not ten jobs. */
export function triageFromEvents(input: {
  clientRef: string;
  events: HealthEvent[];
  ownerLabel: string;
}): { suggestions: TriageSuggestion[]; refused: string[] } {
  const own = input.events.filter((event) => event.clientRef === input.clientRef);
  const refused: string[] = [];
  const grouped = new Map<string, TriageSuggestion>();

  for (const event of own) {
    const text = `Look at ${event.summary}, first seen from ${event.source}.`;
    if (!suggestionIsPermitted(text)) {
      refused.push(`A suggestion for ${event.id} was refused because it would change or remove something.`);
      continue;
    }
    const existing = grouped.get(event.signature);
    if (existing) {
      existing.eventIds.push(event.id);
      existing.occurrences += 1;
      existing.firstSeenAt =
        event.occurredAt < existing.firstSeenAt ? event.occurredAt : existing.firstSeenAt;
      existing.lastSeenAt =
        event.occurredAt > existing.lastSeenAt ? event.occurredAt : existing.lastSeenAt;
      continue;
    }
    grouped.set(event.signature, {
      signature: event.signature,
      clientRef: event.clientRef,
      eventIds: [event.id],
      occurrences: 1,
      firstSeenAt: event.occurredAt,
      lastSeenAt: event.occurredAt,
      suggestion: text,
      needsPersonToAct: true,
      ownerLabel: input.ownerLabel,
    });
  }

  return { suggestions: [...grouped.values()], refused };
}

/* ------------------------------------------------------ outcome review */

export interface MeasurePoint {
  /** Metric key from the shared outcome vocabulary, when it is one. */
  key: string;
  label: string;
  value: number | null;
  unit: string;
  tier: TruthClass;
  evidenceRef?: string;
}

export interface OutcomeReview {
  clientRef: string;
  baseline: MeasurePoint;
  target: MeasurePoint;
  observed: MeasurePoint;
  metricClass: MetricClass | "unknown";
  /** Movement from baseline to observed, or null when a figure is missing. */
  movement: number | null;
  /** Whether the target was reached, or null when it cannot be told. */
  targetReached: boolean | null;
  /** Value we can honestly attribute, or null. Never output volume. */
  attributedValue: { amountMinor: number; currency: string; because: string } | null;
  notes: string[];
}

/** Compare what was agreed against what actually happened, or say we cannot. */
export function reviewOutcome(input: {
  clientRef: string;
  baseline: MeasurePoint;
  target: MeasurePoint;
  observed: MeasurePoint;
  attributed?: { amountMinor: number; currency: string; evidenceRef?: string };
}): OutcomeReview {
  const notes: string[] = [];
  const metricClass = metricClassOf(input.observed.key) ?? "unknown";

  const missing = [input.baseline, input.target, input.observed].filter(
    (point) => point.value === null,
  );
  for (const point of missing) notes.push(`${point.label} is not recorded, so it is unknown, not nought.`);

  const confirmed = [input.baseline, input.observed].every(
    (point) => point.tier === "observed" || point.tier === "decided",
  );
  if (!confirmed) {
    notes.push("Baseline or result is not confirmed, so any comparison here is provisional.");
  }

  const movement =
    input.baseline.value === null || input.observed.value === null
      ? null
      : input.observed.value - input.baseline.value;

  const targetReached =
    input.target.value === null || input.observed.value === null
      ? null
      : input.observed.value >= input.target.value;

  let attributedValue: OutcomeReview["attributedValue"] = null;
  if (input.attributed) {
    if (metricClass === "output") {
      notes.push(
        "This is a measure of what we produced, not of what the client gained, so no value is attributed to it.",
      );
    } else if (!input.attributed.evidenceRef) {
      notes.push("No evidence was given for the attributed value, so none is claimed.");
    } else if (!confirmed) {
      notes.push("The result is not confirmed, so no value is attributed yet.");
    } else {
      attributedValue = {
        amountMinor: input.attributed.amountMinor,
        currency: input.attributed.currency,
        because: `Attributed from ${input.attributed.evidenceRef}.`,
      };
    }
  }

  return {
    clientRef: input.clientRef,
    baseline: input.baseline,
    target: input.target,
    observed: input.observed,
    metricClass,
    movement,
    targetReached,
    attributedValue,
    notes,
  };
}

/* ------------------------------------------- renewal and expansion */

export type AccountMood = "settled" | "complaint_open" | "service_recovery";

export interface OpportunityProposal {
  clientRef: string;
  headline: string;
  because: string[];
  evidenceRefs: string[];
  /** When it would make sense to raise it, and why then. */
  timing: string;
  /** Always true. This is a proposal for a person, never an approach. */
  needsPersonToRaise: true;
}

export type OpportunityOutcome =
  | { proposed: true; proposal: OpportunityProposal }
  | { proposed: false; because: string };

/**
 * Propose renewal or expansion only from confirmed evidence, and never while
 * the client is complaining or being put right.
 */
export function proposeOpportunity(input: {
  clientRef: string;
  mood: AccountMood;
  review: OutcomeReview;
  renewalDueAt?: ISODateTime;
  headline: string;
}): OpportunityOutcome {
  if (input.mood !== "settled") {
    return {
      proposed: false,
      because:
        input.mood === "complaint_open"
          ? "There is an open complaint, so nothing is proposed to sell right now."
          : "We are putting something right, so nothing is proposed to sell right now.",
    };
  }
  const evidenceRefs = [input.review.observed.evidenceRef, input.review.baseline.evidenceRef].filter(
    (ref): ref is string => Boolean(ref),
  );
  if (evidenceRefs.length === 0) {
    return { proposed: false, because: "There is no recorded result to stand this on." };
  }
  if (input.review.targetReached === null) {
    return { proposed: false, because: "We cannot yet tell whether the target was reached." };
  }

  const because = [
    input.review.targetReached
      ? `${input.review.observed.label} reached the target.`
      : `${input.review.observed.label} moved but has not reached the target.`,
    ...(input.review.attributedValue
      ? [`Value attributed so far: ${input.review.attributedValue.because}`]
      : ["No value has been attributed yet."]),
  ];

  return {
    proposed: true,
    proposal: {
      clientRef: input.clientRef,
      headline: input.headline,
      because,
      evidenceRefs,
      timing: input.renewalDueAt
        ? `Raise it before the renewal on ${input.renewalDueAt.slice(0, 10)}.`
        : "No renewal date is recorded, so the timing is a judgement for the account owner.",
      needsPersonToRaise: true,
    },
  };
}
