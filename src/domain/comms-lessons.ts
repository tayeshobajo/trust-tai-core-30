/**
 * Lessons, learned only from decisions a person actually made.
 *
 * C19 asks that human decisions change later behaviour. The narrowest honest
 * way to do that: when someone decides a finding, an owner or admin may keep
 * that decision as a lesson. A kept lesson is shown back to the reviewer on
 * later reviews in the same workspace, as guidance about how to write, and it
 * can be revoked at any time.
 *
 * Four lines nothing here crosses:
 *
 *  - No lesson is created automatically. Deciding a finding proposes one; a
 *    person promotes it, and the promotion carries their verified identity
 *    and a snapshot of the decision it came from.
 *  - A lesson never edits a rule, a voice profile or any stored judgment. It
 *    is guidance handed to the next review, nothing more.
 *  - A lesson carries no facts, and this is enforced by construction rather
 *    than by pattern matching. A pattern cannot catch "Acme prefers Tuesday".
 *    So the only thing a lesson stores as reusable guidance is the id of one
 *    bounded style category from the fixed catalogue below, and the only text
 *    a later review ever sees is this file's own wording for that category.
 *    Free text a person writes stays a private note for people to read.
 *  - Nothing from the source conversation — the finding's words, the private
 *    note, the recipient — is ever carried into another review.
 */

import type { ReviewFinding } from "@/domain/comms-review";
import { sha256 } from "@/domain/sha256";

/* ------------------------------------------------------- style categories */

export type LessonCategoryId =
  | "keep_our_wording"
  | "open_with_the_reason"
  | "shorter_and_plainer"
  | "answer_every_question"
  | "name_the_next_step"
  | "no_humour_when_sensitive"
  | "no_promises_without_a_decision"
  | "warmth_stays_specific";

export interface LessonCategory {
  id: LessonCategoryId;
  /** What a person picks from, in their words. */
  label: string;
  /** The exact sentence a later review is given. Style only, no facts. */
  guidance: string;
}

/**
 * The whole vocabulary of reusable guidance. Nothing outside this list can
 * reach a later review, which is what makes cross-client factual reuse
 * impossible rather than merely discouraged.
 */
export const LESSON_CATEGORIES: readonly LessonCategory[] = [
  {
    id: "keep_our_wording",
    label: "Leave our wording alone when it already works",
    guidance: "Do not rewrite wording that already reads as ours; raise it only if it misleads.",
  },
  {
    id: "open_with_the_reason",
    label: "Open with the reason for writing",
    guidance: "Expect the opening line to give the reason for writing rather than a greeting.",
  },
  {
    id: "shorter_and_plainer",
    label: "Shorter and plainer",
    guidance: "Prefer shorter sentences and plain words over formal or padded phrasing.",
  },
  {
    id: "answer_every_question",
    label: "Answer every question asked",
    guidance: "Treat an unanswered question in the source as a must fix, every time.",
  },
  {
    id: "name_the_next_step",
    label: "Name a concrete next step",
    guidance: "Expect one concrete next step, with who does it, rather than an open invitation.",
  },
  {
    id: "no_humour_when_sensitive",
    label: "No humour in sensitive messages",
    guidance: "Flag humour or lightness in a complaint, an apology or bad news.",
  },
  {
    id: "no_promises_without_a_decision",
    label: "No promises that were never decided",
    guidance: "Flag any commitment, date or figure the source does not support.",
  },
  {
    id: "warmth_stays_specific",
    label: "Warmth stays specific",
    guidance: "Prefer warmth tied to something specific over generic friendliness.",
  },
] as const;

export function lessonCategory(id: string): LessonCategory | null {
  return LESSON_CATEGORIES.find((entry) => entry.id === id) ?? null;
}

export const LESSON_CATEGORY_IDS: readonly string[] = LESSON_CATEGORIES.map((entry) => entry.id);

/* ------------------------------------------------------------ the record */

export interface ReviewLesson {
  id: string;
  organizationId: string;
  /** The decided finding this came from. Always present; the lesson's proof. */
  sourceFindingId: string;
  /** The run that finding belongs to. */
  sourceRunId: string;
  /** The session that run belongs to. Verified to match the run at promotion. */
  sourceSessionId: string;
  /** The one bounded style category this lesson reuses. */
  category: LessonCategoryId;
  /** The decision snapshot: state, severity and wording as they stood then. */
  sourceNote: string;
  /** The verified person whose decision this was. */
  decidedBy: string;
  decidedAt: string | null;
  /** A private note for people here. Never handed to a review. */
  privateNote: string;
  promotedBy: string;
  promotedByRole: string;
  promotedAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
}

