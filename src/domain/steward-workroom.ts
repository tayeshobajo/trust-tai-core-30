/**
 * Real-data meeting workroom projection (pure, browser-safe).
 *
 * Built only from stored conversations, person-confirmed commitments and
 * actual completion receipts. Nothing here infers an owner, a date or a
 * completion. A commitment marked "kept" without a valid current completion
 * receipt is shown as needing verification, never as verified.
 *
 * Coverage and score are separate things:
 * - Coverage describes whether the stored transcript is known to cover the
 *   whole recording. It is "complete" only when a trustworthy source
 *   contract explicitly says so. A non-empty transcript is never treated as
 *   recording-complete, and no timestamp heuristic is used.
 * - The score measures verified agreed work against the real denominator of
 *   confirmed promises. It never implies every task in the transcript was
 *   extracted, and it can never reach 100 while coverage is unconfirmed or
 *   unreviewed proposals remain.
 */

import type { Commitment } from "./steward";
import type { BoardTask } from "./cmd-tasks";

export type WorkroomCoverage = "complete" | "unknown";

/** A completion receipt as stored in steward_task_state. */
export interface CompletionReceipt {
  taskKey: string;
  completedAt?: string | undefined;
  completionNote?: string | undefined;
  completedBy?: string | undefined;
}

/** Receipts count only with a real timestamp and a substantive note. */
export const MIN_COMPLETION_NOTE_LENGTH = 10;

export function validReceipt(receipt: CompletionReceipt | undefined): boolean {
  if (!receipt?.completedAt) return false;
  if (Number.isNaN(Date.parse(receipt.completedAt))) return false;
  return (receipt.completionNote ?? "").trim().length >= MIN_COMPLETION_NOTE_LENGTH;
}

/**
 * Build the receipt lookup for the workroom. When the receipt read FAILED,
 * the map is deliberately empty: no cached or partial receipt may qualify a
 * row as verified, so green badges, verified counts, proof panels and score
 * inputs are all suppressed together rather than shown stale. Verified
 * requires a kept status AND a real receipt — an empty map means nothing
 * qualifies, which is the honest "unavailable" state.
 */
export function receiptMapFrom(
  rows: readonly CompletionReceipt[] | undefined,
  failed: boolean,
): Map<string, CompletionReceipt> {
  const map = new Map<string, CompletionReceipt>();
  if (failed) return map;
  for (const r of rows ?? []) {
    map.set(r.taskKey, {
      taskKey: r.taskKey,
      completedAt: r.completedAt,
      completionNote: r.completionNote,
      completedBy: r.completedBy,
    });
  }
  return map;
}

export interface WorkroomConversationInput {
  id: string;
  title: string;
  occurredAt: string;
  provider: string;
  sourceUrl: string;
  participantCount: number;
  segmentCount: number;
  lastSegmentAt: string | null;
  /**
   * True only when a trustworthy source contract certifies the stored
   * transcript covers the whole recording. Anything else is unknown.
   */
  coverageConfirmed?: boolean;
}

export interface WorkroomRow {
  /** Follow-up context only; the obligation remains counted at its original meeting. */
  forwardedFrom?: string;
  kind?: "commitment" | "business-task" | "required-task";
  boardTask?: BoardTask;
  id: string;
  what: string;
  owner: { label: string; verified: boolean };
  due: { label: string; exact: boolean };
  status: string;
  /** Status says kept. */
  kept: boolean;
  /** Kept AND a valid current completion receipt exists. Only this turns green. */
  verified: boolean;
  /** The actual completion receipt, when one validly exists. */
  receipt: CompletionReceipt | null;
  evidenceCount: number;
  sourceKey: string;
}

export interface WorkroomMeeting extends WorkroomConversationInput {
  linkedWork?: { total: number; open: number };
  requiredWork?: { total: number; verified: 0; denominator: number };
  rows: WorkroomRow[];
  agreed: number;
  /** Verified completions only. */
  done: number;
  /** Marked kept but without a valid completion receipt. */
  needsVerification: number;
  coverage: WorkroomCoverage;
  /** Unreviewed extracted passages, outside the denominator. */
  openProposals: number;
  /**
   * Verified agreed work as a percentage of confirmed promises. Null when
   * nothing is confirmed. Capped below 100 while coverage is unconfirmed or
   * proposals await review — 100 means genuinely nothing left to check.
   */
  score: number | null;
  remark: string;
}

export function coverageOf(input: WorkroomConversationInput): WorkroomCoverage {
  return input.coverageConfirmed === true ? "complete" : "unknown";
}

/** The task-state key a completion receipt is stored under. */
export function receiptKey(commitmentId: string): string {
  return `commitment:${commitmentId}`;
}

export function toRow(
  c: Commitment,
  receipts?: ReadonlyMap<string, CompletionReceipt>,
): WorkroomRow {
  const kept = c.status === "kept";
  const receipt = receipts?.get(receiptKey(c.id)) ?? null;
  const verified = kept && validReceipt(receipt ?? undefined);
  return {
    kind: "commitment",
    id: c.id,
    what: c.what,
    owner: c.ownerUserId
      ? { label: c.ownerName || "Linked teammate", verified: true }
      : { label: c.ownerName ? `${c.ownerName} (said)` : "Owner not named", verified: false },
    due: c.dueAt
      ? { label: c.dueAt.slice(0, 10), exact: true }
      : { label: c.dueText ? `“${c.dueText}”` : "No date", exact: false },
    status: c.status,
    kept,
    verified,
    receipt: verified ? receipt : null,
    evidenceCount: c.evidence.length,
    sourceKey: c.sourceKey,
  };
}

export function buildWorkroom(
  conversations: WorkroomConversationInput[],
  commitments: Commitment[],
  receipts?: ReadonlyMap<string, CompletionReceipt>,
  openProposals?: ReadonlyMap<string, number>,
): WorkroomMeeting[] {
  return conversations.map((conversation) => {
    const rows = commitments
      .filter((c) => c.conversationId === conversation.id)
      .map((c) => toRow(c, receipts));
    const counted = rows.filter((r) => r.status !== "released");
    const done = counted.filter((r) => r.verified).length;
    const needsVerification = counted.filter((r) => r.kept && !r.verified).length;
    const coverage = coverageOf(conversation);
    const proposals = openProposals?.get(conversation.id) ?? 0;
    const allDone = counted.length > 0 && done === counted.length;
    const raw = counted.length > 0 ? Math.round((done / counted.length) * 100) : null;
    /* 100 is reserved for: every confirmed promise verified, transcript
       coverage certified, and no unreviewed proposals. Anything less is
       honest partial progress, never a rounded-up closure. */
    const closable = allDone && coverage === "complete" && proposals === 0;
    const score = raw === null ? null : closable ? 100 : Math.min(99, raw);
    const open = counted.length - done;
    const remark =
      counted.length === 0
        ? "No promises confirmed from this meeting yet. Review it to confirm what was agreed."
        : needsVerification > 0
          ? `${done} of ${counted.length} verified. ${needsVerification} marked kept without a completion record — verify before it counts.`
          : score === 100
            ? "Every confirmed promise is verified complete."
            : `${done} of ${counted.length} verified. ${open} still open${
                coverage !== "complete" ? ", transcript coverage is not confirmed" : ""
              }${proposals > 0 ? `, ${proposals} unreviewed proposal${proposals === 1 ? "" : "s"}` : ""}.`;
    return {
      ...conversation,
      rows,
      agreed: counted.length,
      done,
      needsVerification,
      coverage,
      openProposals: proposals,
      score,
      remark,
    };
  });
}
