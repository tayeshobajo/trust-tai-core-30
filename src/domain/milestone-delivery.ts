/**
 * Delivering a milestone: proposed work, real availability, honest acceptance.
 *
 * Projects owns execution. This module prepares the work and keeps three
 * different things apart that are easy to blur together:
 *
 *   a task is finished   ≠   a milestone is accepted   ≠   the client got what
 *                                                          they came for
 *
 * Nothing here assigns a person or commits a date. A lead does that, and only
 * against availability somebody actually recorded. A guess is refused.
 */

import type { ID, ISODateTime } from "./entities";

/* ------------------------------------------------------- proposed work */

export interface ProposedTest {
  id: string;
  description: string;
}

export type TaskState = "proposed" | "accepted" | "in_progress" | "complete";

export interface DeliveryTask {
  id: string;
  milestoneId: string;
  title: string;
  /** Why this task exists, tied to the accepted scope line it serves. */
  fromScopeLine: string;
  tests: ProposedTest[];
  dependsOn: string[];
  state: TaskState;
  /** Only ever set by a lead. Never prepared, never guessed. */
  ownerId?: ID;
  dueDate?: ISODateTime;
  acceptedBy?: ID;
  /** Recorded effort in days, when someone has estimated it. */
  estimatedDays?: number;
}

export interface ScopeLine {
  id: string;
  text: string;
}

/** Break a milestone into proposed tasks. Everything stays a proposal. */
export function decomposeMilestone(input: {
  milestoneId: string;
  scopeLines: ScopeLine[];
  /** Ordered dependency hints, by scope line id. */
  dependsOn?: Record<string, string[]>;
}): DeliveryTask[] {
  return input.scopeLines.map((scopeLine, index) => ({
    id: `${input.milestoneId}::task::${scopeLine.id}`,
    milestoneId: input.milestoneId,
    title: scopeLine.text,
    fromScopeLine: scopeLine.id,
    tests: [
      { id: `${scopeLine.id}::test`, description: `Check that ${scopeLine.text} is in place.` },
    ],
    dependsOn: (input.dependsOn?.[scopeLine.id] ?? []).map(
      (dependency) => `${input.milestoneId}::task::${dependency}`,
    ),
    state: "proposed",
    ...(index === 0 ? {} : {}),
  }));
}

/* --------------------------------------------------- recorded availability */

export interface AvailabilityRecord {
  personId: ID;
  /** Days this person is available in the week starting on this date. */
  weekStart: ISODateTime;
  availableDays: number;
  recordedBy: ID;
}

export interface AcceptanceRefusal {
  accepted: false;
  because: string;
}

export type TaskAcceptance = { accepted: true; task: DeliveryTask } | AcceptanceRefusal;