/** Only a decided finding can teach anything; an open one has taught nothing. */
export type DecidedState = "accepted" | "kept" | "edited";

export function isDecided(finding: ReviewFinding): boolean {
  return finding.state === "accepted" || finding.state === "kept" || finding.state === "edited";
}

/**
 * The category a decision most plausibly suggests, offered as a starting
 * point a person may change. Returns null when there is no decision yet:
 * nothing is inferred from silence.
 */
export function lessonCandidate(
  finding: ReviewFinding,
): { category: LessonCategoryId; sourceNote: string } | null {
  if (!isDecided(finding)) return null;
  const category: LessonCategoryId =
    finding.state === "kept"
      ? "keep_our_wording"
      : finding.kind === "question"
        ? "answer_every_question"
        : finding.kind === "claim"
          ? "no_promises_without_a_decision"
          : "shorter_and_plainer";
  return {
    category,
    sourceNote: `${finding.severity === "must_fix" ? "Must fix" : "Worth considering"}: ${finding.why} (${finding.state})`,
  };
}

/** Who may keep or revoke a lesson for the whole workspace. */
export function canPromoteLesson(role: string): boolean {
  return role === "owner" || role === "admin";
}

/* -------------------------------------------------------------- refusals */

export const FREE_TEXT_LESSON_REFUSAL =
  "A lesson is chosen from the list of writing habits, not written out. Anything typed here stays a private note and is never shown to a review.";

/**
 * Validate what will actually be reused. Only a catalogue id passes; free
 * text is refused outright, because no amount of pattern matching can tell
 * "Acme prefers Tuesday" from a style preference.
 */
export function validateLessonCategory(id: string): string | null {
  if (!lessonCategory(id)) return FREE_TEXT_LESSON_REFUSAL;
  return null;
}

/** A private note is for people here. Bounded in length, never reused. */
export function validatePrivateNote(text: string): string | null {
  if (text.trim().length > 300) return "Keep the note to a sentence or two.";
  return null;
}

export function activeLessons(lessons: ReviewLesson[]): ReviewLesson[] {
  return lessons.filter((lesson) => !lesson.revokedAt);
}

/* ---------------------------------------------- what a later review sees */

/**
 * The guidance block handed to a later review.
 *
 * Built only from this file's catalogue wording for the distinct categories
 * kept here. No lesson text, no private note, no source wording, no
 * recipient, nothing from the conversation the lesson came from. Empty when
 * nothing is active, so the prompt says nothing rather than implying an empty
 * rulebook is a rulebook.
 */
export function lessonGuidance(lessons: ReviewLesson[]): string {
  const ids = new Set(activeLessons(lessons).map((lesson) => lesson.category));
  const lines = LESSON_CATEGORIES.filter((entry) => ids.has(entry.id)).map(
    (entry) => `- ${entry.guidance}`,
  );
  if (lines.length === 0) return "";
  return [
    "Writing habits this workspace kept from earlier human decisions.",
    "These are about how to write, not facts. Never treat one as something",
    "the recipient said, and never carry one into the message as a claim.",
    ...lines,
  ].join("\n");
}

/* --------------------------------------------------------- the set stamp */

/** What the lesson set was when a review ran. */
export type LessonSetState = "available" | "unsupported" | "read_failed";

/**
 * One stable string standing for the exact active lesson set. It goes into
 * the context fingerprint, so keeping or revoking a lesson makes every
 * earlier run and approval stale rather than leaving them looking current
 * against guidance that has since changed.
 *
 * "unsupported" is its own value, not an empty set: a workspace that cannot
 * keep lessons yet is not the same as one that has kept none. A read failure
 * has no stamp at all; callers must refuse rather than quietly run as though
 * no guidance existed.
 */
export function lessonSetStamp(input: {
  state: LessonSetState;
  lessons: ReviewLesson[];
}): string | null {
  if (input.state === "read_failed") return null;
  if (input.state === "unsupported") return "lessons:unsupported";
  const live = activeLessons(input.lessons)
    .map((lesson) => `${lesson.id}:${lesson.category}:${lesson.promotedAt}`)
    .sort();
  if (live.length === 0) return "lessons:none";
  return `lessons:${sha256(live.join("\u0000"))}`;
}

export const LESSONS_UNREADABLE_REFUSAL =
  "The writing habits kept here could not be read, so this review was not run. Running it without them would judge the draft against the wrong guidance. Try again in a moment.";
