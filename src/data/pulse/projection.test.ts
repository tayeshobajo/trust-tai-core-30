import { describe, expect, it } from "vitest";

import type { Signal } from "@/domain/signals";
import { NOT_USEFUL_THRESHOLD, signalKindOf } from "@/domain/pulse";

import {
  countSignals,
  groupSignals,
  impactOf,
  recentlyUpdated,
  relativeAge,
  severityOf,
  topAreas,
  toPulseSignals,
  weeklyTrend,
} from "./projection";

const NOW = "2026-08-18T00:00:00.000Z";

function signal(overrides: Partial<Signal> & { id: string }): Signal {
  return {
    category: "delivery",
    title: "A signal",
    why: "Because something moved.",
    evidence: [],
    contextRefs: ["ctx"],
    confidence: "high",
    recommendedNextMove: "Do the thing.",
    destination: { appId: "projects", label: "Open Projects", route: "/modules/projects" },
    status: "new",
    urgency: 50,
    at: "2026-08-15T00:00:00.000Z",
    ...overrides,
  } as Signal;
}

describe("severity rules", () => {
  it("treats urgent execution as act now", () => {
    expect(severityOf(signal({ id: "a", urgency: 90 }))).toBe("act_now");
  });

  it("treats open judgment as evaluate", () => {
    expect(severityOf(signal({ id: "b", urgency: 70, category: "pipeline" }))).toBe("evaluate");
  });

  it("treats growth as information whatever its urgency", () => {
    expect(severityOf(signal({ id: "c", urgency: 95, category: "growth" }))).toBe("good_to_know");
  });

  it("watches signals that are still moving", () => {
    expect(severityOf(signal({ id: "d", urgency: 40, category: "relationship" }))).toBe(
      "watch_closely",
    );
  });

  it("scales impact from urgency", () => {
    expect(impactOf(signal({ id: "e", urgency: 85 }))).toBe("high");
    expect(impactOf(signal({ id: "f", urgency: 60 }))).toBe("medium");
    expect(impactOf(signal({ id: "g", urgency: 10 }))).toBe("low");
  });
});

describe("projection", () => {
  const signals = [
    signal({
      id: "comms:reply-debt:1",
      urgency: 95,
      category: "relationship",
      destination: { appId: "comms", label: "Open in Comms", route: "/modules/comms" },
    }),
    signal({
      id: "scout:fit:2",
      urgency: 40,
      category: "growth",
      destination: { appId: "scout", label: "Open Scout", route: "/modules/scout" },
    }),
    signal({
      id: "roadmap:decision:3",
      urgency: 70,
      category: "client_stewardship",
      destination: { appId: "roadmap", label: "Open Roadmap", route: "/modules/roadmap" },
    }),
  ];

  const projected = toPulseSignals({ organizationId: "org", now: NOW, signals });

  it("sorts act now first and information last", () => {
    expect(projected.map((s) => s.severity)).toEqual(["act_now", "evaluate", "good_to_know"]);
  });

  it("uses the owning room's own verb", () => {
    expect(projected[0]?.actionLabel).toBe("Reply");
    expect(projected[1]?.actionLabel).toBe("Decide");
  });

  it("explains every signal", () => {
    for (const item of projected) {
      expect(item.reason.length).toBeGreaterThan(0);
      expect(item.sourceAppLabel.length).toBeGreaterThan(0);
    }
  });

  it("counts and groups without losing a signal", () => {
    const counts = countSignals(projected);
    expect(counts.total).toBe(3);
    expect(counts.act_now + counts.evaluate + counts.watch_closely + counts.good_to_know).toBe(3);
    expect(groupSignals(projected).flatMap((g) => g.signals)).toHaveLength(3);
  });

  it("clusters by area", () => {
    expect(topAreas(projected).reduce((sum, a) => sum + a.count, 0)).toBe(3);
  });

  it("states the trend in full", () => {
    const trend = weeklyTrend(projected, NOW);
    expect(trend.delta).toBe(2);
    expect(trend.meaning).toContain("high-impact");
  });
});

describe("feedback", () => {
  const base = [signal({ id: "comms:reply-debt:1", urgency: 95, category: "relationship" })];

  it("parks a signal for a week without deleting it", () => {
    const projected = toPulseSignals({
      organizationId: "org",
      now: NOW,
      signals: base,
      feedback: [
        {
          signalId: "comms:reply-debt:1",
          signalKind: "comms:reply-debt",
          kind: "not_now",
          at: "2026-08-17T00:00:00.000Z",
        },
      ],
    });
    expect(projected).toHaveLength(1);
    expect(projected[0]?.severity).toBe("good_to_know");
  });

  it("quiets a rule family only after repeated corrections", () => {
    const kind = signalKindOf("comms:reply-debt:1");
    const once = toPulseSignals({
      organizationId: "org",
      now: NOW,
      signals: base,
      feedback: [{ signalId: "other", signalKind: kind, kind: "not_useful", at: NOW }],
    });
    expect(once[0]?.severity).toBe("act_now");

    const repeated = toPulseSignals({
      organizationId: "org",
      now: NOW,
      signals: base,
      feedback: Array.from({ length: NOT_USEFUL_THRESHOLD }, (_, index) => ({
        signalId: `other-${index}`,
        signalKind: kind,
        kind: "not_useful" as const,
        at: NOW,
      })),
    });
    expect(repeated[0]?.severity).toBe("good_to_know");
  });
});

describe("recency", () => {
  it("reads ages in a person's language", () => {
    expect(relativeAge("2026-08-17T23:37:00.000Z", NOW)).toBe("23m ago");
    expect(relativeAge("2026-08-17T23:00:00.000Z", NOW)).toBe("1h ago");
    expect(relativeAge("2026-08-15T00:00:00.000Z", NOW)).toBe("3d ago");
  });

  it("lists the newest changes first", () => {
    const projected = toPulseSignals({
      organizationId: "org",
      now: NOW,
      signals: [
        signal({ id: "old", at: "2026-08-10T00:00:00.000Z" }),
        signal({ id: "new", at: "2026-08-17T23:00:00.000Z" }),
      ],
    });
    expect(recentlyUpdated(projected, NOW)[0]?.signal.id).toBe("new");
  });
});
