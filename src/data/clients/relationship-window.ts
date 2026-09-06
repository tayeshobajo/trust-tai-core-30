/**
 * The client-scoped window onto Comms.
 *
 * Clients does not own a single conversation, thread, reply or promise. Comms
 * does. This is a read: for the people Comms already links to this company, it
 * counts what has actually been exchanged, names the last thing said in each
 * direction, and repeats the one obligation Comms already derived. Nothing
 * here decides anything, and nothing here can send.
 */

import { nextRelationshipMove, type MoveUrgency } from "@/data/comms-next-move";
import type { StoredMailboxMessage } from "@/domain/comms-integrations";
import type { Relationship } from "@/domain/comms";

export interface RelationshipMessageMark {
  /** The subject line as stored, or a plain stand-in when there is none. */
  subject: string;
  at: string;
}

export interface RelationshipWindowPerson {
  relationshipId: string;
  fullName: string;
  /** How many threads Comms has stored for this person. */
  threadCount: number;
  messageCount: number;
  inboundCount: number;
  outboundCount: number;
  latestInbound: RelationshipMessageMark | null;
  latestOutbound: RelationshipMessageMark | null;
  /** Comms' own next move, repeated only when Comms says one is needed. */
  obligation: { action: string; whyNow: string; urgency: MoveUrgency } | null;
}

export interface RelationshipWindow {
  people: RelationshipWindowPerson[];
  /** People with an obligation Comms marked as due now or soon. */
  owed: number;
}

function markOf(message: StoredMailboxMessage): RelationshipMessageMark {
  return {
    subject: (message.subject ?? "").trim() || "No subject",
    at: message.occurredAt,
  };
}

/** The latest message in one direction, by the time it actually happened. */
function latestIn(
  messages: StoredMailboxMessage[],
  direction: "inbound" | "outbound",
): RelationshipMessageMark | null {
  let best: StoredMailboxMessage | null = null;
  for (const message of messages) {
    if (message.direction !== direction) continue;
    if (!best || Date.parse(message.occurredAt) > Date.parse(best.occurredAt)) best = message;
  }
  return best ? markOf(best) : null;
}

/**
 * Project one company's relationships into a read. Relationships must already
 * be the ones Comms links to this client; this function does not decide
 * membership, it only reports what those conversations contain.
 */
export function relationshipWindow(input: {
  relationships: Relationship[];
  messagesByRelationship: Record<string, StoredMailboxMessage[]>;
  now: Date;
}): RelationshipWindow {
  const people = input.relationships.map((relationship) => {
    const messages = input.messagesByRelationship[relationship.id] ?? [];
    const threads = new Set<string>();
    let inbound = 0;
    let outbound = 0;
    for (const message of messages) {
      threads.add(message.threadId ?? message.providerThreadId ?? message.id);
      if (message.direction === "inbound") inbound += 1;
      else outbound += 1;
    }
    // The move is Comms' answer, not ours. We repeat it or we say nothing.
    const move = nextRelationshipMove(relationship, input.now);
    return {
      relationshipId: relationship.id,
      fullName: relationship.fullName,
      threadCount: threads.size,
      messageCount: messages.length,
      inboundCount: inbound,
      outboundCount: outbound,
      latestInbound: latestIn(messages, "inbound"),
      latestOutbound: latestIn(messages, "outbound"),
      obligation: move.needed
        ? { action: move.action, whyNow: move.whyNow, urgency: move.urgency }
        : null,
    } satisfies RelationshipWindowPerson;
  });

  // Most recently spoken to first, because that is the live conversation.
  people.sort((left, right) => {
    const leftAt = Math.max(
      Date.parse(left.latestInbound?.at ?? "0"),
      Date.parse(left.latestOutbound?.at ?? "0"),
    );
    const rightAt = Math.max(
      Date.parse(right.latestInbound?.at ?? "0"),
      Date.parse(right.latestOutbound?.at ?? "0"),
    );
    return (Number.isNaN(rightAt) ? 0 : rightAt) - (Number.isNaN(leftAt) ? 0 : leftAt);
  });

  return {
    people,
    owed: people.filter(
      (person) => person.obligation && person.obligation.urgency !== "when_natural",
    ).length,
  };
}
