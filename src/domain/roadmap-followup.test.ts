import { expect, it } from "vitest";
import { followUpState, type StandingReview } from "./roadmap-followup";
import { projectEvidence } from "./roadmap-evidence";
import { native } from "./roadmap-evidence.fixtures";
const now = new Date("2026-11-03T23:59:00Z");
const record = () => ({
  ...projectEvidence([native], native.organizationId)[0]!,
  owner: "Demo owner",
  nextAction: "Review milestone",
  followUp: "2026-11-10",
});
const review: StandingReview = {
  reviewedAt: "2026-11-03T12:00:00Z",
  validThrough: "2026-11-10",
  reviewer: "Demo reviewer",
  sourceRef: "review-1",
  coverage: "reviewed_current",
};
it.each([
  ["2026-11-02", "overdue"],
  ["2026-11-03", "due_today"],
  ["2026-11-04", "upcoming"],
  ["2026-11-10", "upcoming"],
  ["2026-11-11", "scheduled"],
  [null, "needs_scheduling"],
  ["2026-02-30", "needs_scheduling"],
  ["tomorrow", "needs_scheduling"],
])("classifies explicit date %s as %s", (date, state) => {
  expect(followUpState({ ...record(), followUp: date }, now).state).toBe(state);
});
it("does not infer good standing from a future date or missing evidence", () => {
  expect(followUpState(record(), now).standing).toBe("unverified");
  expect(followUpState(record(), now, review).standing).toBe("good");
});
it("rejects expired, future, unassigned and incomplete reviews", () => {
  for (const patch of [
    { validThrough: "2026-11-02" },
    { validThrough: "2026-02-30" },
    { reviewedAt: "2026-11-04T00:00:00Z" },
    { sourceRef: "" },
    { reviewer: "" },
  ])
    expect(followUpState(record(), now, { ...review, ...patch }).standing).not.toBe("good");
  expect(followUpState({ ...record(), owner: "Unassigned" }, now, review).standing).not.toBe(
    "good",
  );
  expect(followUpState({ ...record(), followUp: null }, now, review).standing).not.toBe("good");
});
it("preserves holds and excludes archived roadmaps from active queues", () => {
  expect(followUpState({ ...record(), binding: "pending" }, now, review).standing).toBe("held");
  const archived = { ...record(), native: { ...native, status: "archived" as const } };
  expect(followUpState(archived, now, review)).toMatchObject({
    state: "inactive",
    standing: "unverified",
    rank: 5,
  });
});
it("new activity invalidates an earlier review without generating a date", () => {
  const r = {
    ...record(),
    linkedInEvents: [
      {
        slug: "qa",
        recipient: "Demo",
        profile_url: "https://www.linkedin.com/in/example/",
        body: "Synthetic",
        subject: "Synthetic reply",
        status: "received_ui_verified" as const,
        observed_at: "2026-11-03T15:00:00Z",
        receipt: "fixture",
      },
    ],
  };
  expect(followUpState(r, now, review).standing).not.toBe("good");
  expect(r.followUp).toBe("2026-11-10");
});
