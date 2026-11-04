import type { StoredMailboxMessage } from "./comms-integrations";
import type { ConversationHealth } from "./comms-health";
import { threadKeyOf } from "./comms-recent-email";

/** Read-only addition: email may raise attention, never settle manual obligations. */
export function withMessageAttention(
  health: ConversationHealth,
  messages: StoredMailboxMessage[],
): ConversationHealth {
  const threads = new Map<string, StoredMailboxMessage>();
  let lastActivityAt = health.lastActivityAt;
  for (const message of messages) {
    if (
      message.relationshipId !== health.relationshipId ||
      !Number.isFinite(Date.parse(message.occurredAt))
    )
      continue;
    if (!lastActivityAt || Date.parse(message.occurredAt) > Date.parse(lastActivityAt))
      lastActivityAt = message.occurredAt;
    const key = threadKeyOf(message);
    const prior = threads.get(key);
    // Equal timestamps are ambiguous: preserve inbound attention.
    if (
      !prior ||
      Date.parse(message.occurredAt) > Date.parse(prior.occurredAt) ||
      (Date.parse(message.occurredAt) === Date.parse(prior.occurredAt) &&
        message.direction === "inbound")
    )
      threads.set(key, message);
  }
  const pending = [...threads.values()].filter((message) => message.direction === "inbound").length;
  return {
    ...health,
    ...(lastActivityAt ? { lastActivityAt } : {}),
    ...(pending
      ? {
          waitingOn: "needs_us" as const,
          status: health.status === "at_risk" ? ("at_risk" as const) : ("needs_attention" as const),
          reasons: [
            `${pending} stored message thread${pending === 1 ? " has" : "s have"} an inbound last message. Review before treating it as settled.`,
            ...health.reasons,
          ],
        }
      : {}),
  };
}
