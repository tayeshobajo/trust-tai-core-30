/**
 * The next relationship move.
 *
 * One calm answer to three questions: what should happen next, why now, and
 * what it is for. A move only exists when something true supports it, so a
 * quiet relationship with nothing outstanding says "No outreach needed" rather
 * than manufacturing a reason to write.
 *
 * Cadence alone is never a reason. Silence counts only when it is unusual for
 * this kind of relationship and something is actually waiting.
 */

import { daysBetween, type Relationship } from "@/domain/comms";
import {
  effectiveIntent,
  INTENT_LABEL,
  INTENT_RHYTHM_LABEL,
  openCommitments,
  rhythmDaysFor,
} from "@/domain/comms-interactions";
import type { EvidenceRef } from "@/domain/confidence";

import { reasonsToReconnect } from "./comms-reminders";

export type MoveUrgency = "now" | "soon" | "when_natural" | "none";

export interface NextRelationshipMove {
  /** False when there is genuinely nothing worth doing. */
  needed: boolean;
  /** What should happen next, written as an action. */
  action: string;
  /** Why now, in plain English, resting on a fact. */
  whyNow: string;
  /** What the move is for. */
  goal: string;
  urgency: MoveUrgency;
  evidence: EvidenceRef[];
}

function noMove(relationship: Relationship): NextRelationshipMove {
  const intent = effectiveIntent(relationship);
  return {
    needed: false,
    action: "No outreach needed",
    whyNow: "Nothing is outstanding and nothing has changed since you last spoke.",
    goal: `Let this ${INTENT_LABEL[intent].toLowerCase()} relationship rest until there is something real to say.`,
    urgency: "none",
    evidence: [{ label: "No open promise, no unanswered message", kind: "computed" }],
  };
}

/**
 * The single move worth showing. Promises outrank unanswered messages, which
 * outrank meaningful events, which outrank unusual silence.
 */
export function nextRelationshipMove(
  relationship: Relationship,
  now: Date = new Date(),
): NextRelationshipMove {
  if (relationship.stage === "archived") return noMove(relationship);

  const intent = effectiveIntent(relationship);
  const who = relationship.fullName.split(" ")[0] || relationship.fullName;

  // 1. A promise we made, or one made to us.
  const commitments = openCommitments(relationship);
  const ours = commitments.find((entry) => entry.owner !== "them");
  if (ours) {
    const overdue = ours.due ? Date.parse(ours.due) < now.getTime() : false;
    return {
      needed: true,
      action: overdue ? `Close the promise to ${who}` : `Deliver what you promised ${who}`,
      whyNow: ours.due
        ? `${overdue ? "This was due" : "This is due"} ${new Date(ours.due).toLocaleDateString()}: ${ours.text}`
        : `You committed to this and it is still open: ${ours.text}`,
      goal: "Keep your word visible, so trust does not depend on memory.",
      urgency: overdue ? "now" : "soon",
      evidence: [{ label: "Open commitment on this relationship", kind: "human" }],
    };
  }

  const theirs = commitments.find((entry) => entry.owner === "them");

  // 2. Something they sent that is still waiting on us.
  if (relationship.responseDueAt && Date.parse(relationship.responseDueAt) <= now.getTime()) {
    return {
      needed: true,
      action: `Reply to ${who}`,
      whyNow: `They wrote and a reply was due ${new Date(relationship.responseDueAt).toLocaleDateString()}.`,
      goal: "Answer the person who reached out before the thread cools.",
      urgency: "now",
      evidence: [{ label: "Unanswered inbound message", kind: "computed" }],
    };
  }

  // 3. A real reason on record: an event, a signal, a role change.
  const reasons = reasonsToReconnect(relationship, now).filter(
    (entry) => entry.reasonCode !== "no_reply_after_days",
  );
  const reason = reasons[0];
  if (reason) {
    return {
      needed: true,
      action:
        reason.reasonCode === "event_follow_up"
          ? `Follow up with ${who} after meeting`
          : reason.reasonCode === "anniversary_of_meeting"
            ? `Mark the year with ${who}`
            : `Prepare a check-in with ${who}`,
      whyNow: reason.reasonText,
      goal: "Reach out because something happened, not because time passed.",
      urgency: "soon",
      evidence: reason.evidence,
    };
  }

  // 4. A promise they made that has gone past its date.
  if (theirs?.due && Date.parse(theirs.due) < now.getTime()) {
    return {
      needed: true,
      action: `Nudge ${who} gently`,
      whyNow: `They said they would ${theirs.text.toLowerCase()} by ${new Date(theirs.due).toLocaleDateString()}, and that date has passed.`,
      goal: "Ask once, kindly, so the thread does not stall on their side.",
      urgency: "soon",
      evidence: [{ label: "Commitment they made", kind: "human" }],
    };
  }

  // 5. Silence that is unusual for this kind of relationship, and only when a
  // conversation was actually live. Time alone is never enough on its own.
  const lastTouch = relationship.lastTouchAt;
  const rhythm = rhythmDaysFor(relationship);
  const quiet = lastTouch ? daysBetween(lastTouch, now) : null;
  const live = ["reached_out", "in_conversation", "meeting_set", "opportunity", "client"].includes(
    relationship.stage,
  );
  if (live && quiet !== null && quiet >= rhythm * 2) {
    return {
      needed: true,
      action: `Reconnect with ${who}`,
      whyNow: `This conversation was live and has been quiet for ${quiet} days, well past its usual rhythm of about ${rhythm}.`,
      goal: `Find out whether the ${INTENT_LABEL[intent].toLowerCase()} conversation is still moving.`,
      urgency: "when_natural",
      evidence: [
        {
          label: `Last interaction ${new Date(lastTouch!).toLocaleDateString()}`,
          kind: "computed",
        },
        { label: `Usual rhythm: ${INTENT_RHYTHM_LABEL[intent]}`, kind: "computed" },
      ],
    };
  }

  return noMove(relationship);
}
