import { describe, it, expect } from "vitest";
import { blankJob, jobSchema, needsAttention, HIRING_PEOPLE } from "./hiring";
describe("Hiring rules", () => {
  it("requires concise role identity and two or three unique questions", () => {
    const j = { ...blankJob(), title: "Engineer", slug: "engineer" };
    expect(jobSchema.safeParse(j).success).toBe(true);
    for (const questions of [
      [],
      [j.questions[0]],
      [...j.questions, ...j.questions],
      [j.questions[0], j.questions[0]],
    ])
      expect(jobSchema.safeParse({ ...j, questions }).success).toBe(false);
  });
  it("excludes the unconfirmed typo identity", () => {
    expect(HIRING_PEOPLE).toHaveLength(3);
    expect(HIRING_PEOPLE.some((p) => p.id === "7dc109bb-7f3a-448a-b8b7-6438116d8dea")).toBe(false);
  });
  it("shows unassigned and overdue active work", () => {
    const a = { owner_id: "someone", review_date: "2026-11-01", stage: "reviewing" } as Parameters<
      typeof needsAttention
    >[0];
    expect(needsAttention(a, "2026-11-12")).toBe(true);
    expect(needsAttention({ ...a, stage: "hired" }, "2026-11-12")).toBe(false);
    expect(needsAttention({ ...a, owner_id: null }, "2026-11-12")).toBe(true);
    expect(needsAttention({ ...a, review_date: "2026-12-01", next_action: "" }, "2026-11-12")).toBe(
      true,
    );
    expect(
      needsAttention(
        { ...a, review_date: "2026-12-01", next_action: "Review writing samples" },
        "2026-11-12",
      ),
    ).toBe(false);
  });
});
