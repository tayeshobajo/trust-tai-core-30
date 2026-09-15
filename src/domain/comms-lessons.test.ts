/**
 * Lessons from decisions: what may be kept, and what may never be.
 */

import { describe, expect, it } from "vitest";

import {
  activeLessons,
  canPromoteLesson,
  isDecided,
  lessonCandidate,
  lessonGuidance,
  validateLesson,
  type ReviewLesson,
} from "./comms-lessons";
import type { ReviewFinding } from "./comms-review";

const finding = (over: Partial<ReviewFinding> = {}): ReviewFinding => ({
  id: "f-1",
  runId: "r-1",
  versionId: "v-1",
  kind: "tone",
  severity: "consider",
  excerpt: "Just checking in",
  excerptStart: 0,
  excerptEnd: 16,
  why: "An opener with no reason in it",
  suggestion: null,
  state: "edited",
  position: 1,
  ...over,
});

const lesson = (over: Partial<ReviewLesson> = {}): ReviewLesson => ({
  id: "l-1",
  organizationId: "org-1",
  sourceFindingId: "f-1",
  sourceSessionId: "s-1",
  lesson: "Open with the reason for writing, not a greeting.",
  sourceNote: "Worth considering: An opener with no reason in it (edited)",
  promotedBy: "user-1",
  promotedByRole: "owner",
  promotedAt: "2026-09-16T09:00:00.000Z",
  revokedAt: null,
  revokedBy: null,
  ...over,
});

describe("only a decision teaches anything", () => {
  it("offers nothing from an undecided finding", () => {
    expect(isDecided(finding({ state: "open" }))).toBe(false);
    expect(lessonCandidate(finding({ state: "open" }))).toBeNull();
  });

  it("offers wording a person can edit, from what they actually did", () => {
    expect(lessonCandidate(finding({ state: "kept" }))?.lesson).toMatch(/leave it as written/i);
    expect(lessonCandidate(finding({ state: "edited" }))?.lesson).toMatch(/change the wording/i);
  });
});

describe("who may keep one", () => {
  it("is an owner or an admin, nobody else", () => {
    expect(canPromoteLesson("owner")).toBe(true);
    expect(canPromoteLesson("admin")).toBe(true);
    expect(canPromoteLesson("member")).toBe(false);
    expect(canPromoteLesson("")).toBe(false);
  });
});

describe("a lesson carries no facts", () => {
  it("refuses an address, a link, a figure or a long number", () => {
    expect(validateLesson("Reply to dana@example.invalid faster.")).toMatch(/email address/i);
    expect(validateLesson("Always quote $4,000 for this kind of work.")).toMatch(/figures/i);
    expect(validateLesson("Send them https://example.invalid/pricing.")).toMatch(/link/i);
    expect(validateLesson("Reference invoice 100294 next time.")).toMatch(/figures/i);
  });

  it("accepts guidance about how to write", () => {
    expect(validateLesson("Open with the reason for writing, not a greeting.")).toBeNull();
  });

  it("refuses an empty or rambling one", () => {
    expect(validateLesson(" ")).toMatch(/sentence/i);
    expect(validateLesson("x".repeat(400))).toMatch(/sentence or two/i);
  });
});

describe("reuse in later reviews", () => {
  it("says nothing at all when nothing has been kept", () => {
    expect(lessonGuidance([])).toBe("");
    expect(lessonGuidance([lesson({ revokedAt: "2026-09-16T10:00:00.000Z", revokedBy: "u" })])).toBe(
      "",
    );
  });

  it("hands kept lessons over as preferences, never as facts", () => {
    const text = lessonGuidance([lesson()]);
    expect(text).toContain("Open with the reason for writing, not a greeting.");
    expect(text).toMatch(/not facts/i);
    expect(text).toMatch(/never treat one as something/i);
  });

  it("drops a revoked lesson from what is active", () => {
    const list = [lesson(), lesson({ id: "l-2", revokedAt: "2026-09-16T10:00:00.000Z", revokedBy: "u" })];
    expect(activeLessons(list).map((entry) => entry.id)).toEqual(["l-1"]);
  });
});
