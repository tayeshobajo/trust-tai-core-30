/**
 * Approval provenance on a Comms draft.
 *
 * Approved has to mean a person decided, not that a column changed. This
 * module is the whole law of that record, kept pure so the service, the
 * send gate and the composer all read the same thing:
 *
 *   - an approval names the human who made it and the moment they made it,
 *   - it is written in the same operation that sets the state, never after,
 *   - a draft that says "approved" with no such record is legacy, and is
 *     not sendable until a person approves it again.
 *
 * Nothing here sends, and nothing here backfills. An approval we cannot
 * attribute is not an approval we may act on.
 */

import type { ISODateTime } from "./entities";

/* ------------------------------------------------------------------ types */

export interface DraftApprovalActor {
  id: string;
  label?: string;
}

/** Written onto `comms_drafts.rationale.approval` when a human approves. */
export interface DraftApproval {
  state: "approved";
  by: DraftApprovalActor;
  at: ISODateTime;
  reason?: string;
}

/** What the composer says about an approval that predates this record. */
export const LEGACY_APPROVAL_NOTICE =
  "This draft was marked approved before Comms kept a record of who approved it. Approve it again before sending, so the decision has a name and a time on it.";

/** What the send path answers when asked to send a legacy approval. */
export const LEGACY_APPROVAL_REFUSAL =
  "This approval has no record of who made it or when, so Comms will not send it. Approve the draft again in Comms first.";

/* -------------------------------------------------------------------- io */

/** Read the approval stamp off a draft's rationale, if one is there. */
export function readDraftApproval(
  rationale: Record<string, unknown> | null | undefined,
): DraftApproval | null {
  const raw = rationale?.["approval"];
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (value["state"] !== "approved") return null;

  const by = value["by"];
  const actor = by && typeof by === "object" ? (by as Record<string, unknown>) : null;
  const id = typeof actor?.["id"] === "string" ? (actor["id"] as string).trim() : "";
  const at = typeof value["at"] === "string" ? (value["at"] as string) : "";
  // An approval without an actor or a time is not provenance, it is noise.
  if (!id || !at || Number.isNaN(new Date(at).getTime())) return null;

  const label = typeof actor?.["label"] === "string" ? (actor["label"] as string).trim() : "";
  const reason = typeof value["reason"] === "string" ? (value["reason"] as string).trim() : "";
  return {
    state: "approved",
    by: { id, ...(label ? { label } : {}) },
    at,
    ...(reason ? { reason } : {}),
  };
}

/** Merge an approval stamp into a draft's rationale, leaving the rest alone. */
export function writeDraftApproval(
  rationale: Record<string, unknown> | null | undefined,
  approval: DraftApproval,
): Record<string, unknown> {
  return {
    ...(rationale ?? {}),
    approval: {
      state: "approved",
      by: {
        id: approval.by.id,
        ...(approval.by.label ? { label: approval.by.label } : {}),
      },
      at: approval.at,
      ...(approval.reason ? { reason: approval.reason } : {}),
    },
  };
}

/**
 * Build the stamp for a human approval happening now. Refuses without a
 * signed-in actor: the writer of the draft is never the approver by default.
 */
export function buildDraftApproval(input: {
  actorId: string | null | undefined;
  actorLabel?: string | undefined;
  reason?: string | undefined;
  at?: ISODateTime;
}): DraftApproval {
  const id = (input.actorId ?? "").trim();
  if (!id) {
    throw new Error("An approval has to carry the person who made it. Sign in and try again.");
  }
  const label = input.actorLabel?.trim();
  const reason = input.reason?.trim();
  return {
    state: "approved",
    by: { id, ...(label ? { label } : {}) },
    at: input.at ?? new Date().toISOString(),
    ...(reason ? { reason } : {}),
  };
}

/* ------------------------------------------------------------- judgement */

/**
 * True when a draft claims to be approved but carries no provenance. These
 * are the rows written before this record existed. They stay exactly as
 * they are in storage; the app simply declines to act on them.
 */
export function isLegacyApproved(
  reviewState: string,
  rationale: Record<string, unknown> | null | undefined,
): boolean {
  return reviewState === "approved" && readDraftApproval(rationale) === null;
}

/** What the timeline says about an approval, in plain words. */
export function approvalProvenanceLabel(approval: DraftApproval | null): string {
  if (!approval) return "Approved, no record of who approved it";
  const who = approval.by.label ?? "a workspace member";
  return `Approved by ${who}`;
}
