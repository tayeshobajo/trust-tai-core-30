import { describe, expect, it } from "vitest";
import {
  acceptTask,
  capacityRead,
  decideMilestone,
  decomposeMilestone,
  milestoneReading,
  recordOpsHandoff,
  recordRisk,
  scopeChangeImpact,
  type AvailabilityRecord,
  type DeliveryTask,
  type MilestoneRecord,
} from "./milestone-delivery";

const MILESTONE = "fixture-milestone-1";
const CLIENT = "fixture-client-northwind";
const LEAD = "fixture-person-lead";
const DOER = "fixture-person-doer";

const scopeLines = [
  { id: "s1", text: "Reporting pack rebuilt" },
  { id: "s2", text: "Data checks documented" },
];

const availability: AvailabilityRecord[] = [
  {
    personId: DOER,
    weekStart: "2026-03-02T00:00:00.000Z",
    availableDays: 3,
    recordedBy: LEAD,
  },
];

function complete(task: DeliveryTask): DeliveryTask {
  return { ...task, state: "complete" };
}

describe("decomposing a milestone", () => {
  it("proposes tasks with checks and dependencies, owning nothing", () => {
    const tasks = decomposeMilestone({
      milestoneId: MILESTONE,
      scopeLines,
      dependsOn: { s2: ["s1"] },
    });
    expect(tasks).toHaveLength(2);
    expect(tasks.every((task) => task.state === "proposed")).toBe(true);
    expect(tasks.every((task) => task.ownerId === undefined && task.dueDate === undefined)).toBe(true);
    expect(tasks[0]!.tests).toHaveLength(1);
    expect(tasks[1]!.dependsOn).toEqual([`${MILESTONE}::task::s1`]);
    expect(tasks[0]!.fromScopeLine).toBe("s1");
  });
});

describe("accepting work", () => {
  const [task] = decomposeMilestone({ milestoneId: MILESTONE, scopeLines });

  it("refuses a date with no recorded availability rather than guessing", () => {
    const result = acceptTask({
      task: task!,
      ownerId: DOER,
      dueDate: "2026-04-06T00:00:00.000Z",
      leadId: LEAD,
      availability,
    });
    expect(result.accepted).toBe(false);
    if (!result.accepted) expect(result.because).toContain("no recorded availability");
  });

  it("refuses an unnamed lead", () => {
    const result = acceptTask({
      task: task!,
      ownerId: DOER,
      dueDate: "2026-03-04T00:00:00.000Z",
      leadId: "  ",
      availability,
    });
    expect(result.accepted).toBe(false);
  });

  it("records the lead, the owner and the date when availability exists", () => {
    const result = acceptTask({
      task: task!,
      ownerId: DOER,
      dueDate: "2026-03-04T00:00:00.000Z",
      leadId: LEAD,
      availability,
    });
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.task.acceptedBy).toBe(LEAD);
      expect(result.task.ownerId).toBe(DOER);
      expect(result.task.state).toBe("accepted");
    }
  });
});

describe("capacity", () => {
  it("shows over-allocation before dates are committed", () => {
    const tasks = decomposeMilestone({ milestoneId: MILESTONE, scopeLines }).map((task) => ({
      ...task,
      ownerId: DOER,
      dueDate: "2026-03-04T00:00:00.000Z",
      estimatedDays: 2,
    }));
    const read = capacityRead({ tasks, availability });
    expect(read.conflicts).toHaveLength(1);
    expect(read.conflicts[0]).toContain("4 days");
    expect(read.partial).toHaveLength(0);
  });

  it("labels a reading as partial when availability is missing", () => {
    const tasks = decomposeMilestone({ milestoneId: MILESTONE, scopeLines }).map((task) => ({
      ...task,
      ownerId: "fixture-person-other",
      dueDate: "2026-03-04T00:00:00.000Z",
      estimatedDays: 2,
    }));
    const read = capacityRead({ tasks, availability });
    expect(read.partial[0]).toContain("partial reading");
    expect(read.lines[0]!.overAllocatedBy).toBeNull();
  });
});

