/**
 * The review record: what was reviewed, which exact words, and who may say
 * it is good to go.
 *
 * Three laws live here, kept pure so the server, the screen and the send gate
 * all read the same thing:
 *
 *   1. A review run is bound to one immutable draft version. Edit the words
 *      and you have a new version; the old run keeps judging the old words.
 *   2. An approval names a person, a version, and a context fingerprint. If
 *      the words, the recipient, the goal or the source material move, the
 *      approval is stale and has to be made again. History is never rewritten
 *      to hide that.
 *   3. Approval authority is a role, not membership. Being able to edit a
 *      draft has never been the same thing as being able to approve it.
 *
 * Nothing here sends anything.
 */

import { normalizeRole, type WorkspaceRole } from "./access";
import { sourceChecksum } from "./comms-sources";
import type { ISODateTime } from "./entities";

/* ------------------------------------------------------------------ types */

export type ReviewSessionStatus = "open" | "approved" | "closed";
export type ReviewVersionOrigin = "intake" | "edit" | "revision";
export type ReviewRunStatus = "running" | "complete" | "failed";
export type FindingState = "open" | "accepted" | "kept" | "edited";
export type FindingSeverity = "must_fix" | "consider" | "note";

export interface ReviewSession {
  id: string;
  organizationId: string;
  relationshipId: string | null;
  threadId: string | null;
  title: string;
  situation: string | null;
  goal: string | null;
  recipientName: string | null;
  recipientEmail: string | null;
  status: ReviewSessionStatus;
  createdBy: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface ReviewVersion {
  id: string;
  sessionId: string;
  version: number;
  subject: string | null;
  body: string;
  origin: ReviewVersionOrigin;
  authorUserId: string | null;
  createdAt: ISODateTime;
}

export interface ReviewFinding {
  id: string;
  runId: string;
  versionId: string;
  kind: string;
  severity: FindingSeverity;
  excerpt: string | null;
  excerptStart: number | null;
  excerptEnd: number | null;
  why: string;
  suggestion: string | null;
  state: FindingState;
  position: number;
}

export interface ReviewRun {
  id: string;
  sessionId: string;
  versionId: string;
  status: ReviewRunStatus;
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  contextFingerprint: string | null;
  stages: string[];
  latencyMs: number | null;
  errorCode: string | null;
  summary: string | null;
  goalRead: string | null;
  coverage: Record<string, unknown>;
  limitations: string[];
  startedAt: ISODateTime;
  completedAt: ISODateTime | null;
}

export interface ReviewApproval {
  id: string;
  sessionId: string;
  versionId: string;
  runId: string | null;
  contextFingerprint: string;
  approvedBy: string;
  approvedAt: ISODateTime;
  approverRole: string | null;
  reason: string | null;
}

/* -------------------------------------------------------------- authority */

/**
 * Who may approve. Ordinary membership buys editing, not accountability.
 * This mirrors `private.is_org_admin` in the database, which is the real
 * boundary; this check only stops a pointless round trip.
 */
export const APPROVER_ROLES: WorkspaceRole[] = ["owner", "admin"];

export function canApproveReview(role: string | null | undefined): boolean {
  return APPROVER_ROLES.includes(normalizeRole(role));
}

export const APPROVAL_ROLE_REFUSAL =
  "Approving a message is an owner or admin decision. You can review and revise it, then ask one of them to approve.";

/* ------------------------------------------------------------ fingerprint */

export interface ReviewContext {
  versionId: string;
  subject: string | null;
  body: string;
  recipientEmail: string | null;
  recipientName: string | null;
  goal: string | null;
  /** Checksums of every source, read or not, in a stable order. */
  sourceChecksums: string[];
  /** The sender the message will go out as. */
  senderName: string | null;
}

/**
 * One stable string standing for "everything an approval was given over". Any
 * change to the words, the recipient, the goal, the sender or the source set
 * changes it, which is exactly what makes an old approval stale.
 */
export function contextFingerprint(context: ReviewContext): string {
  const parts = [
    context.versionId,
    (context.subject ?? "").trim(),
    context.body.trim(),
    (context.recipientEmail ?? "").trim().toLowerCase(),
    (context.recipientName ?? "").trim(),
    (context.goal ?? "").trim(),
    (context.senderName ?? "").trim(),
    [...context.sourceChecksums].sort().join(","),
  ];
  return sourceChecksum(parts.join("\u0000"));
}

/* -------------------------------------------------------------- freshness */

export type ApprovalFreshness = "none" | "fresh" | "stale_version" | "stale_context";

export interface ApprovalReading {
  freshness: ApprovalFreshness;
  approval: ReviewApproval | null;
  /** What a person is told, in plain words. */
  note: string;
  /** Whether a send gate downstream may treat this as approved. */
  sendable: boolean;
}

/**
 * Read the latest approval against where the work stands now. A newer version
 * or a changed context does not delete the approval; it stops counting.
 */
export function readApproval(input: {
  approvals: ReviewApproval[];
  currentVersionId: string;
  currentFingerprint: string;
}): ApprovalReading {
  const latest = [...input.approvals].sort((a, b) =>
    a.approvedAt < b.approvedAt ? 1 : a.approvedAt > b.approvedAt ? -1 : 0,
  )[0];

  if (!latest) {
    return {
      freshness: "none",
      approval: null,
      note: "Not approved yet.",
      sendable: false,
    };
  }

  if (latest.versionId !== input.currentVersionId) {
    return {
      freshness: "stale_version",
      approval: latest,
      note: "The draft has been edited since it was approved. Approve the current version before it goes anywhere.",
      sendable: false,
    };
  }

  if (latest.contextFingerprint !== input.currentFingerprint) {
    return {
      freshness: "stale_context",
      approval: latest,
      note: "The recipient, goal, sender or source material changed after approval, so the approval no longer covers this message.",
      sendable: false,
    };
  }

  return {
    freshness: "fresh",
    approval: latest,
    note: "Approved for exactly these words.",
    sendable: true,
  };
}

/* ---------------------------------------------------------------- editing */

/** The next version number for a session. Versions never reuse a number. */
export function nextVersionNumber(versions: { version: number }[]): number {
  return versions.reduce((highest, entry) => Math.max(highest, entry.version), 0) + 1;
}

/** The version a run judged, or null when that version is gone from view. */
export function versionForRun(
  run: Pick<ReviewRun, "versionId">,
  versions: ReviewVersion[],
): ReviewVersion | null {
  return versions.find((version) => version.id === run.versionId) ?? null;
}

/**
 * A run may only be acted on when it judged the words on screen. This is what
 * stops a late response replacing newer work, and what stops "accept this
 * change" landing on a paragraph the reviewer never saw.
 */
export function runAppliesToCurrentVersion(
  run: Pick<ReviewRun, "versionId"> | null,
  currentVersionId: string,
): boolean {
  return Boolean(run && run.versionId === currentVersionId);
}

export const STALE_RUN_NOTE =
  "This review read an earlier version of the draft. Run it again to judge the words as they stand.";
