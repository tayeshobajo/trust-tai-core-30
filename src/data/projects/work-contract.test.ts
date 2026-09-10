/**
 * Work Contract invariants: no contract without acceptance criteria, no
 * execution without human approval, and completion semantics that never
 * confuse "the action ran" with "done".
 */

import { describe, expect, it } from "vitest";

import { classifyExecution, executionStateAtLeast } from "@/domain/work-contract";

import { approveWorkContract, draftWorkContract, paperclipPacketFor } from "./work-contract";

const NOW = "2026-08-22T10:00:00.000Z";

function draft() {
  return draftWorkContract({
    organizationId: "org",
    projectId: "p1",
    objective: "Rebuild the intake confirmation flow",
    outcomeStatement: "A confirmed submission receives a receipt within one minute",
    sourceRefs: [{ kind: "context_packet", id: "packet:p1", label: "Project packet" }],
    acceptanceCriteria: [
      {
        id: "ac1",
        statement: "Receipt email recorded in Comms",
        evidenceKind: "downstream_receipt",
      },
    ],
    mustNotChange: ["The public submission form"],
    now: NOW,
  });
}

describe("work contract drafting", () => {
  it("refuses a contract with no acceptance criteria", () => {
    expect(
      draftWorkContract({
        organizationId: "org",
        projectId: "p1",
        objective: "Do the thing",
        outcomeStatement: "It is done",
        sourceRefs: [],
        acceptanceCriteria: [],
        now: NOW,
      }),
    ).toBeNull();
  });

  it("refuses a contract with no objective", () => {
    expect(
      draftWorkContract({
        organizationId: "org",
        projectId: "p1",
        objective: "  ",
        outcomeStatement: "It is done",
        sourceRefs: [],
        acceptanceCriteria: [{ id: "ac1", statement: "Proof exists", evidenceKind: "test_result" }],
        now: NOW,
      }),
    ).toBeNull();
  });

  it("a contract is not executable until a person approves it", () => {
    const contract = draft()!;
    expect("humanApproval" in contract).toBe(false);
    const approved = approveWorkContract(contract, { approvedBy: "tai", approvedAt: NOW });
    expect(approved?.humanApproval.approvedBy).toBe("tai");
    expect(approveWorkContract(contract, { approvedBy: " ", approvedAt: NOW })).toBeNull();
  });

  it("sequencing is owned by Roadmap", () => {
    expect(draft()!.sequencing.owningRoom).toBe("roadmap");
  });
});

describe("execution semantics", () => {
  it("attempted != executed != verified != human accepted", () => {
    expect(
      classifyExecution({ actionRan: false, verificationPassed: false, humanAccepted: false }),
    ).toBe("not_attempted");
    expect(
      classifyExecution({ actionRan: true, verificationPassed: false, humanAccepted: false }),
    ).toBe("executed");
    expect(
      classifyExecution({ actionRan: true, verificationPassed: true, humanAccepted: false }),
    ).toBe("verified");
    expect(
      classifyExecution({ actionRan: true, verificationPassed: true, humanAccepted: true }),
    ).toBe("human_accepted");
    expect(executionStateAtLeast("executed", "verified")).toBe(false);
    expect(executionStateAtLeast("human_accepted", "verified")).toBe(true);
  });
});

describe("the Paperclip assignment packet", () => {
  it("carries references, never raw transcripts", () => {
    const approved = approveWorkContract(draft()!, { approvedBy: "tai", approvedAt: NOW })!;
    const packet = paperclipPacketFor(approved, {
      knowledge: [{ kind: "canon_pattern", id: "pat:1", label: "Stalled delivery" }],
      priorCases: [],
      availableTools: ["repo.read", "tests.run"],
      environment: "paperclip",
    });
    expect(packet.diagnosticLoop[0]).toBe("inspect");
    expect(packet.diagnosticLoop[packet.diagnosticLoop.length - 1]).toBe("escalate");
    expect(packet.escalationConditions.length).toBeGreaterThan(0);
    expect(packet.evidenceRequired).toHaveLength(1);
    expect(packet.mustNotChange).toEqual(["The public submission form"]);
    expect(JSON.stringify(packet)).not.toContain("transcript:");
  });
});
