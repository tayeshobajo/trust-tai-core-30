/**
 * Real-data meeting workroom projection (pure, browser-safe).
 *
 * Built only from stored conversations and person-confirmed commitments.
 * Nothing here infers an owner, a date or a completion. A score is only
 * given when transcript coverage is known to be complete; today the stored
 * Fathom record carries no recording length, so coverage is "unknown" and
 * the meeting shows progress counts without claiming a score.
 */

import type { Commitment } from "./steward";

export type WorkroomCoverage = "complete" | "partial" | "unknown";

export interface WorkroomConversationInput {
  id: string;
  title: string;
  occurredAt: string;
  provider: string;
  sourceUrl: string;
  participantCount: number;
  segmentCount: number;
  lastSegmentAt: string | null;
  /** Recording length in seconds when the source provided one. */
  recordingSeconds?: number | null;
}

export interface WorkroomRow {
  id: string;
  what: string;
  owner: { label: string; verified: boolean };
  due: { label: string; exact: boolean };
  status: Commitment["status"];
  done: boolean;
  evidenceCount: number;
  sourceKey: string;
}

export interface WorkroomMeeting extends WorkroomConversationInput {
  rows: WorkroomRow[];
  agreed: number;
  done: number;
  coverage: WorkroomCoverage;
  /** Null unless coverage is complete and at least one agreed item exists. */
  score: number | null;
  remark: string;
}

function seconds(at: string | null): number | null {
  if (!at) return null;
  const parts = at.split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((total, n) => total * 60 + n, 0);
}

export function coverageOf(input: WorkroomConversationInput): WorkroomCoverage {
  if (input.segmentCount === 0) return "partial";
  const length = input.recordingSeconds ?? null;
  const last = seconds(input.lastSegmentAt);
  if (!length || last === null) return "unknown";
  return last >= length - 120 ? "complete" : "partial";
}

export function toRow(c: Commitment): WorkroomRow {
  return {
    id: c.id,
    what: c.what,
    owner: c.ownerUserId
      ? { label: c.ownerName || "Linked teammate", verified: true }
      : { label: c.ownerName ? `${c.ownerName} (said)` : "Owner not named", verified: false },
    due: c.dueAt
      ? { label: c.dueAt.slice(0, 10), exact: true }
      : { label: c.dueText ? `“${c.dueText}”` : "No date", exact: false },
    status: c.status,
    done: c.status === "kept",
    evidenceCount: c.evidence.length,
    sourceKey: c.sourceKey,
  };
}

export function buildWorkroom(
  conversations: WorkroomConversationInput[],
  commitments: Commitment[],
): WorkroomMeeting[] {
  return conversations.map((conversation) => {
    const rows = commitments
      .filter((c) => c.conversationId === conversation.id)
      .map(toRow);
    const counted = rows.filter((r) => r.status !== "released");
    const done = counted.filter((r) => r.done).length;
    const coverage = coverageOf(conversation);
    const allDone = counted.length > 0 && done === counted.length;
    const score =
      coverage === "complete" && counted.length > 0
        ? allDone
          ? 100
          : Math.min(99, Math.round((done / counted.length) * 100))
        : null;
    const open = counted.length - done;
    const remark =
      counted.length === 0
        ? "No promises confirmed from this meeting yet. Review it to confirm what was agreed."
        : coverage !== "complete"
          ? `${done} of ${counted.length} kept. Transcript coverage is not confirmed, so no score is given.`
          : allDone
            ? "Every confirmed promise is kept."
            : `${open} confirmed promise${open === 1 ? "" : "s"} still open before 100.`;
    return { ...conversation, rows, agreed: counted.length, done, coverage, score, remark };
  });
}
