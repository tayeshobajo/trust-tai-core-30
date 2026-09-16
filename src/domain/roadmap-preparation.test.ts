import { describe, expect, it } from "vitest";

import {
  approveDestination,
  approvePriorities,
  freezeRoadmapVersion,
  provisionalNote,
  roadmapChanges,
  roadmapStamp,
  type PreparedRoadmap,
} from "./roadmap-preparation";

const AT = "2026-03-01T09:00:00.000Z";

function roadmap(): PreparedRoadmap {
  return {
    organizationId: "org-fixture-0000-0000-0000-000000000001",
    clientRef: "fixture-client-01",
    pointA: [
      {
        statement: "Enquiries arrive by email and are answered by one person.",
        tier: "observed",
        evidence: [{ sourceId: "fixture:note/1", label: "Discovery note", observedAt: AT }],
      },
    ],
    destination: {
      statement: "Every enquiry answered within one working day.",
      tier: "inferred",
      evidence: [{ sourceId: "fixture:note/1", label: "Discovery note", observedAt: AT }],
    },
    phases: [
      {
        id: "p1",
        position: 1,
        title: "Shared inbox",
        intent: "one place for enquiries",
        options: [{ id: "o1", label: "Move to a shared mailbox", because: "one owner", dependsOn: [] }],
        dependsOn: [],
        evidence: [],
      },
      {
        id: "p2",
        position: 2,
        title: "Reply templates",
        intent: "faster first replies",
        options: [{ id: "o2", label: "Three reusable replies", because: "repeatable", dependsOn: ["p1"] }],
        dependsOn: ["p1"],
        evidence: [],
      },
    ],
    firstMove: { statement: "Agree who owns the shared inbox.", tier: "inferred", evidence: [] },
    unknowns: ["Budget has not been discussed."],
  };
}

describe("roadmap preparation", () => {
  it("keeps schedules, capacity and budget provisional until a person decides", () => {
    expect(
      provisionalNote([
        { kind: "schedule", statement: "Start in April", decided: false },
        { kind: "budget", statement: "Around ten days", decided: false },
      ]),
    ).toBe("Provisional until someone decides: schedule, budget.");
    expect(
      provisionalNote([{ kind: "capacity", statement: "Two people free", decided: true, decidedBy: "person-1" }]),
    ).toBeNull();
  });

  it("refuses a destination approval with nobody named", () => {
    const outcome = approveDestination({ roadmap: roadmap(), by: "", at: AT });
    expect(outcome.approved).toBe(false);
  });

  it("marks an approved destination as decided", () => {
    const outcome = approveDestination({ roadmap: roadmap(), by: "person-1", at: AT });
    expect(outcome.approved && outcome.roadmap.destination?.tier).toBe("decided");
  });

  it("refuses an order that names a phase that is not on the roadmap", () => {
    const outcome = approvePriorities({ roadmap: roadmap(), order: ["p1", "p9"], by: "person-1" });
    expect(outcome.approved).toBe(false);
  });

  it("will not freeze a version nobody approved", () => {
    const outcome = freezeRoadmapVersion({ roadmap: roadmap(), by: "person-1", at: AT });
    expect(outcome.frozen).toBe(false);
  });

  it("freezes an approved roadmap and returns the same version for the same content", () => {
    const approved = approveDestination({ roadmap: roadmap(), by: "person-1", at: AT });
    if (!approved.approved) throw new Error("expected approval");
    const first = freezeRoadmapVersion({ roadmap: approved.roadmap, by: "person-1", at: AT });
    if (!first.frozen) throw new Error("expected freeze");
    const second = freezeRoadmapVersion({
      roadmap: approved.roadmap,
      by: "person-1",
      at: "2026-03-02T09:00:00.000Z",
      existing: [first.version],
    });
    expect(second.frozen && second.version.versionId).toBe(first.version.versionId);
  });

  it("does not let a later edit change a frozen version", () => {
    const approved = approveDestination({ roadmap: roadmap(), by: "person-1", at: AT });
    if (!approved.approved) throw new Error("expected approval");
    const frozen = freezeRoadmapVersion({ roadmap: approved.roadmap, by: "person-1", at: AT });
    if (!frozen.frozen) throw new Error("expected freeze");
    approved.roadmap.phases[0]!.title = "Changed after freezing";
    expect(frozen.version.roadmap.phases[0]?.title).toBe("Shared inbox");
    expect(frozen.version.stamp).toBe(roadmapStamp(frozen.version.roadmap));
  });

  it("names what changed between two versions", () => {
    const approved = approveDestination({ roadmap: roadmap(), by: "person-1", at: AT });
    if (!approved.approved) throw new Error("expected approval");
    const first = freezeRoadmapVersion({ roadmap: approved.roadmap, by: "person-1", at: AT });
    if (!first.frozen) throw new Error("expected freeze");

    const edited = structuredClone(approved.roadmap);
    edited.phases[1]!.intent = "faster replies and fewer misses";
    const second = freezeRoadmapVersion({
      roadmap: edited,
      by: "person-1",
      at: "2026-03-05T09:00:00.000Z",
      existing: [first.version],
    });
    if (!second.frozen) throw new Error("expected freeze");

    const changes = roadmapChanges(first.version, second.version);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.what).toBe("Phase Reply templates");
  });
});
