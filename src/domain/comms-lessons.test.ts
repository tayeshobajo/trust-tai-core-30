/**
 * Writing habits from decisions: what may be reused, and what may never be.
 */

import { describe, expect, it } from "vitest";

import {
  activeLessons,
  canPromoteLesson,
  isDecided,
  lessonCandidate,
  lessonGuidance,
  lessonSetStamp,
  validateLessonCategory,
  validatePrivateNote,
  LESSON_CATEGORIES,
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
  sourceRunId: "r-1",
  sourceSessionId: "s-1",
  category: "open_with_the_reason",
  sourceNote: "Worth considering: An opener with no reason in it (edited)",
  decidedBy: "user-9",
  decidedAt: "2026-09-16T08:00:00.000Z",
  privateNote: "Acme prefers Tuesday",
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

  it("suggests a habit from what the person actually did", () => {
    expect(lessonCandidate(finding({ state: "kept" }))?.category).toBe("keep_our_wording");
    expect(lessonCandidate(finding({ state: "edited", kind: "question" }))?.category).toBe(
      "answer_every_question",
    );
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

describe("facts cannot be reused, by construction", () => {
  it("refuses anything that is not one of the fixed habits", () => {
    /* The case a pattern check would wave through: ordinary words, a real
       client, a real fact. It is refused because free text is refused. */
    expect(validateLessonCategory("Acme prefers Tuesday")).toMatch(/chosen from the list/i);
    expect(validateLessonCategory("Open with the reason for writing.")).toMatch(/private note/i);
    expect(validateLessonCategory("")).not.toBeNull();
  });

  it("accepts a habit from the catalogue", () => {
    for (const entry of LESSON_CATEGORIES) {
      expect(validateLessonCategory(entry.id)).toBeNull();
    }
  });

  it("keeps a typed note bounded, and out of every review", () => {
    expect(validatePrivateNote("x".repeat(400))).toMatch(/sentence or two/i);
    expect(validatePrivateNote("Acme prefers Tuesday")).toBeNull();
    expect(lessonGuidance([lesson()])).not.toContain("Acme");
    expect(lessonGuidance([lesson()])).not.toContain("An opener with no reason in it");
  });
});

describe("what a later review is shown", () => {
  it("says nothing at all when nothing is active", () => {
    expect(lessonGuidance([])).toBe("");
    expect(lessonGuidance([lesson({ revokedAt: "2026-09-16T10:00:00.000Z", revokedBy: "u" })])).toBe(
      "",
    );
  });

  it("hands over catalogue wording as preferences, never as facts", () => {
    const text = lessonGuidance([lesson()]);
    expect(text).toContain("Expect the opening line to give the reason for writing");
    expect(text).toMatch(/not facts/i);
  });

  it("drops a revoked habit from what is active", () => {
    const list = [
      lesson(),
      lesson({ id: "l-2", revokedAt: "2026-09-16T10:00:00.000Z", revokedBy: "u" }),
    ];
    expect(activeLessons(list).map((entry) => entry.id)).toEqual(["l-1"]);
  });
});

describe("the set stamp that goes into the fingerprint", () => {
  const stamp = (lessons: ReviewLesson[]) => lessonSetStamp({ state: "available", lessons });

  it("separates nothing kept, cannot keep, and could not read", () => {
    expect(stamp([])).toBe("lessons:none");
    expect(lessonSetStamp({ state: "unsupported", lessons: [] })).toBe("lessons:unsupported");
    expect(lessonSetStamp({ state: "read_failed", lessons: [] })).toBeNull();
  });

  it("changes when a habit is kept, changed or revoked", () => {
    const one = stamp([lesson()]);
    expect(one).not.toBe(stamp([]));
    expect(stamp([lesson({ category: "shorter_and_plainer" })])).not.toBe(one);
    expect(stamp([lesson(), lesson({ id: "l-2" })])).not.toBe(one);
    expect(stamp([lesson({ revokedAt: "2026-09-16T10:00:00.000Z", revokedBy: "u" })])).toBe(
      stamp([]),
    );
  });

  it("does not change with the order rows come back in", () => {
    const a = lesson();
    const b = lesson({ id: "l-2", category: "shorter_and_plainer" });
    expect(stamp([a, b])).toBe(stamp([b, a]));
  });
});
