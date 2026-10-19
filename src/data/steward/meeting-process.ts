import type { NormalizedConversation } from "@/domain/steward";
export const MEETING_PROCESS_VERSION = "full-transcript-v1";
export async function transcriptDigest(conversation: NormalizedConversation): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      source: conversation.sourceRef,
      date: conversation.occurredAt,
      participants: conversation.participants,
      segments: conversation.segments,
      actions: conversation.sourceActionItems,
    }),
  );
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** Calendar suggestions remain review-only; no inferred deadline is written. */
export function groundedTimeline(words: string | null, meetingDate: string) {
  if (!words) return { basis: "missing", suggestedDate: null, explanation: "No deadline stated." };
  const explicit = words.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  if (
    explicit &&
    !Number.isNaN(new Date(explicit).valueOf()) &&
    new Date(explicit).toISOString().slice(0, 10) === explicit
  )
    return {
      basis: "explicit",
      suggestedDate: explicit,
      explanation: "Explicit date; confirm before saving.",
    };
  const relative = /^today$/i.test(words.trim())
    ? 0
    : /^tomorrow$/i.test(words.trim())
      ? 1
      : words.trim().match(/^in (\d+) days?$/i)?.[1];
  if (relative !== undefined && relative !== null) {
    const date = new Date(meetingDate);
    if (!Number.isNaN(date.valueOf())) {
      date.setUTCDate(date.getUTCDate() + Number(relative));
      return {
        basis: "relative",
        suggestedDate: date.toISOString().slice(0, 10),
        explanation: "Based on the recorded meeting date (UTC); confirm local date and timezone.",
      };
    }
  }
  return {
    basis: "ambiguous",
    suggestedDate: null,
    explanation: "Keep the spoken timing; clarify the calendar date.",
  };
}
