import { describe, expect, it } from "vitest";

import type { ReasoningRequest } from "@/domain/intelligence-runtime";
import { emptyRuntimeRead } from "@/domain/intelligence-runtime";

import { composeRetrieval } from "./retrieval";
import {
  assembleDeterministicRead,
  verifyRuntimeRead,
  type RawRuntimeRead,
} from "./reason";

const NOW = "2026-08-22T10:00:00.000Z";

function request(overrides: Partial<ReasoningRequest> = {}): ReasoningRequest {
  return {
    room: "projects",
    objective: "What must an operator know before this milestone is executable?",
    organizationId: "org-1",
    evidence: [
      {
        id: "ev:1",
        statement: "The Website Growth Sprint milestone is blocked on final copy.",
        owningRoom: "projects",
        tier: "observed",
      },
      {
        id: "ev:2",
        statement: "The launch date moved to 2026-09-15.",
        owningRoom: "projects",
        tier: "decided",
      },
    ],
    allowedOperations: ["projects.route_work", "projects.record_blocker"],
    output: "operator_read",
    approval: { required: true },
    verification: {
      kind: "acceptance_criterion",
      description: "Each acceptance criterion is checked and recorded.",
    },
    now: NOW,
    ...overrides,
  };
}

function bundleFor(req: ReasoningRequest, decided: string[] = []) {
  return composeRetrieval({
    organizationId: req.organizationId,
    room: req.room,
    now: req.now,
    evidence: req.evidence,
    decided,
  });
}

describe("verifyRuntimeRead", () => {
  it("keeps facts that cite real evidence refs", () => {
    const req = request();
    const { read, rejected } = verifyRuntimeRead({
      raw: {
        facts: [{ statement: "The milestone is blocked on final copy.", evidenceRefs: ["ev:1"] }],
      } satisfies RawRuntimeRead,
      request: req,
      bundle: bundleFor(req),
    });
    expect(read.facts).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it("drops facts that cite nothing real", () => {
    const req = request();
    const { read, rejected } = verifyRuntimeRead({
      raw: {
        facts: [
          { statement: "The client is unhappy.", evidenceRefs: ["ev:99"] },
          { statement: "No refs at all." },
        ],
      } satisfies RawRuntimeRead,
      request: req,
      bundle: bundleFor(req),
    });
    expect(read.facts).toHaveLength(0);
    expect(rejected).toHaveLength(2);
    expect(rejected[0]!.because).toContain("not grounded");
  });

  it("drops facts that invent numbers absent from the cited evidence", () => {
    const req = request();
    const { read, rejected } = verifyRuntimeRead({
      raw: {
        facts: [
          {
            statement: "Delivery confidence has fallen 40% this month.",
            evidenceRefs: ["ev:1"],
          },
          {
            statement: "The launch date moved to 2026-09-15.",
            evidenceRefs: ["ev:2"],
          },
        ],
      } satisfies RawRuntimeRead,
      request: req,
      bundle: bundleFor(req),
    });
    expect(read.facts.map((fact) => fact.statement)).toEqual([
      "The launch date moved to 2026-09-15.",
    ]);
    expect(rejected[0]!.because).toContain("number");
  });

  it("rejects interpretations that contradict a person's decision", () => {
    const req = request();
    const decided = ["We will not launch before the copy is final."];
    const { read, rejected } = verifyRuntimeRead({
      raw: {
        interpretations: [
          {
            claim: "We will launch before the copy is final.",
            because: "the blocker looks minor",
            restsOn: ["ev:1"],
          },
          {
            claim: "The launch is likely to slip.",
            because: "the milestone is blocked",
            restsOn: ["ev:1"],
          },
        ],
      } satisfies RawRuntimeRead,
      request: req,
      bundle: bundleFor(req, decided),
    });
    expect(rejected.some((row) => row.because.includes("decision"))).toBe(true);
    expect(read.interpretations.map((row) => row.claim)).toEqual([
      "The launch is likely to slip.",
    ]);
  });

  it("rejects interpretations that rest on nothing in the packet", () => {
    const req = request();
    const { read, rejected } = verifyRuntimeRead({
      raw: {
        interpretations: [
          { claim: "The team is overstretched.", because: "gut feel", restsOn: ["ev:42"] },
        ],
      } satisfies RawRuntimeRead,
      request: req,
      bundle: bundleFor(req),
    });
    expect(read.interpretations).toHaveLength(0);
    expect(rejected[0]!.because).toContain("cited evidence");
  });

  it("rejects next steps outside the allowed operations", () => {
    const req = request();
    const { read, rejected } = verifyRuntimeRead({
      raw: {
        nextSteps: [
          { title: "Email the client directly", owningRoom: "comms", operation: "comms.send" },
        ],
      } satisfies RawRuntimeRead,
      request: req,
      bundle: bundleFor(req),
    });
    expect(read.nextSteps).toHaveLength(0);
    expect(rejected[0]!.because).toContain("allowed operations");
  });

  it("forces the approval boundary onto every next step when required", () => {
    const req = request();
    const { read } = verifyRuntimeRead({
      raw: {
        nextSteps: [
          {
            title: "Route the copy work",
            owningRoom: "projects",
            operation: "projects.route_work",
          },
        ],
      } satisfies RawRuntimeRead,
      request: req,
      bundle: bundleFor(req),
    });
    expect(read.nextSteps[0]!.requiresApproval).toBe(true);
  });

  it("caps confidence at what the evidence can carry", () => {
    const req = request();
    const { read } = verifyRuntimeRead({
      raw: { confidence: "high" } satisfies RawRuntimeRead,
      request: req,
      bundle: bundleFor(req),
    });
    /* Two evidence items can carry at most "moderate". */
    expect(read.confidence).toBe("moderate");
  });

  it("falls back to the request's verification expectation when the model omits one", () => {
    const req = request();
    const { read } = verifyRuntimeRead({
      raw: {
        nextSteps: [{ title: "Create the copy task", owningRoom: "projects" }],
      } satisfies RawRuntimeRead,
      request: req,
      bundle: bundleFor(req),
    });
    expect(read.verification[0]!.evidenceKind).toBe("acceptance_criterion");
  });
});

describe("assembleDeterministicRead", () => {
  it("turns evidence into facts with provenance and never invents", () => {
    const req = request();
    const read = assembleDeterministicRead(req, bundleFor(req));
    expect(read.reasonedByModel).toBe(false);
    expect(read.facts).toHaveLength(2);
    expect(read.facts[0]!.evidenceRefs).toEqual(["ev:1"]);
    expect(read.interpretations).toHaveLength(0);
    expect(read.confidence).toBe("moderate");
  });

  it("is honestly empty when there is no evidence", () => {
    const req = request({ evidence: [] });
    const read = assembleDeterministicRead(req, bundleFor(req));
    expect(read.facts).toHaveLength(0);
    expect(read.confidence).toBe("unknown");
    expect(read.unknowns[0]).toContain("No evidence");
  });
});

describe("emptyRuntimeRead", () => {
  it("names withheld rooms instead of guessing", () => {
    const read = emptyRuntimeRead({
      room: "pulse",
      objective: "What needs attention?",
      unknowns: [],
      withheld: [{ appId: "ops", reason: "not linked" }],
      now: NOW,
    });
    expect(read.provenance.withheld).toEqual([{ appId: "ops", reason: "not linked" }]);
    expect(read.confidence).toBe("unknown");
  });
});