function weekStartOf(date: ISODateTime): string {
  const day = new Date(date);
  const offset = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - offset);
  return `${day.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

/** A lead names the owner and the date. Without recorded availability, no. */
export function acceptTask(input: {
  task: DeliveryTask;
  ownerId: ID;
  dueDate: ISODateTime;
  leadId: ID;
  availability: AvailabilityRecord[];
}): TaskAcceptance {
  if (!input.leadId.trim()) return { accepted: false, because: "Say who is accepting this work." };
  if (!input.ownerId.trim()) return { accepted: false, because: "Name the person who will do it." };

  const week = weekStartOf(input.dueDate);
  const record = input.availability.find(
    (entry) => entry.personId === input.ownerId && weekStartOf(entry.weekStart) === week,
  );
  if (!record) {
    return {
      accepted: false,
      because: "There is no recorded availability for that person in that week, so the date cannot be committed.",
    };
  }
  return {
    accepted: true,
    task: {
      ...input.task,
      state: "accepted",
      ownerId: input.ownerId,
      dueDate: input.dueDate,
      acceptedBy: input.leadId,
    },
  };
}

export interface CapacityLine {
  personId: ID;
  weekStart: string;
  committedDays: number;
  availableDays: number | null;
  overAllocatedBy: number | null;
}

export interface CapacityRead {
  lines: CapacityLine[];
  conflicts: string[];
  /** Named when availability is missing for someone with committed work. */
  partial: string[];
}

/** What is committed against what is actually available, before dates stick. */
export function capacityRead(input: {
  tasks: DeliveryTask[];
  availability: AvailabilityRecord[];
}): CapacityRead {
  const buckets = new Map<string, CapacityLine>();

  for (const task of input.tasks) {
    if (!task.ownerId || !task.dueDate) continue;
    const week = weekStartOf(task.dueDate);
    const key = `${task.ownerId}|${week}`;
    const record = input.availability.find(
      (entry) => entry.personId === task.ownerId && weekStartOf(entry.weekStart) === week,
    );
    const line = buckets.get(key) ?? {
      personId: task.ownerId,
      weekStart: week,
      committedDays: 0,
      availableDays: record ? record.availableDays : null,
      overAllocatedBy: null,
    };
    line.committedDays += task.estimatedDays ?? 0;
    buckets.set(key, line);
  }

  const lines = [...buckets.values()].map((line) => ({
    ...line,
    overAllocatedBy:
      line.availableDays === null ? null : Math.max(0, line.committedDays - line.availableDays) || null,
  }));

  const conflicts = lines
    .filter((line) => line.overAllocatedBy !== null && line.overAllocatedBy > 0)
    .map(
      (line) =>
        `${line.personId} is committed to ${line.committedDays} days in the week of ${line.weekStart.slice(0, 10)} against ${line.availableDays} available.`,
    );

  const partial = lines
    .filter((line) => line.availableDays === null)
    .map(
      (line) =>
        `No availability recorded for ${line.personId} in the week of ${line.weekStart.slice(0, 10)}, so this is a partial reading.`,
    );

  return { lines, conflicts, partial };
}

/* ------------------------------------------------------------- acceptance */

export interface TestResult {
  testId: string;
  passed: boolean;
  recordedBy: ID;
  recordedAt: ISODateTime;
  note: string;
}

export interface MilestoneEvidence {
  ref: string;
  label: string;
  recordedAt: ISODateTime;
}

export type MilestoneAcceptanceState = "in_progress" | "ready_for_acceptance" | "accepted" | "rejected";

export interface MilestoneRecord {
  milestoneId: string;
  clientRef: string;
  state: MilestoneAcceptanceState;
  evidence: MilestoneEvidence[];
  testResults: TestResult[];
  decidedBy?: ID;
  decidedAt?: ISODateTime;
  decisionNote?: string;
  /** Whether the client outcome behind this milestone has been confirmed. */
  clientOutcomeConfirmedBy?: ID;
}

export interface MilestoneReading {
  tasksComplete: boolean;
  readyForAcceptance: boolean;
  accepted: boolean;
  clientOutcomeConfirmed: boolean;
  /** Plain words about anything still in the way. */
  missing: string[];
}

/** Three separate readings, never collapsed into one green tick. */
export function milestoneReading(input: {
  milestone: MilestoneRecord;
  tasks: DeliveryTask[];
}): MilestoneReading {
  const missing: string[] = [];
  const tasksComplete =
    input.tasks.length > 0 && input.tasks.every((task) => task.state === "complete");
  if (!tasksComplete) missing.push("Not every task is finished.");

  const failed = input.milestone.testResults.filter((result) => !result.passed);
  if (failed.length > 0) missing.push(`${failed.length} check(s) did not pass.`);

  const expectedTests = input.tasks.flatMap((task) => task.tests.map((test) => test.id));
  const untested = expectedTests.filter(
    (id) => !input.milestone.testResults.some((result) => result.testId === id),
  );
  if (untested.length > 0) missing.push(`${untested.length} check(s) have no result recorded.`);

  if (input.milestone.evidence.length === 0) missing.push("No evidence recorded yet.");

  const readyForAcceptance = missing.length === 0;
  return {
    tasksComplete,
    readyForAcceptance,
    accepted: input.milestone.state === "accepted",
    clientOutcomeConfirmed: Boolean(input.milestone.clientOutcomeConfirmedBy),
    missing,
  };
}

export type AcceptanceDecision =
  | { decided: true; milestone: MilestoneRecord }
  | { decided: false; because: string };

/** Acceptance is always somebody's explicit decision, with their name on it. */
export function decideMilestone(input: {
  milestone: MilestoneRecord;
  tasks: DeliveryTask[];
  outcome: "accepted" | "rejected";
  by: ID;
  at: ISODateTime;
  note: string;
}): AcceptanceDecision {
  if (!input.by.trim()) return { decided: false, because: "Say who is deciding." };
  const reading = milestoneReading({ milestone: input.milestone, tasks: input.tasks });
  if (input.outcome === "accepted" && !reading.readyForAcceptance) {
    return { decided: false, because: reading.missing.join(" ") };
  }
  return {
    decided: true,
    milestone: {
      ...input.milestone,
      state: input.outcome,
      decidedBy: input.by,
      decidedAt: input.at,
      decisionNote: input.note,
    },
  };
}

/* ---------------------------------------------------------- scope changes */

export interface ScopeChangeRequest {
  id: string;
  milestoneId: string;
  clientRef: string;
  description: string;
  /** Extra days, when someone has estimated it. Null means not estimated. */
  extraDays: number | null;
  /** Extra cost in minor units, in the agreement currency. Null if unknown. */
  extraCostMinor: number | null;
  raisedBy: ID;
  raisedAt: ISODateTime;
}

export interface ScopeChangeImpact {
  /** Always true here: a scope change never lands in delivery on its own. */
  routedToCommercialDecision: true;
  handoffKey: string;
  timeImpact: string;
  costImpact: string;
  /** What the milestone can and cannot do while this is open. */
  commitmentsUnchanged: string;
}

/** A change is proposed and routed. It never widens the commitment quietly. */
export function scopeChangeImpact(request: ScopeChangeRequest): ScopeChangeImpact {
  return {
    routedToCommercialDecision: true,
    handoffKey: `${request.id}::commercial`,
    timeImpact:
      request.extraDays === null
        ? "Extra time not estimated yet."
        : `Adds about ${request.extraDays} day(s).`,
    costImpact:
      request.extraCostMinor === null
        ? "Extra cost not worked out yet."
        : `Adds ${request.extraCostMinor} in minor units, subject to approval.`,
    commitmentsUnchanged:
      "The agreed scope, dates and price stay as they are until someone approves this change.",
  };
}

/* ------------------------------------------------------------ Ops handoff */

export interface OpsHandoff {
  key: string;
  milestoneId: string;
  clientRef: string;
  recordedBy: ID;
  recordedAt: ISODateTime;
  evidenceRefs: string[];
}

export type OpsHandoffOutcome =
  | { recorded: true; handoff: OpsHandoff; alreadyRecorded: boolean }
  | { recorded: false; because: string };

/** Recorded once when a milestone is accepted. A retry returns the first one. */
export function recordOpsHandoff(input: {
  milestone: MilestoneRecord;
  by: ID;
  at: ISODateTime;
  existing?: OpsHandoff[];
}): OpsHandoffOutcome {
  const key = `${input.milestone.milestoneId}::ops`;
  const existing = (input.existing ?? []).find((entry) => entry.key === key);
  if (existing) return { recorded: true, handoff: existing, alreadyRecorded: true };
  if (input.milestone.state !== "accepted") {
    return { recorded: false, because: "The milestone has not been accepted yet." };
  }
  return {
    recorded: true,
    alreadyRecorded: false,
    handoff: {
      key,
      milestoneId: input.milestone.milestoneId,
      clientRef: input.milestone.clientRef,
      recordedBy: input.by,
      recordedAt: input.at,
      evidenceRefs: input.milestone.evidence.map((entry) => entry.ref),
    },
  };
}

/* ------------------------------------------------------------------ risks */

export interface DeliveryRisk {
  id: string;
  what: string;
  /** Why it is a risk. Never left blank. */
  because: string;
  ownerId: ID;
  nextAction: string;
}

export type RiskOutcome = { ok: true; risk: DeliveryRisk } | { ok: false; because: string };

/** A risk without a reason, an owner and a next action is not a risk, it is noise. */
export function recordRisk(risk: DeliveryRisk): RiskOutcome {
  if (!risk.because.trim()) return { ok: false, because: "Say why this is a risk." };
  if (!risk.ownerId.trim()) return { ok: false, because: "Name who is holding this risk." };
  if (!risk.nextAction.trim()) return { ok: false, because: "Say what happens next." };
  return { ok: true, risk };
}
