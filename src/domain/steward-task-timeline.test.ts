import { describe, expect, it } from "vitest";

import { AI_ACTOR, buildTaskTimeline, filterTimelines } from "./steward-task-timeline";

const base = {
  id: "t1",
  title: "Prepare brief",
  assigneeKind: "human" as const,
  ownerLabel: "Ada",
  createdByLabel: "Tai",
  createdAt: "2026-09-20T10:00:00Z",
  updatedAt: "2026-09-21T10:00:00Z",
};

describe("task timeline", () => {
  it("shows pending then completed with who did it", () => {
    const t = buildTaskTimeline({ ...base, status: "complete" }, [
      { entityId: "t1", eventType: "task.completed", occurredAt: "2026-09-21T09:00:00Z", actorLabel: "Ada", actorIsAgent: false },
    ], []);
    expect(t.steps.map((s) => [s.stage, s.actor])).toEqual([["pending", "Tai"], ["completed", "Ada"]]);
  });

  it("records AI runs and never guesses unknown actors or times", () => {
    const t = buildTaskTimeline({ ...base, assigneeKind: "agent", status: "needs_approval", createdByLabel: undefined as unknown as string }, [], [
      { taskId: "t1", status: "needs_approval", createdAt: "2026-09-20T11:00:00Z", settledAt: "2026-09-20T11:01:00Z", safeError: "Needs a person" },
    ]);
    expect(t.steps[0]!.actor).toBe("Unknown");
    expect(t.steps.slice(1).every((s) => s.actor === AI_ACTOR)).toBe(true);
    const missing = buildTaskTimeline({ ...base, status: "in_progress" }, [], []);
    expect(missing.steps.at(-1)).toMatchObject({ stage: "in_progress", at: null, note: "Time not recorded" });
  });

  it("filters by stage and owner newest first", () => {
    const a = buildTaskTimeline({ ...base, status: "open" }, [], []);
    const b = buildTaskTimeline({ ...base, id: "t2", status: "complete", updatedAt: "2026-09-22T00:00:00Z" }, [], []);
    expect(filterTimelines([a, b], {}).map((t) => t.taskId)).toEqual(["t2", "t1"]);
    expect(filterTimelines([a, b], { stage: "pending" }).map((t) => t.taskId)).toEqual(["t1"]);
    expect(filterTimelines([a, b], { owner: "Nobody" })).toEqual([]);
  });
});