describe("acceptance", () => {
  const tasks = decomposeMilestone({ milestoneId: MILESTONE, scopeLines }).map(complete);
  const base: MilestoneRecord = {
    milestoneId: MILESTONE,
    clientRef: CLIENT,
    state: "in_progress",
    evidence: [{ ref: "fixture-evidence-1", label: "Reporting pack", recordedAt: "2026-03-05T00:00:00.000Z" }],
    testResults: tasks.flatMap((task) =>
      task.tests.map((test) => ({
        testId: test.id,
        passed: true,
        recordedBy: DOER,
        recordedAt: "2026-03-05T00:00:00.000Z",
        note: "Checked",
      })),
    ),
  };

  it("keeps finished tasks, acceptance and the client outcome apart", () => {
    const reading = milestoneReading({ milestone: base, tasks });
    expect(reading.tasksComplete).toBe(true);
    expect(reading.readyForAcceptance).toBe(true);
    expect(reading.accepted).toBe(false);
    expect(reading.clientOutcomeConfirmed).toBe(false);
  });

  it("refuses acceptance while a check has not passed", () => {
    const failing: MilestoneRecord = {
      ...base,
      testResults: base.testResults.map((result, index) =>
        index === 0 ? { ...result, passed: false } : result,
      ),
    };
    const decision = decideMilestone({
      milestone: failing,
      tasks,
      outcome: "accepted",
      by: LEAD,
      at: "2026-03-06T00:00:00.000Z",
      note: "",
    });
    expect(decision.decided).toBe(false);
    if (!decision.decided) expect(decision.because).toContain("did not pass");
  });

  it("refuses acceptance with no evidence recorded", () => {
    const decision = decideMilestone({
      milestone: { ...base, evidence: [] },
      tasks,
      outcome: "accepted",
      by: LEAD,
      at: "2026-03-06T00:00:00.000Z",
      note: "",
    });
    expect(decision.decided).toBe(false);
    if (!decision.decided) expect(decision.because).toContain("No evidence");
  });

  it("records who accepted it and when", () => {
    const decision = decideMilestone({
      milestone: base,
      tasks,
      outcome: "accepted",
      by: LEAD,
      at: "2026-03-06T00:00:00.000Z",
      note: "Looks right",
    });
    expect(decision.decided).toBe(true);
    if (decision.decided) {
      expect(decision.milestone.state).toBe("accepted");
      expect(decision.milestone.decidedBy).toBe(LEAD);
      expect(decision.milestone.decidedAt).toBe("2026-03-06T00:00:00.000Z");
    }
  });

  it("refuses a decision with nobody's name on it", () => {
    const decision = decideMilestone({
      milestone: base,
      tasks,
      outcome: "rejected",
      by: "",
      at: "2026-03-06T00:00:00.000Z",
      note: "",
    });
    expect(decision.decided).toBe(false);
  });
});

describe("scope changes", () => {
  it("routes to a commercial decision and leaves the commitment alone", () => {
    const impact = scopeChangeImpact({
      id: "fixture-change-1",
      milestoneId: MILESTONE,
      clientRef: CLIENT,
      description: "Add a second reporting view",
      extraDays: 3,
      extraCostMinor: 150_000,
      raisedBy: LEAD,
      raisedAt: "2026-03-07T00:00:00.000Z",
    });
    expect(impact.routedToCommercialDecision).toBe(true);
    expect(impact.handoffKey).toBe("fixture-change-1::commercial");
    expect(impact.timeImpact).toContain("3 day");
    expect(impact.commitmentsUnchanged).toContain("stay as they are");
  });

  it("says unknown rather than nought when nothing has been estimated", () => {
    const impact = scopeChangeImpact({
      id: "fixture-change-2",
      milestoneId: MILESTONE,
      clientRef: CLIENT,
      description: "Unclear ask",
      extraDays: null,
      extraCostMinor: null,
      raisedBy: LEAD,
      raisedAt: "2026-03-07T00:00:00.000Z",
    });
    expect(impact.timeImpact).toContain("not estimated");
    expect(impact.costImpact).toContain("not worked out");
  });
});

describe("Ops handoff and risks", () => {
  const accepted: MilestoneRecord = {
    milestoneId: MILESTONE,
    clientRef: CLIENT,
    state: "accepted",
    evidence: [{ ref: "fixture-evidence-1", label: "Reporting pack", recordedAt: "2026-03-05T00:00:00.000Z" }],
    testResults: [],
    decidedBy: LEAD,
    decidedAt: "2026-03-06T00:00:00.000Z",
  };

  it("records the handoff once and returns the first one on a retry", () => {
    const first = recordOpsHandoff({ milestone: accepted, by: LEAD, at: "2026-03-06T01:00:00.000Z" });
    expect(first.recorded).toBe(true);
    if (!first.recorded) return;
    const again = recordOpsHandoff({
      milestone: accepted,
      by: LEAD,
      at: "2026-03-06T02:00:00.000Z",
      existing: [first.handoff],
    });
    expect(again.recorded).toBe(true);
    if (again.recorded) {
      expect(again.alreadyRecorded).toBe(true);
      expect(again.handoff.recordedAt).toBe("2026-03-06T01:00:00.000Z");
    }
  });

  it("refuses a handoff before acceptance", () => {
    const result = recordOpsHandoff({
      milestone: { ...accepted, state: "in_progress" },
      by: LEAD,
      at: "2026-03-06T01:00:00.000Z",
    });
    expect(result.recorded).toBe(false);
  });

  it("refuses a risk with no reason, owner or next action", () => {
    expect(
      recordRisk({ id: "r1", what: "Late data", because: "", ownerId: LEAD, nextAction: "Chase" }).ok,
    ).toBe(false);
    expect(
      recordRisk({ id: "r1", what: "Late data", because: "Source is late", ownerId: "", nextAction: "Chase" }).ok,
    ).toBe(false);
    expect(
      recordRisk({ id: "r1", what: "Late data", because: "Source is late", ownerId: LEAD, nextAction: "" }).ok,
    ).toBe(false);
    expect(
      recordRisk({
        id: "r1",
        what: "Late data",
        because: "Source is late",
        ownerId: LEAD,
        nextAction: "Chase the source on Monday",
      }).ok,
    ).toBe(true);
  });
});
