import type { EvidenceRecord, LinkedInEvidence, ObservedMessage } from "./roadmap-evidence";

export type LinkedInEvent = LinkedInEvidence["records"][number];
export const linkedInTime = (event: LinkedInEvent) =>
  event.observed_at ?? event.observed_send_time_utc_approx!;
export const linkedInApproximate = (event: LinkedInEvent) =>
  !event.observed_at || event.timestamp_precision !== "exact";

/** Exact duplicate receipts collapse; differing bodies remain reviewable, never overwritten. */
export function attachLinkedIn(
  record: EvidenceRecord,
  evidence?: LinkedInEvidence,
): EvidenceRecord {
  const slug = record.publication?.slug ?? record.review?.roadmap_slug;
  if (!slug || !evidence) return record;
  const events = [
    ...new Map(
      evidence.records
        .filter((event) => event.slug === slug)
        .map((event) => [JSON.stringify(event), event]),
    ).values(),
  ].sort((a, b) => Date.parse(linkedInTime(b)) - Date.parse(linkedInTime(a)));
  const sent = events.find((event) => event.status === "sent_ui_verified");
  return { ...record, linkedInEvents: events, ...(sent ? { linkedIn: sent } : {}) };
}

export type ConversationEvent =
  | { channel: "email"; at: string; email: ObservedMessage }
  | { channel: "linkedin"; at: string; linkedin: LinkedInEvent };

/** Drafts and publication are not conversation activity. Partial coverage remains partial. */
export function conversationEvents(record: EvidenceRecord): ConversationEvent[] {
  return [
    ...record.messages.map((email) => ({
      channel: "email" as const,
      at: email.message.sent_at,
      email,
    })),
    ...(record.linkedInEvents ?? (record.linkedIn ? [record.linkedIn] : [])).map((linkedin) => ({
      channel: "linkedin" as const,
      at: linkedInTime(linkedin),
      linkedin,
    })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
