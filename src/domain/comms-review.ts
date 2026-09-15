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
import type { ProposalStructuredSource } from "./comms-proposal-source";

import type { DraftKind } from "./comms-draft-kind";
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
  /**
   * Incremented by the database whenever anything a review depends on moves:
   * a new version, a source added or removed, or the goal, recipient or
   * situation edited. An approval is only good for the revision it was made
   * against.
   */
  contextRevision: number;
  /** The Comms draft this review governs, when it was opened from one. */
  draftId: string | null;
  /** The door this message is meant to leave by, when one is intended. */
  intendedChannel: string | null;
  /**
   * Message, email or proposal. Null on rows written before the column
   * existed, so an old review reads as "not recorded" rather than a guess.
   */
  kind: DraftKind | null;
  /** The identity it would go out as. Part of what gets approved. */
  senderIdentity: string | null;
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
  /**
   * The sections these words were rendered from, when they were written as
   * sections and this workspace could store them. Null means the structure
   * was not recorded: the words stand, but they cannot be rebuilt from it.
   */
  structuredSource: ProposalStructuredSource | null;
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

/**
 * A private note about possible future work. It belongs to the author, never
 * to the message: nothing here is ever inserted into a draft, and it is
 * withheld entirely when the client is unhappy.
 */
export interface ReviewOpportunity {
  /** Exact words from the source material this rests on. */
  evidence: string;
  /** The reviewer's reading of it, for a person to accept or discard. */
  reading: string;
  /** What it could be worth, in the packet's own terms, or "unknown". */
  worth: string;
  /** When it would be right to raise it, or "not now". */
  timing: string;
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
  /** The session context revision this run read. */
  contextRevision: number | null;
  stages: string[];
  latencyMs: number | null;
  errorCode: string | null;
  summary: string | null;
  goalRead: string | null;
  coverage: Record<string, unknown>;
  limitations: string[];
  /**
   * Private notes about possible future work, and whether they were recorded
   * at all. `null` means this run has no record of them: it predates the
   * column, or the write did not land. An empty array means the run kept its
   * notes and raised none. The two must never read the same.
   */
  opportunities: ReviewOpportunity[] | null;
  startedAt: ISODateTime;
  completedAt: ISODateTime | null;
}

export interface ReviewApproval {
  id: string;
  sessionId: string;
  versionId: string;
  runId: string | null;
  contextFingerprint: string;
  /** The session context revision this approval was given against. */
  contextRevision: number | null;
  /** The exact outbound message this approval covers, if it was recorded. */
  payloadFingerprint: string | null;
  /** The door that payload was approved for. */
  payloadChannel: string | null;
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
  /** The situation the writer described. Editing it changes the judgement. */
  situation: string | null;
  /** Checksums of every source, read or not, in a stable order. */
  sourceChecksums: string[];
  /** The verified sender the message will go out as. */
  senderName: string | null;
  /** The author of record, not whoever happens to be reviewing. */
  senderUserId?: string | null;
  /** The exact stored voice rules the review was held against, if any. */
  voiceVersion: string | null;
  /**
   * The exact set of kept writing habits the review was held against. Keeping
   * or revoking one changes this, which makes earlier runs and approvals
   * stale instead of leaving them looking current against guidance that has
   * since moved.
   */
  lessonSetStamp?: string | null;
}

/**
 * One stable string standing for "everything an approval was given over". Any
 * change to the words, the recipient, the goal, the situation, the sender,
 * the voice rules or the source set changes it, which is exactly what makes an old approval stale.
 */
