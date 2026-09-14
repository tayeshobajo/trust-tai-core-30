/**
 * What a piece of unsent writing is.
 *
 * A message, an email or a proposal. The kind changes what the intake asks
 * for and how the draft is composed; it never changes who may approve it or
 * how it is sent.
 */

export type DraftKind = "message" | "email" | "proposal";

export const DRAFT_KINDS: DraftKind[] = ["message", "email", "proposal"];

export const DRAFT_KIND_LABEL: Record<DraftKind, string> = {
  message: "Message",
  email: "Email",
  proposal: "Proposal",
};

/** Anything unrecognised reads as a message. Older rows have no kind at all. */
export function parseDraftKind(value: unknown): DraftKind {
  return typeof value === "string" && (DRAFT_KINDS as string[]).includes(value)
    ? (value as DraftKind)
    : "message";
}

/** Null for rows written before the column existed, so reads stay honest. */
export function readDraftKind(value: unknown): DraftKind | null {
  return typeof value === "string" && (DRAFT_KINDS as string[]).includes(value)
    ? (value as DraftKind)
    : null;
}
