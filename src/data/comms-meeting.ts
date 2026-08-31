/**
 * Planning a meeting from the conversation itself.
 *
 * A meeting agreed in an email is a promise, so it is recorded exactly like
 * one: a dated commitment on the relationship's own memory, with the message
 * it came from as its evidence. The Plan tab then reads it like every other
 * plan item — no second calendar, no separate meeting table, nothing the Plan
 * view has to be taught about.
 */

import { commsService, type CommsContext } from "@/data/supabase/comms-service";
import type { Relationship } from "@/domain/comms";
import { COMMITMENT_CATEGORY } from "@/domain/comms-interactions";
import type { StoredMailboxMessage } from "@/domain/comms-integrations";

/** The title a meeting carries when a person did not write their own. */
export function defaultMeetingTitle(relationship: Relationship): string {
  return `Meeting with ${relationship.fullName}`;
}

/**
 * Record a meeting from one message. The date is the person's; the wording is
 * the person's; the evidence is the message they were reading when they
 * decided. Nothing is sent and no invitation is created.
 */
export async function planMeetingFromMessage(input: {
  relationship: Relationship;
  message: StoredMailboxMessage | null;
  /** Local date and time from the form, for example 2026-09-03T15:00. */
  at: string;
  title?: string;
  owner?: "us" | "them";
  context: CommsContext;
  addedBy?: string;
}): Promise<Relationship> {
  const when = new Date(input.at);
  if (Number.isNaN(when.getTime())) throw new Error("Choose a date and time for the meeting.");

  const title = input.title?.trim() || defaultMeetingTitle(input.relationship);
  const meetingTitle = /meeting|call|intro|demo|coffee|zoom|catch ?up|session/i.test(title)
    ? title
    : `Meeting: ${title}`;

  const subject = input.message?.subject?.trim();

  return commsService.remember(
    input.relationship,
    {
      label: "Meeting",
      value: meetingTitle,
      tier: "decided",
      category: COMMITMENT_CATEGORY,
      due: when.toISOString(),
      status: "open",
      owner: input.owner ?? "us",
      ...(input.addedBy ? { addedBy: `Added by ${input.addedBy}` } : {}),
      evidence: [
        {
          label: subject
            ? `Planned from the email “${subject}”`
            : "Planned from this conversation in Comms",
          kind: "human" as const,
        },
      ],
    },
    input.context,
  );
}