export function contextFingerprint(context: ReviewContext): string {
  const parts = [
    context.versionId,
    (context.subject ?? "").trim(),
    context.body.trim(),
    (context.recipientEmail ?? "").trim().toLowerCase(),
    (context.recipientName ?? "").trim(),
    (context.goal ?? "").trim(),
    (context.situation ?? "").trim(),
    (context.senderName ?? "").trim(),
    (context.senderUserId ?? "").trim(),
    (context.voiceVersion ?? "").trim(),
    [...context.sourceChecksums].sort().join(","),
    /* Absent only for callers that predate kept habits; the review paths
       always supply it, including "unsupported" and "none". */
    ...(context.lessonSetStamp === undefined ? [] : [(context.lessonSetStamp ?? "").trim()]),
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
  /** The session's context revision as it stands now. */
  currentRevision: number;
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

  if (latest.contextRevision !== null && latest.contextRevision !== input.currentRevision) {
    return {
      freshness: "stale_context",
      approval: latest,
      note: "The review context changed after this approval, so it no longer covers the message. Review it again and approve the current state.",
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

/**
 * A run only speaks for the work on screen when it judged this version, this
 * fingerprint and this revision. Any of the three moving makes it history.
 */
export function reviewRunIsCurrent(input: {
  run: Pick<ReviewRun, "versionId" | "contextFingerprint" | "contextRevision" | "status"> | null;
  currentVersionId: string;
  currentFingerprint: string;
  currentRevision: number;
}): boolean {
  const run = input.run;
  if (!run || run.status !== "complete") return false;
  if (run.versionId !== input.currentVersionId) return false;
  if (run.contextFingerprint && run.contextFingerprint !== input.currentFingerprint) return false;
  if (run.contextRevision !== null && run.contextRevision !== input.currentRevision) return false;
  return true;
}

/* -------------------------------------------------------------- readiness */

export interface ApprovalReadiness {
  ready: boolean;
  /** Plain sentences naming everything standing between here and approval. */
  blockers: string[];
}

/**
 * What has to be true before a person may approve. Deliberately strict:
 *
 *   - there is a completed review of exactly this state, not an older one,
 *     and not no review at all. A missing review is never "optional",
 *   - every source was genuinely read; an unread attachment means the review
 *     did not see the whole picture,
 *   - every obligation is answered. Uncertain and pending are not answered,
 *   - the current review found nothing marked must fix. Accepting or keeping
 *     a must fix does not clear it: a must fix is cleared only by changing
 *     the words and running a fresh review that no longer raises it. Marking
 *     your own homework has never been evidence.
 *
 * This is a review-approval gate. It is not, on its own, permission to send.
 */
export function approvalReadiness(input: {
  run: Pick<ReviewRun, "versionId" | "contextFingerprint" | "contextRevision" | "status"> | null;
  currentVersionId: string;
  currentFingerprint: string;
  currentRevision: number;
  findings: Pick<ReviewFinding, "severity" | "state" | "versionId">[];
  sources: { status: string }[];
  /**
   * Coverage as the database will judge it: every ask either answered or
   * explicitly pending the other side's confirmation, and every verdict
   * reached semantically. A lexical guess never counts.
   */
  coverage: {
    outstanding: number;
    uncertain: number;
    verdicts: { status: string; method: string }[];
  };
}): ApprovalReadiness {
  const blockers: string[] = [];

  if (!input.run) {
    blockers.push("This draft has not been reviewed yet. Run a review before approving it.");
  } else if (input.run.status !== "complete") {
    blockers.push(
      input.run.status === "failed"
        ? "The last review did not complete, so there is nothing to approve against. Run it again."
        : "A review is still running. Wait for it to finish.",
    );
  } else if (
    !reviewRunIsCurrent({
      run: input.run,
      currentVersionId: input.currentVersionId,
      currentFingerprint: input.currentFingerprint,
      currentRevision: input.currentRevision,
    })
  ) {
    blockers.push(STALE_RUN_NOTE);
  }

  const unread = input.sources.filter((source) => source.status !== "parsed").length;
  if (unread > 0) {
    blockers.push(
      unread === 1
        ? "One piece of source material could not be read, so the review did not cover it. Paste its text, or remove it."
        : `${unread} pieces of source material could not be read, so the review did not cover them. Paste their text, or remove them.`,
    );
  }

  const settled = input.coverage.verdicts.every(
    (verdict) => verdict.status === "answered" || verdict.status === "pending_confirmation",
  );
  if (!settled) {
    const parts: string[] = [];
    if (input.coverage.outstanding > 0) parts.push(`${input.coverage.outstanding} unanswered`);
    if (input.coverage.uncertain > 0) parts.push(`${input.coverage.uncertain} not verifiable`);
    blockers.push(
      parts.length > 0
        ? `The reply does not yet cover everything asked: ${parts.join(", ")}.`
        : "The reply does not yet cover everything that was asked.",
    );
  }
  const guessed = input.coverage.verdicts.filter((verdict) => verdict.method !== "semantic").length;
  if (guessed > 0) {
    blockers.push(
      "Some asks were only matched by wording, not judged. Run the review again so each one is properly read.",
    );
  }

  /* A must fix on the current review blocks approval whatever was clicked.
     Accepting or keeping one is a note about intent, not proof the problem
     is gone; only changed words and a fresh review are that. */
  const mustFix = input.findings.filter((finding) => finding.severity === "must_fix").length;
  if (mustFix > 0) {
    blockers.push(
      mustFix === 1
        ? "This review raised one must-fix finding. Change the words and review again; marking it accepted or kept does not clear it."
        : `This review raised ${mustFix} must-fix findings. Change the words and review again; marking them accepted or kept does not clear them.`,
    );
  }

  return { ready: blockers.length === 0, blockers };
}

/**
 * What approval here does and does not mean. Kept as one sentence so the
 * screen, the docs and any future send gate say the same thing.
 */
export const APPROVAL_SCOPE_NOTE =
  "Approving records that a person judged these exact words fit to send. It is not a send: no Comms send path reads this approval yet.";

/* ------------------------------------------------- private notes, honestly */

export type PrivateNotesState = "no_run" | "not_recorded" | "evaluated_none" | "notes";

export interface PrivateNotesReading {
  state: PrivateNotesState;
  /** What the panel says, in the author's words. */
  note: string;
  notes: ReviewOpportunity[];
}

/**
 * What a run can honestly say about its private notes.
 *
 * "No notes" has two very different meanings and they are kept apart: a run
 * that recorded its notes and raised none, and a run that never had anywhere
 * to record them. The second is not evidence of a quiet reviewer.
 */
export function privateNotesReading(run: ReviewRun | null | undefined): PrivateNotesReading {
  if (!run) return { state: "no_run", note: "", notes: [] };
  if (run.opportunities === null) {
    return {
      state: "not_recorded",
      note: "This review did not record private notes, so there is nothing to show. That is not the same as the reviewer raising none.",
      notes: [],
    };
  }
  if (run.opportunities.length === 0) {
    return {
      state: "evaluated_none",
      note: "This review kept its private notes and raised none.",
      notes: [],
    };
  }
  return {
    state: "notes",
    note: "Private notes. None of this is in the message, and none of it goes anywhere unless you put it there yourself.",
    notes: run.opportunities,
  };
}
