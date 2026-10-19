import { describe, it, expect } from "vitest";
import {
  completionOf,
  meetingMatches,
  withRollForwards,
  mergeTaskRevisions,
} from "./steward-completion";
import { buildWorkroom } from "./steward-workroom";
import type { Commitment } from "./steward";
const meeting = {
  id: "meeting",
  title: "Delivery",
  occurredAt: "2026-10-01",
  provider: "manual",
  sourceUrl: "",
  participantCount: 0,
  segmentCount: 0,
  lastSegmentAt: null,
};
function build(statuses: Commitment["status"][]) {
  return buildWorkroom(
    [meeting],
    statuses.map(
      (status, i) =>
        ({
          id: String(i),
          conversationId: "meeting",
          status,
          what: "Action",
          evidence: [],
          sourceKey: String(i),
          dueAt: "2026-01-01",
        }) as unknown as Commitment,
    ),
  )[0]!;
}
describe("approved work completion, independent of verification", () => {
  it("has no score without confirmed actions", () =>
    expect(completionOf(build([]))).toMatchObject({
      total: 0,
      completed: 0,
      open: 0,
      percentage: null,
      allComplete: false,
    }));
  it("counts kept work without inventing verification or capping for review", () => {
    const m = build(["kept", "kept"]);
    m.openProposals = 9;
    expect(completionOf(m)).toMatchObject({
      total: 2,
      percentage: 100,
      completed: 2,
      open: 0,
      allComplete: true,
    });
    expect(m.rows.every((r) => !r.verified)).toBe(true);
  });
  it("recalculates status, open and overdue while excluding released work", () =>
    expect(completionOf(build(["kept", "open", "released"]), new Date("2026-10-19"))).toMatchObject(
      { total: 2, completed: 1, open: 1, overdue: 1, percentage: 50 },
    ));
  it("deduplicates the same task and excludes contextual business links", () => {
    const m = build(["open"]);
    m.rows.push(m.rows[0]!, { ...m.rows[0]!, id: "context", kind: "business-task" });
    expect(completionOf(m).total).toBe(1);
  });
  it("filters by title, open work and awaiting review separately", () => {
    const m = build(["kept"]);
    m.openProposals = 2;
    expect(meetingMatches(m, "DEL", "review")).toBe(true);
    expect(meetingMatches(m, "", "open")).toBe(false);
    expect(meetingMatches(m, "missing", "all")).toBe(false);
  });
});

it("roll-forward retains original obligation, carries identity once and never changes score", () => {
  const origin = build(["open"]);
  const later = { ...build([]), id: "later", occurredAt: "2026-11-01" };
  const projected = withRollForwards(
    [origin, later],
    [{ entity_id: "0", payload: { original_meeting_id: "meeting", later_meeting_id: "later" } }],
  );
  expect(projected[0]?.rows[0]?.status).toBe("open");
  expect(projected[1]?.rows[0]?.id).toBe("0");
  expect(projected[1]?.rows[0]?.forwardedFrom).toBe("meeting");
  expect(completionOf(projected[0]!)).toMatchObject({ total: 1, open: 1 });
  expect(completionOf(projected[1]!)).toMatchObject({ total: 0, percentage: null });
});

it("never rounds incomplete work to 100%", () => {
  expect(completionOf(build([...Array(199).fill("kept"), "open"]))).toMatchObject({
    total: 200,
    completed: 199,
    open: 1,
    percentage: 99,
    allComplete: false,
  });
});

it("projects a targeted older source into a destination among the recent 60 without counting twice", () => {
  const origin = build(["open"]);
  const recent = Array.from({ length: 60 }, (_, i) => ({
    ...build([]),
    id: `recent-${i}`,
    occurredAt: "2026-11-01",
  }));
  const visibleIds = new Set(recent.map((m) => m.id));
  const visible = withRollForwards(
    [...recent, origin],
    [{ entity_id: "0", payload: { original_meeting_id: origin.id, later_meeting_id: "recent-0" } }],
  ).filter((m) => visibleIds.has(m.id));
  expect(visible).toHaveLength(60);
  expect(visible[0]?.rows[0]).toMatchObject({ id: "0", forwardedFrom: origin.id, status: "open" });
  expect(completionOf(visible[0]!)).toMatchObject({
    total: 0,
    percentage: null,
    allComplete: false,
  });
  expect(origin.rows[0]?.id).toBe("0");
});

it("keeps edited status, owner, due and revision when the carry cache is older", () => {
  const old = { id: "task", revision: 1, status: "open", owner: "Old", due: "2026-10-20" };
  const saved = { ...old, revision: 2, status: "complete", owner: "New", due: "2026-10-25" };
  expect(mergeTaskRevisions([saved], [old])).toEqual([saved]);
  expect(mergeTaskRevisions([old], [saved])).toEqual([saved]);
  expect(mergeTaskRevisions([], [saved])).toEqual([saved]);
});
