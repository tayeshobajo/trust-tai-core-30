import { describe, expect, it } from "vitest";

import { emptySnapshot } from "./derive";
import { DAILY_CADENCE_MS, shouldRun, snapshotFingerprint } from "./engine/runs";
import { learningTrail, learningSummary } from "./engine/audit";
import type { MemoryBelief } from "@/domain/steward-memory";

const ORG = "org-1";

function belief(partial: Partial<MemoryBelief> & { id: string }): MemoryBelief {
  return {
    organizationId: ORG,
    subjectLabel: "Comms follow-through",
    statement: "Chase the three replies that never came back.",
    tier: "decided",
    authority: "human",
    recordedBy: "Ari",
    recordedAt: "2026-01-05T10:00:00.000Z",
    meta: {
      kind: "responsibility",
      facet: "other",
      patternKey: "engine:comms_silence",
      outcome: "confirmed",
    },
    ...partial,
  } as MemoryBelief;
}

describe("snapshotFingerprint", () => {
  it("is stable for an unchanged suite", () => {
    const snapshot = emptySnapshot(ORG);
    expect(snapshotFingerprint(snapshot)).toBe(snapshotFingerprint(emptySnapshot(ORG)));
  });

  it("changes when new memory arrives", () => {
    const before = emptySnapshot(ORG);
    const after = { ...emptySnapshot(ORG), memory: [belief({ id: "b1" })] };
    expect(snapshotFingerprint(after)).not.toBe(snapshotFingerprint(before));
  });
});

describe("shouldRun", () => {
  const now = "2026-01-06T09:00:00.000Z";

  it("runs the first time", () => {
    expect(shouldRun({ fingerprint: "a", now })).toEqual({ run: true, reason: "first_run" });
  });

  it("runs when the suite moved", () => {
    const last = { fingerprint: "a", at: now };
    expect(shouldRun({ last, fingerprint: "b", now }).reason).toBe("new_activity");
  });

  it("holds the read when nothing moved", () => {
    const last = { fingerprint: "a", at: now };
    expect(shouldRun({ last, fingerprint: "a", now })).toEqual({
      run: false,
      reason: "up_to_date",
    });
  });

  it("runs once a day even in silence", () => {
    const last = { fingerprint: "a", at: "2026-01-05T08:00:00.000Z" };
    const decision = shouldRun({ last, fingerprint: "a", now, cadenceMs: DAILY_CADENCE_MS });
    expect(decision).toEqual({ run: true, reason: "daily_cadence" });
  });

  it("always runs when a person asks", () => {
    const last = { fingerprint: "a", at: now };
    expect(shouldRun({ last, fingerprint: "a", now, requested: true }).reason).toBe("requested");
  });
});

describe("learningTrail", () => {
  it("is honest when nothing has been decided", () => {
    const trail = learningTrail([]);
    expect(trail.entries).toHaveLength(0);
    expect(learningSummary(trail)).toContain("learned nothing");
  });

  it("ignores beliefs that did not come from an engine decision", () => {
    const trail = learningTrail([
      belief({
        id: "x",
        meta: {
          kind: "responsibility",
          facet: "other",
          patternKey: "steward:role",
          outcome: "confirmed",
        },
      }),
    ]);
    expect(trail.entries).toHaveLength(0);
  });

  it("suppresses a shape only after the threshold of dismissals", () => {
    const dismissal = (id: string, at: string) =>
      belief({
        id,
        recordedAt: at,
        meta: {
          kind: "responsibility",
          facet: "other",
          patternKey: "engine:comms_silence",
          outcome: "dismissed_as_context",
        },
      });

    const once = learningTrail([dismissal("d1", "2026-01-01T00:00:00.000Z")]);
    expect(once.suppressed).toHaveLength(0);
    expect(once.entries[0]?.effect).toBe("counting_towards_suppression");

    const twice = learningTrail([
      dismissal("d1", "2026-01-01T00:00:00.000Z"),
      dismissal("d2", "2026-01-02T00:00:00.000Z"),
    ]);
    expect(twice.suppressed).toHaveLength(1);
    expect(twice.entries.every((entry) => entry.effect === "suppressed")).toBe(true);
  });

  it("records an edit as adopted wording", () => {
    const trail = learningTrail([
      belief({
        id: "e1",
        statement: "Reply to Nadia before Friday.",
        meta: {
          kind: "responsibility",
          facet: "other",
          patternKey: "engine:comms_silence",
          outcome: "edited_then_confirmed",
        },
      }),
    ]);
    expect(trail.adopted[0]?.statement).toBe("Reply to Nadia before Friday.");
    expect(trail.entries[0]?.effect).toBe("wording_adopted");
  });

  it("orders newest first and counts acceptances as ordering only", () => {
    const trail = learningTrail([
      belief({ id: "a1", recordedAt: "2026-01-01T00:00:00.000Z" }),
      belief({ id: "a2", recordedAt: "2026-01-04T00:00:00.000Z" }),
    ]);
    expect(trail.entries.map((entry) => entry.id)).toEqual(["a2", "a1"]);
    expect(trail.favoured[0]?.acceptances).toBe(2);
  });
});
