/**
 * Round 10: one synthetic company walks the whole journey, and then the same
 * journey is pushed on repeats, a refusal, a scope change and an unauthorised
 * transition. Synthetic data only. Nothing here sends, publishes or persists.
 */
import { describe, expect, it } from "vitest";

import {
  discoveryKey,
  discoveryReadiness,
  roadmapHandoffFor,
  type DiscoveryRecord,
} from "./discovery-intake";
import {
  approveDestination,
  approvePriorities,
  freezeRoadmapVersion,
  roadmapChanges,
  type PreparedRoadmap,
} from "./roadmap-preparation";
import { deriveProposal, quoteReadiness, rederiveAgainst } from "./proposal-derivation";
import {
  setAgreementStage,
  setPaymentStage,
  paymentView,
  type AgreementRecord,
  type PaymentRecord,
} from "./agreement-state";
import {
  CHECKLIST_ORDER,
  onboardingReadiness,
  openProjectsWorkspace,
  recordAccessNeed,
  type ChecklistState,
} from "./onboarding-readiness";
import {
  acceptTask,
  decideMilestone,
  decomposeMilestone,
  milestoneReading,
  recordOpsHandoff,
  type AvailabilityRecord,
  type MilestoneRecord,
} from "./milestone-delivery";
import { openCarePlan, reviewOutcome } from "./client-care";

const ORG = "org-fixture-0000-0000-0000-000000000001";
const CLIENT = "fixture-client-e2e-01";
const LEAD = "fixture-person-lead";
const DOER = "fixture-person-doer";
const AT = "2026-03-02T09:00:00.000Z";

function discovery(): DiscoveryRecord {
  return {
    key: discoveryKey(ORG, CLIENT),
    organizationId: ORG,
    clientRef: CLIENT,
    desiredOutcome: {
      statement: "Monthly reporting the board trusts.",
      groundedIn: ["fixture:note/1"],
    },
    constraints: [
      { statement: "It must land before the March board.", groundedIn: ["fixture:note/1"] },
    ],
    stakeholders: [
      { label: "Finance lead (synthetic)", role: "Signs it off", groundedIn: ["fixture:note/1"] },
    ],
    unknowns: [{ topic: "budget", question: "What can they spend this year?" }],
    successMeasure: {
      statement: "The board stops asking for ad hoc numbers.",
      groundedIn: ["fixture:note/1"],
    },
    sources: [
      {
        sourceId: "fixture:note/1",
        label: "Discovery call note (synthetic)",
        occurredAt: "2026-02-02T10:00:00.000Z",
        rawText: "They said the board does not trust the monthly pack.",
      },
    ],
    state: "approved",
    ownerUserId: LEAD,
    approvedBy: LEAD,
    approvedAt: "2026-02-03T09:00:00.000Z",
  };
}

function roadmap(): PreparedRoadmap {
  return {
    organizationId: ORG,
    clientRef: CLIENT,
    pointA: [{ statement: "The pack is rebuilt by hand each month.", tier: "observed", evidence: [] }],
    destination: { statement: "One pack the board trusts.", tier: "inferred", evidence: [] },
    phases: [
      {
        id: "p1",
        position: 1,
        title: "One source of numbers",
        intent: "Stop the disagreement over figures",
        options: [{ id: "o1", label: "Single reporting source", because: "One set of numbers", dependsOn: [] }],
        dependsOn: [],
        evidence: [],
      },
      {
        id: "p2",
        position: 2,
        title: "Repeatable pack",
        intent: "Same pack every month",
        options: [{ id: "o2", label: "Fixed template", because: "Repeatable", dependsOn: ["p1"] }],
        dependsOn: ["p1"],
        evidence: [],
      },
    ],
    firstMove: { statement: "Agree who owns the numbers.", tier: "inferred", evidence: [] },
    unknowns: ["Budget has not been discussed."],
  };
}

const ESTIMATES = [
  { phaseId: "p1", days: 4, currency: "GBP", amount: "2400.00", recordedBy: LEAD },
  { phaseId: "p2", days: 3, currency: "GBP", amount: "1800.00", recordedBy: LEAD },
];

