/**
 * Lessons, learned only from decisions a person actually made.
 *
 * C19 asks that human decisions change later behaviour. The narrowest honest
 * way to do that: when someone decides a finding, they may choose to keep the
 * decision as a lesson. A kept lesson is shown back to the reviewer on later
 * reviews in the same workspace, as guidance about how to write, and it can
 * be revoked at any time.
 *
 * Three lines nothing here crosses:
 *
 *  - No lesson is created automatically. Deciding a finding proposes one; a
 *    person promotes it, and the promotion carries their verified identity.
 *  - A lesson never edits a rule, a voice profile or any stored judgment. It
 *    is guidance handed to the next review, nothing more.
 *  - A lesson carries no facts about anybody. Names, addresses, companies and
 *    figures are refused at promotion, so nothing one client said can be
 *    reused as a fact about another.
 */

import type { ReviewFinding } from "@/domain/comms-review";

export interface ReviewLesson {
  id: string;
  organizationId: string;
  /** The decided finding this came from. Always present; the lesson's proof. */
  sourceFindingId: string;
  sourceSessionId: string;
  /** What the decision taught, in the promoter's words. */
  lesson: string;
  /** The decision underneath: what the reviewer said, and what was done. */
  sourceNote: string;
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
 * What a decision would say as a lesson, offered for a person to edit.
 * Returns null when there is no decision yet: nothing is inferred from
 * silence.
 */
export function lessonCandidate(finding: ReviewFinding): { lesson: string; sourceNote: string } | null {
  if (!isDecided(finding)) return null;
  const what = finding.why.trim() || finding.kind;
  const lesson =
    finding.state === "kept"
      ? `When Comms raises "${what}", leave it as written.`
      : `When Comms raises "${what}", change the wording as we did here.`;
  return {
    lesson,
    sourceNote: `${finding.severity === "must_fix" ? "Must fix" : "Worth considering"}: ${finding.why} (${finding.state})`,
  };
}

/** Who may keep a lesson for the whole workspace. */
export function canPromoteLesson(role: string): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Anything that looks like a fact about a person or a company is refused.
 * A lesson is about how we write, never about what somebody said.
 */
export function factualReuseRefusal(text: string): string | null {
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(text)) {
    return "A lesson cannot contain an email address. Say what to do differently, not who said it.";
  }
  if (/\b(?:\$|€|£|USD|EUR|GBP)\s?\d/.test(text) || /\b\d{4,}\b/.test(text)) {
    return "A lesson cannot carry figures from one conversation. Say what to do differently, not what was quoted.";
  }
  if (/\bhttps?:\/\//i.test(text)) {
    return "A lesson cannot carry a link from one conversation.";
  }
  return null;
}

export function validateLesson(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < 8) return "Write the lesson in a sentence before keeping it.";
  if (trimmed.length > 300) return "Keep a lesson to a sentence or two.";
  return factualReuseRefusal(trimmed);
}

export function activeLessons(lessons: ReviewLesson[]): ReviewLesson[] {
  return lessons.filter((lesson) => !lesson.revokedAt);
}

/**
 * The guidance block handed to a later review.
 *
 * It is labelled as this workspace's preferences, not as knowledge, and the
 * reviewer is told outright that none of it is a fact about the recipient.
 * Empty when nothing has been kept, so the prompt says nothing rather than
 * implying an empty rulebook is a rulebook.
 */
export function lessonGuidance(lessons: ReviewLesson[]): string {
  const live = activeLessons(lessons);
  if (live.length === 0) return "";
  const lines = live.map((lesson) => `- ${lesson.lesson}`).join("\n");
  return [
    "Preferences this workspace kept from earlier human decisions.",
    "These are about how to write, not facts. Never treat one as something",
    "the recipient said, and never carry one into the message as a claim.",
    lines,
  ].join("\n");
}
