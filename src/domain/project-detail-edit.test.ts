import { describe, expect, it } from "vitest";

import { agreedDayToIso, checkDetailEdit, type ExecutionProject } from "./projects";

function project(overrides: Partial<ExecutionProject> = {}): ExecutionProject {
  return {
    id: "p1",
    organizationId: "o1",
    name: "Mental Dental Academy",
    state: "in_flight",
    pointA: "Nothing recorded yet.",
    pointB: "The academy is live.",
    evidence: [],
    dependencies: [],
    origin: { kind: "manual" },
    lastMovedAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("checkDetailEdit", () => {
  it("accepts a correction to what a person typed", () => {
    expect(checkDetailEdit(project(), { name: "Mental Dental" }).ok).toBe(true);
    expect(checkDetailEdit(project(), { pointA: "Scope agreed." }).ok).toBe(true);
  });

  it("refuses a nameless project", () => {
    const check = checkDetailEdit(project(), { name: "   " });
    expect(check.ok).toBe(false);
    expect(check.because).toMatch(/needs a name/i);
  });

  it("allows Point A to be emptied", () => {
    expect(checkDetailEdit(project(), { pointA: "" }).ok).toBe(true);
  });

  it("refuses removing Point B from work already called done", () => {
    expect(checkDetailEdit(project({ state: "delivered" }), { pointB: "" }).ok).toBe(false);
    expect(checkDetailEdit(project({ state: "closed" }), { pointB: "" }).ok).toBe(false);
    expect(checkDetailEdit(project({ state: "in_flight" }), { pointB: "" }).ok).toBe(true);
  });

  it("accepts clearing an agreed date, refuses an unreadable one", () => {
    expect(checkDetailEdit(project(), { dueDate: "" }).ok).toBe(true);
    expect(checkDetailEdit(project(), { dueDate: "2026-10-01T12:00:00.000Z" }).ok).toBe(true);
    const check = checkDetailEdit(project(), { dueDate: "next tuesday" });
    expect(check.ok).toBe(false);
    expect(check.because).toMatch(/real calendar date/i);
  });

  it("lets manual work name the company it serves", () => {
    expect(checkDetailEdit(project(), { subjectLabel: "Life of Houston" }).ok).toBe(true);
    expect(checkDetailEdit(project(), { subjectLabel: " " }).ok).toBe(false);
  });

  it("refuses relabelling the company on a client-linked project, and says who owns it", () => {
    const linked = project({ clientId: "c1" });
    const check = checkDetailEdit(linked, { subjectLabel: "Someone else" });
    expect(check.ok).toBe(false);
    expect(check.because).toMatch(/Client record/);
    // The rest of the record is still correctable on a client-linked project.
    expect(checkDetailEdit(linked, { name: "Renamed" }).ok).toBe(true);
  });

  it("refuses reassigning the company on roadmap work, and says who owns it", () => {
    const fromRoadmap = project({
      origin: { kind: "roadmap_milestone", roadmapId: "r1", milestoneId: "m1" },
    });
    const check = checkDetailEdit(fromRoadmap, { subjectLabel: "Someone else" });
    expect(check.ok).toBe(false);
    expect(check.because).toMatch(/Roadmap/);
  });

  it("is a no-op when nothing was edited", () => {
    expect(checkDetailEdit(project(), {}).ok).toBe(true);
  });
});

describe("agreedDayToIso", () => {
  it("records a calendar day at noon UTC, so the day never slides by timezone", () => {
    expect(agreedDayToIso("2026-10-01")).toBe("2026-10-01T12:00:00.000Z");
    expect(agreedDayToIso(" 2026-10-01 ")).toBe("2026-10-01T12:00:00.000Z");
  });

  it("returns nothing for no day, which says no date is agreed", () => {
    expect(agreedDayToIso("")).toBe("");
  });
});