const CAPACITY = [
  { phaseId: "p1", checkedBy: LEAD, checkedAt: AT, canStartFrom: AT, note: "Two people free" },
  { phaseId: "p2", checkedBy: LEAD, checkedAt: AT, canStartFrom: null, note: "After the first phase" },
];

const AVAILABILITY: AvailabilityRecord[] = [
  { personId: DOER, weekStart: "2026-03-02T00:00:00.000Z", availableDays: 4, recordedBy: LEAD },
];

function fullChecklist(): ChecklistState {
  return {
    clientRef: CLIENT,
    items: CHECKLIST_ORDER.map((key) => ({ key, met: true, detail: `${key} recorded (synthetic)` })),
  };
}

describe("A10.1 the whole journey on one synthetic company", () => {
  it("runs discovery to outcome review with the same ids and context intact", () => {
    const record = discovery();
    expect(discoveryReadiness(record).ready).toBe(true);

    const handoff = roadmapHandoffFor({ record, by: { userId: LEAD }, at: AT });
    if (!handoff.opened) throw new Error(handoff.because);
    expect(handoff.opening.sourceRefs).toContain("fixture:note/1");

    const destination = approveDestination({ roadmap: roadmap(), by: LEAD, at: AT });
    if (!destination.approved) throw new Error(destination.because);
    const ordered = approvePriorities({ roadmap: destination.roadmap, order: ["p1", "p2"], by: LEAD });
    if (!ordered.approved) throw new Error(ordered.because);

    const frozen = freezeRoadmapVersion({ roadmap: ordered.roadmap, by: LEAD, at: AT });
    if (!frozen.frozen) throw new Error(frozen.because);

    expect(quoteReadiness({ version: frozen.version, estimates: ESTIMATES, capacity: CAPACITY }).ready).toBe(true);

    const proposal = deriveProposal({ version: frozen.version, estimates: ESTIMATES, at: AT });
    expect(proposal.fromVersionId).toBe(frozen.version.versionId);
    expect(proposal.fromVersionStamp).toBe(frozen.version.stamp);
    expect(proposal.scope.every((line) => line.fromVersionId === frozen.version.versionId)).toBe(true);

    // Simulated commercial evidence. No finance system is contacted.
    const agreement = setAgreementStage({
      record: { clientRef: CLIENT, stage: "proposed", evidence: null, changedBy: null, changedAt: null },
      stage: "client_accepted",
      actorKind: "person",
      by: LEAD,
      at: AT,
      evidence: { kind: "human_attested", by: LEAD, at: AT, note: "Accepted on a synthetic call." },
    });
    if (!agreement.changed) throw new Error(agreement.because);

    const payment = setPaymentStage({
      record: { clientRef: CLIENT, stage: "unpaid", evidence: null, changedBy: null, changedAt: null },
      stage: "invoiced",
      actorKind: "person",
      by: LEAD,
      at: AT,
      evidence: { kind: "reference", system: "Synthetic ledger", reference: "fixture:invoice/1", observedAt: AT },
    });
    if (!payment.changed) throw new Error(payment.because);
    expect(paymentView({ record: payment.record }).stage).toBe("invoiced");

    const access = recordAccessNeed({
      store: "Team password manager",
      itemRef: "fixture:reporting-login",
      requestedBy: LEAD,
    });
    expect(access.accepted).toBe(true);

    const state = fullChecklist();
    const readiness = onboardingReadiness(state);
    expect(readiness.ready).toBe(true);

    const opened = openProjectsWorkspace({
      state,
      readiness,
      by: LEAD,
      at: AT,
      sources: [frozen.version.versionId, handoff.opening.key],
    });
    if (!opened.opened) throw new Error(opened.because.join(" "));
    expect(opened.alreadyOpen).toBe(false);
    expect(opened.handoff.sources).toContain(frozen.version.versionId);

    const tasks = decomposeMilestone({
      milestoneId: "fixture:milestone/1",
      scopeLines: [
        { id: "s1", text: "One source of numbers in place" },
        { id: "s2", text: "Pack produced from the template" },
      ],
      dependsOn: { s2: ["s1"] },
    });
    expect(tasks.length).toBe(2);

    const acceptedTasks = tasks.map((task) => {
      const result = acceptTask({
        task,
        ownerId: DOER,
        dueDate: "2026-03-04T00:00:00.000Z",
        leadId: LEAD,
        availability: AVAILABILITY,
      });
      if (!result.accepted) throw new Error(result.because);
      return { ...result.task, state: "complete" as const };
    });

    const milestone: MilestoneRecord = {
      milestoneId: "fixture:milestone/1",
      clientRef: CLIENT,
      state: "in_progress",
      evidence: [{ ref: "fixture:evidence/pack", label: "March pack (synthetic)", recordedAt: AT }],
      testResults: acceptedTasks.flatMap((task) =>
        task.tests.map((test) => ({
          testId: test.id,
          passed: true,
          recordedBy: DOER,
          recordedAt: AT,
          note: "Checked",
        })),
      ),
    };

    const reading = milestoneReading({ milestone, tasks: acceptedTasks });
    expect(reading.tasksComplete).toBe(true);
    expect(reading.readyForAcceptance).toBe(true);
    expect(reading.accepted).toBe(false);

    const decided = decideMilestone({
      milestone,
      tasks: acceptedTasks,
      outcome: "accepted",
      by: LEAD,
      at: AT,
      note: "Board saw it and agreed.",
    });
    if (!decided.decided) throw new Error(decided.because);

    const ops = recordOpsHandoff({ milestone: decided.milestone, by: LEAD, at: AT });
    if (!ops.recorded) throw new Error(ops.because);
    expect(ops.alreadyRecorded).toBe(false);

    const care = openCarePlan({
      organizationId: ORG,
      clientRef: CLIENT,
      milestoneId: "fixture:milestone/1",
      milestoneAccepted: true,
      by: LEAD,
      at: AT,
    });
    if (!care.created) throw new Error(care.because);
    expect(care.plan.health).toBe("unknown");

    const review = reviewOutcome({
      clientRef: CLIENT,
      baseline: { key: "reporting_days", label: "Days to produce the pack", value: 6, unit: "days", tier: "observed" },
      target: { key: "reporting_days", label: "Target days", value: 2, unit: "days", tier: "decided" },
      observed: { key: "reporting_days", label: "Days now", value: 2, unit: "days", tier: "observed" },
    });
    expect(review.targetReached).toBe(true);
    expect(review.clientRef).toBe(CLIENT);
  });
});

