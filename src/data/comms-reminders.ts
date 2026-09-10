/**
 * Reasons to reconnect.
 *
 * A reminder must rest on something true. If nothing true has happened, the
 * relationship sits quietly and no reminder is produced. Comms surfaces a
 * reason; it never manufactures a reason to keep a cadence alive.
 */

import {
  DORMANT_AFTER_DAYS,
  daysBetween,
  REASON_LABEL,
  type MemoryItem,
  type ReasonCode,
  type Relationship,
} from "@/domain/comms";
import type { EvidenceRef } from "@/domain/confidence";

export interface ReminderCandidate {
  reasonCode: ReasonCode;
  reasonText: string;
  evidence: EvidenceRef[];
  dueAt?: string;
}

/** Days without a reply before an outbound thread is worth revisiting. */
export const NO_REPLY_AFTER_DAYS = 10;

function memoryEvidence(item: MemoryItem): EvidenceRef[] {
  return item.evidence.length > 0
    ? item.evidence
    : [{ label: item.label, kind: item.tier === "decided" ? "human" : "computed" }];
}

function findCommitment(relationship: Relationship): MemoryItem | undefined {
  return relationship.decided.find((item) =>
    /commit|promised|said we would|owe|send|share/i.test(`${item.label} ${item.value}`),
  );
}

function findSignal(relationship: Relationship): MemoryItem | undefined {
  return relationship.observed.find((item) =>
    /hiring|funding|launch|award|opened|acquired|new site|announced/i.test(
      `${item.label} ${item.value}`,
    ),
  );
}

function findRoleChange(relationship: Relationship): MemoryItem | undefined {
  return [...relationship.observed, ...relationship.decided].find((item) =>
    /new role|promoted|now (leads|heads)|joined as|title chang/i.test(
      `${item.label} ${item.value}`,
    ),
  );
}

/**
 * Every truthful reason to write this person today, strongest first.
 * An empty array is a valid and common answer.
 */
export function reasonsToReconnect(
  relationship: Relationship,
  now: Date = new Date(),
): ReminderCandidate[] {
  if (relationship.stage === "archived") return [];

  const reasons: ReminderCandidate[] = [];
  const lastTouch = relationship.lastTouchAt;
  const sinceTouch = daysBetween(lastTouch ?? relationship.createdAt, now);

  const commitment = findCommitment(relationship);
  if (commitment) {
    reasons.push({
      reasonCode: "commitment_made",
      reasonText: `${REASON_LABEL.commitment_made}: ${commitment.value}`,
      evidence: memoryEvidence(commitment),
      ...(relationship.responseDueAt ? { dueAt: relationship.responseDueAt } : {}),
    });
  }

  if (relationship.responseDueAt && new Date(relationship.responseDueAt) <= now) {
    reasons.push({
      reasonCode: "inbound_unanswered",
      reasonText: `${REASON_LABEL.inbound_unanswered}. A reply was due ${new Date(relationship.responseDueAt).toLocaleDateString()}.`,
      evidence: [{ label: "Response due date on this relationship", kind: "computed" }],
      dueAt: relationship.responseDueAt,
    });
  }

  const signal = findSignal(relationship);
  if (signal) {
    reasons.push({
      reasonCode: "company_signal",
      reasonText: `${REASON_LABEL.company_signal}: ${signal.value}`,
      evidence: memoryEvidence(signal),
    });
  }

  const roleChange = findRoleChange(relationship);
  if (roleChange) {
    reasons.push({
      reasonCode: "role_change_observed",
      reasonText: `${REASON_LABEL.role_change_observed}: ${roleChange.value}`,
      evidence: memoryEvidence(roleChange),
    });
  }

  if (relationship.source === "in_person" && !lastTouch && relationship.metWhere) {
    reasons.push({
      reasonCode: "event_follow_up",
      reasonText: `${REASON_LABEL.event_follow_up}. You met at ${relationship.metWhere}.`,
      evidence: [{ label: `Met at ${relationship.metWhere}`, kind: "human" }],
    });
  }

  if (lastTouch && sinceTouch >= NO_REPLY_AFTER_DAYS && relationship.stage === "reached_out") {
    reasons.push({
      reasonCode: "no_reply_after_days",
      reasonText: `${REASON_LABEL.no_reply_after_days}. It has been ${sinceTouch} days.`,
      evidence: [
        { label: `Last touch ${new Date(lastTouch).toLocaleDateString()}`, kind: "computed" },
      ],
    });
  }

  if (relationship.metAt) {
    const years = Math.floor(daysBetween(relationship.metAt, now) / 365);
    const dayOfYear = daysBetween(relationship.metAt, now) % 365;
    if (years >= 1 && dayOfYear <= 7 && sinceTouch >= DORMANT_AFTER_DAYS) {
      reasons.push({
        reasonCode: "anniversary_of_meeting",
        reasonText: `${REASON_LABEL.anniversary_of_meeting}. ${years} year${years === 1 ? "" : "s"} since ${relationship.metWhere ?? "you met"}.`,
        evidence: [
          { label: `Met ${new Date(relationship.metAt).toLocaleDateString()}`, kind: "human" },
        ],
      });
    }
  }

  return reasons;
}

/** The single reason worth surfacing in the rail, or null when there is none. */
export function primaryReason(
  relationship: Relationship,
  now: Date = new Date(),
): ReminderCandidate | null {
  return reasonsToReconnect(relationship, now)[0] ?? null;
}
