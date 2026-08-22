/**
 * Suite-wide intelligence acceptance tests.
 *
 * Behavioral invariants every room must hold, however it adopts the runtime.
 * These are the guardrails that keep the suite's reasoning at one depth:
 * no isolated AI brains, no unverifiable completion, no overclaimed
 * confidence, no reasoning without grounding.
 */

import { describe, expect, it } from "vitest";

import { APP_REGISTRY } from "@/domain/registry";
import {
  capConfidence,
  delegationIsValid,
  emptyRuntimeRead,
  REQUIRED_ASPECTS,
  runtimeConfidence,
} from "@/domain/intelligence-runtime";
import { roomCapabilities } from "@/domain/intelligence-capabilities";

import {
  checkRoomReadiness,
  manifestFor,
  READINESS_MANIFESTS,
  roomsMissingManifests,
} from "./manifest";
import { verifyCompletion } from "./verification";
import { nextProtocolStep } from "./protocol";

describe("readiness manifest coverage", () => {
  it("every registered suite room has a manifest", () => {
    expect(roomsMissingManifests()).toEqual([]);
    expect(READINESS_MANIFESTS.map((entry) => entry.room).sort()).toEqual(
      APP_REGISTRY.map((app) => app.id).sort(),
    );
  });

  it("every active room accounts for all eight readiness dimensions", () => {
    /** Rooms honestly NOT READY, with their gaps asserted in a dedicated test. */
    const EXPECTED_NOT_READY = ["ops"];
    for (const app of APP_REGISTRY) {
      if (app.layer === "core") continue;
      if (EXPECTED_NOT_READY.includes(app.id)) continue;
      const check = checkRoomReadiness(app.id);
      expect(check, `room ${app.id} has no manifest`).not.toBeNull();
      expect(
        check!.missing,
        `room ${app.id} is missing required dimensions: ${check!.missing.join(", ")}`,
      ).toEqual([]);
    }
  });

  it("every delegation names its architectural equivalent and why", () => {
    for (const manifest of READINESS_MANIFESTS) {
      for (const [aspect, report] of Object.entries(manifest.aspects)) {
        if (report.state !== "delegated") continue;
        expect(
          delegationIsValid(report),
          `room ${manifest.room} delegates ${aspect} without naming the equivalent and the reason`,
        ).toBe(true);
      }
    }
  });

  it("Ops is honestly NOT READY — the reference failure mode is not repeated", () => {
    const check = checkRoomReadiness("ops");
    expect(check).not.toBeNull();
    expect(check!.ready, "Ops must not read as ready while its gaps exist").toBe(false);
    expect(check!.missing).toEqual(
      expect.arrayContaining([
        "retrieval",
        "domain_patterns",
        "safe_diagnostic_loop",
        "verification",
        "outcome_learning",
      ]),
    );
  });

  it("every manifest aspect cites where it is backed", () => {
    for (const manifest of READINESS_MANIFESTS) {
      for (const aspect of Object.values(manifest.aspects)) {
        expect(aspect.evidence.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("every room answers the capability question", () => {
    for (const app of APP_REGISTRY) {
      const answer = roomCapabilities(app.id);
      expect(answer.exists, `room ${app.id} is not in the registry`).toBe(true);
      expect(manifestFor(app.id)?.aspects.capability_awareness.state).not.toBe("not_ready");
    }
  });
});

describe("confidence invariants", () => {
  it("confidence never outruns evidence", () => {
    expect(runtimeConfidence(0)).toBe("unknown");
    expect(runtimeConfidence(1)).toBe("low");
    expect(runtimeConfidence(2)).toBe("moderate");
    expect(runtimeConfidence(3)).toBe("high");
  });

  it("a high claim on thin evidence is capped down", () => {
    expect(capConfidence("high", 1)).toBe("low");
    expect(capConfidence("high", 2)).toBe("moderate");
    expect(capConfidence("low", 5)).toBe("low");
  });
});

describe("completion invariants", () => {
  it("no room may accept 'the action ran' as completion", () => {
    for (const app of APP_REGISTRY) {
      const verdict = verifyCompletion({
        room: app.id,
        workRef: "work:1",
        claimedBy: "runtime",
        actionRan: true,
        evidence: [],
      });
      expect(verdict.accepted, `room ${app.id} accepted a bare action claim`).toBe(false);
    }
  });
});

describe("protocol invariants", () => {
  it("a failed attempt always produces a bounded next step or a named escalation", () => {
    for (const app of APP_REGISTRY) {
      const next = nextProtocolStep(
        [{ stage: "test_safely", action: `attempt in ${app.id}`, outcome: "failed" }],
        {
          objective: "suite invariant probe",
          unknowns: [],
          inspectionsAvailable: [],
          safeTests: [],
        },
      );
      expect(["step", "verify", "escalate"]).toContain(next.kind);
      if (next.kind === "escalate") {
        expect(next.because.length).toBeGreaterThan(0);
        expect(next.blockedOn.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("silence invariants", () => {
  it("an empty read is honest: unknown confidence, no invented content", () => {
    const read = emptyRuntimeRead({
      room: "pulse",
      objective: "probe",
      unknowns: ["nothing supplied"],
      now: "2026-08-22T10:00:00.000Z",
    });
    expect(read.confidence).toBe("unknown");
    expect(read.facts).toEqual([]);
    expect(read.interpretations).toEqual([]);
    expect(read.unknowns).toEqual(["nothing supplied"]);
  });
});

describe("required aspects are the real floor", () => {
  it("the floor is all eight dimensions, not a convenient subset", () => {
    expect(REQUIRED_ASPECTS).toEqual([
      "evidence_grounding",
      "retrieval",
      "domain_patterns",
      "capability_awareness",
      "safe_diagnostic_loop",
      "verification",
      "approval_boundary",
      "outcome_learning",
    ]);
  });
});