describe("A10.2 repeats, refusals and changes", () => {
  it("a repeated roadmap handoff returns the first one", () => {
    const record = discovery();
    const first = roadmapHandoffFor({ record, by: { userId: LEAD }, at: AT });
    if (!first.opened) throw new Error(first.because);
    const again = roadmapHandoffFor({
      record,
      by: { userId: LEAD },
      at: AT,
      existingKeys: [first.opening.key],
    });
    expect(again.opened).toBe(false);
  });

  it("a repeated project opening and ops handoff write once", () => {
    const state = fullChecklist();
    const readiness = onboardingReadiness(state);
    const first = openProjectsWorkspace({ state, readiness, by: LEAD, at: AT, sources: ["fixture:roadmap/v1"] });
    if (!first.opened) throw new Error(first.because.join(" "));
    const second = openProjectsWorkspace({
      state,
      readiness,
      by: LEAD,
      at: AT,
      sources: ["fixture:roadmap/v1"],
      existing: [first.handoff],
    });
    if (!second.opened) throw new Error(second.because.join(" "));
    expect(second.alreadyOpen).toBe(true);
    expect(second.handoff.key).toBe(first.handoff.key);

    const accepted: MilestoneRecord = {
      milestoneId: "fixture:milestone/1",
      clientRef: CLIENT,
      state: "accepted",
      evidence: [{ ref: "fixture:evidence/pack", label: "March pack", recordedAt: AT }],
      testResults: [],
      decidedBy: LEAD,
      decidedAt: AT,
    };
    const one = recordOpsHandoff({ milestone: accepted, by: LEAD, at: AT });
    if (!one.recorded) throw new Error(one.because);
    const two = recordOpsHandoff({ milestone: accepted, by: LEAD, at: AT, existing: [one.handoff] });
    if (!two.recorded) throw new Error(two.because);
    expect(two.alreadyRecorded).toBe(true);
  });

  it("a failed read of the money stays unavailable, never paid and never quietly unpaid", () => {
    const view = paymentView({
      record: { clientRef: CLIENT, stage: "invoiced", evidence: null, changedBy: LEAD, changedAt: AT },
      externalRead: { ok: false, because: "The ledger could not be read.", readAt: AT },
    });
    expect(view.stage).toBe("unknown");
    expect(view.label).toBe("Payment status unavailable");
  });

  it("preparation cannot move an agreement or the money", () => {
    const agreement = setAgreementStage({
      record: { clientRef: CLIENT, stage: "proposed", evidence: null, changedBy: null, changedAt: null },
      stage: "client_accepted",
      actorKind: "preparation",
      by: "preparation",
      at: AT,
    });
    expect(agreement.changed).toBe(false);

    const payment = setPaymentStage({
      record: { clientRef: CLIENT, stage: "unpaid", evidence: null, changedBy: null, changedAt: null },
      stage: "paid",
      actorKind: "preparation",
      by: "preparation",
      at: AT,
    });
    expect(payment.changed).toBe(false);
  });

  it("a date cannot be committed against a person with no recorded availability", () => {
    const [task] = decomposeMilestone({
      milestoneId: "fixture:milestone/2",
      scopeLines: [{ id: "s1", text: "Second pack" }],
    });
    const result = acceptTask({
      task: task!,
      ownerId: "fixture-person-unknown",
      dueDate: "2026-03-04T00:00:00.000Z",
      leadId: LEAD,
      availability: AVAILABILITY,
    });
    expect(result.accepted).toBe(false);
  });

  it("a scope change withdraws review readiness and keeps what a person wrote", () => {
    const destination = approveDestination({ roadmap: roadmap(), by: LEAD, at: AT });
    if (!destination.approved) throw new Error(destination.because);
    const ordered = approvePriorities({ roadmap: destination.roadmap, order: ["p1", "p2"], by: LEAD });
    if (!ordered.approved) throw new Error(ordered.because);
    const first = freezeRoadmapVersion({ roadmap: ordered.roadmap, by: LEAD, at: AT });
    if (!first.frozen) throw new Error(first.because);

    const proposal = deriveProposal({ version: first.version, estimates: ESTIMATES, at: AT });

    const changedRoadmap: PreparedRoadmap = {
      ...ordered.roadmap,
      phases: ordered.roadmap.phases.map((phase) =>
        phase.id === "p2" ? { ...phase, title: "Repeatable pack and a board summary" } : phase,
      ),
    };
    const next = freezeRoadmapVersion({
      roadmap: changedRoadmap,
      by: LEAD,
      at: "2026-03-05T09:00:00.000Z",
      existing: [first.version],
    });
    if (!next.frozen) throw new Error(next.because);
    expect(next.version.versionId).not.toBe(first.version.versionId);
    // The frozen version already written is untouched.
    expect(first.version.stamp).not.toBe(next.version.stamp);

    const result = rederiveAgainst({
      proposal,
      previousVersion: first.version,
      nextVersion: next.version,
      estimates: ESTIMATES,
      at: "2026-03-05T09:00:00.000Z",
      changes: roadmapChanges(first.version, next.version),
    });
    expect(result.changes.length).toBeGreaterThan(0);
    expect(result.reviewReadinessWithdrawn).toBe(true);
  });

  it("a care plan is never opened before the milestone is accepted", () => {
    const refused = openCarePlan({
      organizationId: ORG,
      clientRef: CLIENT,
      milestoneId: "fixture:milestone/3",
      milestoneAccepted: false,
      by: LEAD,
      at: AT,
    });
    expect(refused.created).toBe(false);
  });

  it("a missing figure in the review is unknown, not nought", () => {
    const review = reviewOutcome({
      clientRef: CLIENT,
      baseline: { key: "reporting_days", label: "Days before", value: null, unit: "days", tier: "observed" },
      target: { key: "reporting_days", label: "Target days", value: 2, unit: "days", tier: "decided" },
      observed: { key: "reporting_days", label: "Days now", value: 2, unit: "days", tier: "observed" },
    });
    expect(review.movement).toBeNull();
    expect(review.notes.join(" ")).toContain("not recorded");
  });
});
