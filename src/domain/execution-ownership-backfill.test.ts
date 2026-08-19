import { describe, expect, it } from "vitest";

import {
  describeBackfillPlan,
  planOwnershipBackfill,
  type BackfillLink,
  type BackfillMilestone,
} from "./execution-ownership-backfill";

function milestone(over: Partial<BackfillMilestone> = {}): BackfillMilestone {
  return {
    id: "m1",
    roadmapId: "r1",
    name: "Leadership alignment dashboard",
    whatWeBuild: "An interactive dashboard the leadership team reads weekly.",
    executionBoundary: "Studio builds the dashboard and hands it over.",
    ...over,
  };
}

describe("planOwnershipBackfill", () => {
  it("rewrites a boundary that hands engineering work to Studio", () => {
    const plan = planOwnershipBackfill([milestone()], []);
    const [entry] = plan.corrections;
    expect(entry?.owner.primary).toBe("projects");
    expect(entry?.boundaryAfter).toBe("Projects builds the dashboard and hands it over.");
    expect(entry?.boundaryChanged).toBe(true);
    expect(plan.counts.boundaries).toBe(1);
  });

  it("re-points an open handoff that named the wrong room", () => {
    const link: BackfillLink = {
      id: "l1",
      milestoneId: "m1",
      owningApp: "studio",
      status: "requested",
    };
    const plan = planOwnershipBackfill([milestone()], [link]);
    expect(plan.changes[0]?.linkChanged).toBe(true);
    expect(plan.changes[0]?.linkOwnerAfter).toBe("projects");
    expect(plan.counts.links).toBe(1);
  });

  it("leaves a settled handoff as history and says so", () => {
    const link: BackfillLink = {
      id: "l1",
      milestoneId: "m1",
      owningApp: "studio",
      status: "complete",
    };
    const plan = planOwnershipBackfill([milestone()], [link]);
    expect(plan.changes[0]?.linkChanged).toBe(false);
    expect(plan.frozen).toHaveLength(1);
    expect(plan.frozen[0]?.frozenBecause).toMatch(/already complete/);
  });

  it("keeps a genuine Studio content milestone with Studio", () => {
    const plan = planOwnershipBackfill(
      [
        milestone({
          name: "Founder newsletter series",
          whatWeBuild: "A weekly newsletter and LinkedIn series.",
          executionBoundary: "Studio produces the newsletter.",
        }),
      ],
      [{ id: "l2", milestoneId: "m1", owningApp: "studio", status: "accepted" }],
    );
    expect(plan.corrections[0]?.owner.primary).toBe("studio");
    expect(plan.changes).toHaveLength(0);
  });

  it("sends recurring technical work to Ops", () => {
    const plan = planOwnershipBackfill(
      [
        milestone({
          name: "Monthly platform maintenance",
          whatWeBuild: "Ongoing monitoring, patching and support.",
          executionBoundary: "Studio maintains the environment.",
        }),
      ],
      [],
    );
    expect(plan.corrections[0]?.owner.primary).toBe("ops");
    expect(plan.corrections[0]?.boundaryAfter).toBe("Ops maintains the environment.");
  });

  it("is idempotent: a corrected set plans no further change", () => {
    const first = planOwnershipBackfill([milestone()], []);
    const corrected = milestone({ executionBoundary: first.corrections[0]!.boundaryAfter });
    const second = planOwnershipBackfill([corrected], []);
    expect(second.changes).toHaveLength(0);
    expect(describeBackfillPlan(second)).toMatch(/already name the room/);
  });

  it("exposes the words the decision was made on", () => {
    const signals = planOwnershipBackfill([milestone()], []).corrections[0]!.owner.signals;
    expect(signals.engineering).toContain("dashboard");
    expect(signals.engineering).toContain("interactive");
    expect(signals.content).toHaveLength(0);
  });
});
