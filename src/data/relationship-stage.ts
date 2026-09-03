/**
 * Relationship development stages, derived from the one relationship record.
 *
 * One person. One memory. Many stages of relationship. This module maps the
 * existing lifecycle and touch history onto the six human-facing development
 * states. It creates no second pipeline and stores nothing new: the same
 * record is simply read more honestly.
 *
 * The critical transition: the moment they reply, the relationship is a
 * conversation. Sequence thinking ends there.
 */

import type { Relationship, Touch } from "@/domain/comms";
import type { DevelopmentStage } from "@/domain/relationship-development";
import { COOLING_AFTER_DAYS } from "@/data/relationship-development";

const DAY = 86_400_000;

/** The minimum this read needs from a touch. `Touch` satisfies it. */
export type StageTouch = Pick<Touch, "direction" | "occurredAt">;

export interface DevelopmentStageRead {
  stage: DevelopmentStage;
  /** One calm sentence about why the relationship sits here. */
  because: string;
}

/**
 * Derive the development state. Returns null for relationships that have
 * graduated out of development entirely (client, opportunity, archived).
 */
export function developmentStage(
  relationship: Relationship,
  touches: StageTouch[] = [],
  now: Date = new Date(),
): DevelopmentStageRead | null {
  const { stage } = relationship;

  // Graduated: these relationships are no longer "developing"; they have
  // arrived somewhere. The chip stays quiet rather than relabeling them.
  if (stage === "client" || stage === "opportunity" || stage === "archived") return null;

  const ordered = [...touches].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
  );
  const lastInbound = [...ordered].reverse().find((touch) => touch.direction === "inbound");
  const lastOutbound = [...ordered].reverse().find((touch) => touch.direction === "outbound");
  const latest = ordered[ordered.length - 1];

  // They replied. The moment a reply exists, this is a conversation, the
  // relationship has crossed the line where automation ends.
  if (
    stage !== "new" &&
    stage !== "researching" &&
    stage !== "ready_to_reach" &&
    lastInbound &&
    (!lastOutbound ||
      new Date(lastInbound.occurredAt).getTime() >= new Date(lastOutbound.occurredAt).getTime())
  ) {
    return {
      stage: "conversation_open",
      because: `They replied. This is a conversation now, and the next move is a person's, not a sequence's.`,
    };
  }

  if (stage === "new" || stage === "researching" || stage === "ready_to_reach") {
    return {
      stage: "ready_for_first_move",
      because: "The relationship is on record and the first move is still ours to make.",
    };
  }

  const lastTouchAt = relationship.lastTouchAt ?? latest?.occurredAt;
  const daysQuiet = lastTouchAt
    ? Math.floor((now.getTime() - new Date(lastTouchAt).getTime()) / DAY)
: null;

  if (stage === "reached_out") {
    if (daysQuiet !== null && daysQuiet > COOLING_AFTER_DAYS) {
      return {
        stage: "cooling",
        because: `No reply in ${daysQuiet} days. The window is cooling; a person decides whether patience or a warmer path is right.`,
      };
    }
    return {
      stage: "waiting_for_reply",
      because: "We reached out and the ball is genuinely in their court. Nothing is owed yet.",
    };
  }

  if (stage === "in_conversation" || stage === "meeting_set") {
    // Latest touch is outbound: we spoke last, so we are waiting on them.
    return {
      stage: "conversation_open",
      because: "The conversation is open and moving. Judgment, not automation, carries it from here.",
    };
  }

  if (stage === "dormant") {
    return {
      stage: "cooling",
      because: "This relationship has gone quiet. Re-entry, if any, is a considered human move.",
    };
  }

  return {
    stage: "developing",
    because: "The relationship is developing at its own pace, in the care of a person.",
  };
}
