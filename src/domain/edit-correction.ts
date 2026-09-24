/**
 * Edit-learning capture: what a human changed IS the lesson.
 *
 * Pure. When a person approves a draft whose words differ from what the
 * engine drafted, or discards a draft after review, the difference is a
 * correction record. The weekly review turns records into principles; this
 * module only captures them honestly.
 *
 * `learned_principle` is null on capture by design: a single edit is data,
 * not yet a rule. One result is never a rule.
 */

export interface EditCorrectionSituation {
  register: string;
  intent: string;
  /** The DECIDE action that led to this draft, when one was recorded. */
  decideAction: string | null;
  /** One-line World Card shape summary, when a card was on the draft. */
  worldCardSummary: string | null;
}

export interface EditCorrectionRecord {
  decision: "approved_with_edits" | "discarded";
  situation: EditCorrectionSituation;
  draft_excerpt: string;
  approved_excerpt: string | null;
  diff_summary: string;
  learned_principle: null;
  captured_at: string;
}

const EXCERPT_LIMIT = 500;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/** A plain sentence-level diff summary. Honest and small, not a real diff. */
function summarizeDiff(drafted: string, approved: string): string {
  const before = sentences(drafted);
  const after = sentences(approved);
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const removed = before.filter((sentence) => !afterSet.has(sentence));
  const added = after.filter((sentence) => !beforeSet.has(sentence));
  const parts: string[] = [];
  if (removed.length > 0) parts.push(`${removed.length} sentence(s) removed or rewritten`);
  if (added.length > 0) parts.push(`${added.length} sentence(s) added or rewritten`);
  if (parts.length === 0) parts.push("wording changed within existing sentences");
  const sample = added[0] ?? removed[0];
  return `${parts.join("; ")}${sample ? `. Example change: "${sample.slice(0, 160)}"` : "."}`;
}

export interface BuildEditCorrectionInput {
  situation: EditCorrectionSituation;
  draftedBody: string;
  /** The body as approved, or null when the draft was discarded. */
  approvedBody: string | null;
  decision: "approved" | "discarded";
  now?: string;
}

/**
 * Build a correction record, or null when there is nothing to learn: an
 * approval whose words match the drafted words exactly is agreement, not a
 * correction.
 */
export function buildEditCorrection(input: BuildEditCorrectionInput): EditCorrectionRecord | null {
  const capturedAt = input.now ?? new Date().toISOString();
  const drafted = input.draftedBody.trim();
  if (!drafted) return null;

  if (input.decision === "discarded") {
    return {
      decision: "discarded",
      situation: input.situation,
      draft_excerpt: drafted.slice(0, EXCERPT_LIMIT),
      approved_excerpt: null,
      diff_summary: "The draft was discarded after human review; nothing was approved.",
      learned_principle: null,
      captured_at: capturedAt,
    };
  }

  const approved = (input.approvedBody ?? "").trim();
  if (!approved || approved === drafted) return null;

  return {
    decision: "approved_with_edits",
    situation: input.situation,
    draft_excerpt: drafted.slice(0, EXCERPT_LIMIT),
    approved_excerpt: approved.slice(0, EXCERPT_LIMIT),
    diff_summary: summarizeDiff(drafted, approved),
    learned_principle: null,
    captured_at: capturedAt,
  };
}

/** One line for the retrieval layer, where a correction outranks inference. */
export function correctionLesson(record: EditCorrectionRecord): string {
  const context = [
    record.situation.register,
    record.situation.decideAction ? `decide:${record.situation.decideAction}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  if (record.decision === "discarded") {
    return `A ${context} draft was discarded by a human after review. Draft excerpt: "${record.draft_excerpt.slice(0, 200)}"`;
  }
  return `A human edited a ${context} draft before approving it. ${record.diff_summary}`;
}
