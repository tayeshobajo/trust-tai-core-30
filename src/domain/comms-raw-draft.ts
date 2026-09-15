/**
 * Saving your own writing, with no model involved.
 *
 * Someone who has already written the reply should not have to ask Comms to
 * write one in order to keep it. This builds the same draft record the
 * prepared path builds, from typed words only: same table, same services,
 * same review boundary. No second draft store exists.
 *
 * Nothing here is sent, and nothing here calls a provider.
 */

import type { VoiceRegister } from "@/domain/voice";

export interface RawDraftInput {
  register: VoiceRegister;
  /** Exactly what the person typed. Whitespace at the ends is trimmed. */
  text: string;
  /** Optional subject, only used where a subject exists. */
  subject?: string | undefined;
}

export interface RawDraftRecord {
  register: VoiceRegister;
  intent: string;
  subject: string | undefined;
  body: string;
  reviewState: "needs_human_review";
  rationale: Record<string, unknown>;
  evidence: never[];
}

/** The first line, shortened, so the record is recognisable in a list. */
function intentFrom(text: string): string {
  const first = text.split("\n").find((line) => line.trim().length > 0)?.trim() ?? "";
  if (!first) return "Written reply";
  return first.length > 72 ? `${first.slice(0, 71).trimEnd()}…` : first;
}

/**
 * The draft record for writing a person did themselves.
 *
 * It carries no judgment, no grounding and no evidence, because none was
 * produced: claiming any would attribute a machine reading to a human
 * sentence. It waits at the same human boundary as every other draft.
 */
export function rawWritingDraft(input: RawDraftInput): RawDraftRecord {
  const body = input.text.trim();
  if (!body) throw new Error("There is nothing written to save.");
  const subject = input.subject?.trim();
  return {
    register: input.register,
    intent: subject || intentFrom(body),
    subject: subject || undefined,
    body,
    reviewState: "needs_human_review",
    /* Authorship is recorded, not inferred later. No violations were checked
       because nothing was generated to check. */
    rationale: { writtenBy: "person", generated: false, source: "reply_bar" },
    evidence: [],
  };
}
