/**
 * Dimensional capture: the judgment memory, recorded from day one.
 *
 * The four-memories model needs more than a binary approved/edited history.
 * Every decision and every draft leaves one dimensional record: how the
 * voice, truth and judgment layers read the moment, what actually happened,
 * and whether Tai had to intervene. Graduation still runs on the existing
 * streak mechanism; this record is the raw material a later phase scores.
 *
 * Pure. Records live additively inside existing jsonb (draft rationale, or
 * the relationship.decide activities payload when no draft exists). Each
 * dimension stays null until it is honestly known: outcome in particular is
 * always null at capture time and is filled later from replies and results.
 */

export type TaiIntervention =
  | "none"
  | "approved_unedited"
  | "edited"
  | "rejected"
  | "escalated";

export interface DimensionalContext {
  register: string;
  decide_action: string;
  relationship_stage: string | null;
  /** Archetype or vertical when the workspace knows one; null otherwise. */
  archetype: string | null;
}

export interface DimensionalRecord {
  /** Voice gate reading ("pass"), or null when no words exist yet. */
  voice: string | null;
  /** Truth-discipline reading ("pass"), or null when no words exist yet. */
  truth: string | null;
  /** Judgment quality of the decide verdict. Null until reviewed. */
  judgment: string | null;
  /** What actually happened. Always null at capture; filled later. */
  outcome: string | null;
  context: DimensionalContext;
  /** Confidence from decideAction, 0..1. */
  confidence: number;
  tai_intervention: TaiIntervention;
  captured_at: string;
}

export interface BuildDimensionalInput {
  register: string;
  decideAction: string;
  relationshipStage: string | null;
  archetype?: string | null;
  confidence: number;
  /** "pass" when a drafted body passed the voice gate; null when no draft. */
  voice?: string | null;
  /** "pass" when a drafted body passed the truth check; null when no draft. */
  truth?: string | null;
  escalated?: boolean;
  now?: string;
}

export function buildDimensionalRecord(input: BuildDimensionalInput): DimensionalRecord {
  return {
    voice: input.voice ?? null,
    truth: input.truth ?? null,
    judgment: null,
    outcome: null,
    context: {
      register: input.register,
      decide_action: input.decideAction,
      relationship_stage: input.relationshipStage,
      archetype: input.archetype ?? null,
    },
    confidence: Math.max(0, Math.min(1, input.confidence)),
    tai_intervention: input.escalated ? "escalated" : "none",
    captured_at: input.now ?? new Date().toISOString(),
  };
}

/**
 * The intervention a human review decision implies. Approval of unchanged
 * words is agreement; approval of changed words is an edit; a discard is a
 * rejection. Anything else leaves the record as it was.
 */
export function interventionForReview(
  reviewState: string,
  editedWords: boolean,
): TaiIntervention | null {
  if (reviewState === "approved") return editedWords ? "edited" : "approved_unedited";
  if (reviewState === "discarded") return "rejected";
  return null;
}

/**
 * Apply a review decision onto a stored dimensional record, tolerant of the
 * jsonb round trip. Returns null when there is no record or no transition,
 * so callers write nothing rather than inventing a record after the fact.
 */
export function withIntervention(
  stored: unknown,
  reviewState: string,
  editedWords: boolean,
): Record<string, unknown> | null {
  if (!stored || typeof stored !== "object") return null;
  const intervention = interventionForReview(reviewState, editedWords);
  if (!intervention) return null;
  return { ...(stored as Record<string, unknown>), tai_intervention: intervention };
}
