/**
 * Fathom conversation source adapter (server only).
 *
 * The first implementation of the ConversationSource boundary. It fetches a
 * meeting with its transcript and normalizes it. It never stores a key in the
 * browser, never invents a transcript, and reports a missing key or a missing
 * meeting as exactly that.
 */

import type {
  ConversationSourceRef,
  NormalizedConversation,
  SourceAdapterStatus,
  TranscriptSegment,
} from "@/domain/steward";

const FATHOM_BASE = "https://api.fathom.ai/external/v1";
const PAGE_LIMIT = 6;

export class SourceUnavailableError extends Error {
  readonly kind = "unavailable";
}
export class SourceNotFoundError extends Error {
  readonly kind = "not_found";
}

function apiKey(): string | null {
  const key = process.env["FATHOM_API_KEY"];
  return key && key.trim() ? key.trim() : null;
}

export function fathomStatus(): SourceAdapterStatus {
  return apiKey()
    ? {
        provider: "fathom",
        configured: true,
        because: "Fathom is connected. Paste a call link and Steward will read the transcript.",
      }
    : {
        provider: "fathom",
        configured: false,
        because:
          "Fathom is not connected yet. Add FATHOM_API_KEY in project secrets to read real call transcripts.",
      };
}

type FathomMeeting = Record<string, unknown>;

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function segmentsOf(meeting: FathomMeeting, fallbackUrl: string): TranscriptSegment[] {
  const raw = Array.isArray(meeting["transcript"]) ? (meeting["transcript"] as unknown[]) : [];
  const segments: TranscriptSegment[] = [];
  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const row = entry as Record<string, unknown>;
    const speaker = row["speaker"] as Record<string, unknown> | undefined;
    const body = text(row["text"]);
    if (!body) return;
    segments.push({
      index,
      speaker: text(speaker?.["display_name"]) ?? "Unknown speaker",
      ...(text(speaker?.["matched_calendar_invitee_email"])
        ? { speakerEmail: text(speaker?.["matched_calendar_invitee_email"])! }
        : {}),
      at: text(row["timestamp"]) ?? "00:00:00",
      text: body,
      ...(text(row["playback_url"]) ? { url: text(row["playback_url"])! } : { url: fallbackUrl }),
    });
  });
  return segments;
}

function normalize(meeting: FathomMeeting, ref: ConversationSourceRef): NormalizedConversation {
  const url = text(meeting["url"]) ?? text(meeting["share_url"]) ?? ref.url;
  const invitees = Array.isArray(meeting["calendar_invitees"])
    ? (meeting["calendar_invitees"] as Record<string, unknown>[])
    : [];

  const actionItems = Array.isArray(meeting["action_items"])
    ? (meeting["action_items"] as Record<string, unknown>[])
    : [];

  return {
    sourceRef: {
      ...ref,
      ...(text(meeting["recording_id"]) ? { externalId: text(meeting["recording_id"])! } : {}),
      url,
    },
    title: text(meeting["title"]) ?? text(meeting["meeting_title"]) ?? "Untitled call",
    occurredAt:
      text(meeting["recording_start_time"]) ??
      text(meeting["created_at"]) ??
      new Date().toISOString(),
    participants: invitees.map((invitee) => ({
      name: text(invitee["name"]) ?? text(invitee["email"]) ?? "Unknown",
      ...(text(invitee["email"]) ? { email: text(invitee["email"])! } : {}),
      ...(text(invitee["email_domain"]) ? { emailDomain: text(invitee["email_domain"])! } : {}),
    })),
    segments: segmentsOf(meeting, url),
    ...(text(meeting["default_summary"]) ? { sourceSummary: text(meeting["default_summary"])! } : {}),
    sourceActionItems: actionItems.flatMap((item) => {
      const description = text(item["description"]);
      if (!description) return [];
      const assignee = item["assignee"] as Record<string, unknown> | undefined;
      return [
        {
          description,
          ...(text(assignee?.["name"]) ? { assigneeName: text(assignee?.["name"])! } : {}),
          ...(text(assignee?.["email"]) ? { assigneeEmail: text(assignee?.["email"])! } : {}),
          ...(text(item["recording_timestamp"]) ? { at: text(item["recording_timestamp"])! } : {}),
          ...(text(item["recording_playback_url"])
            ? { url: text(item["recording_playback_url"])! }
            : {}),
        },
      ];
    }),
  };
}

function matches(meeting: FathomMeeting, ref: ConversationSourceRef): boolean {
  const id = text(meeting["recording_id"]) ?? "";
  const url = `${text(meeting["url"]) ?? ""} ${text(meeting["share_url"]) ?? ""}`;
  if (ref.externalId && (id === ref.externalId || url.includes(ref.externalId))) return true;
  if (ref.shareToken && url.includes(ref.shareToken)) return true;
  return false;
}

async function page(cursor: string | null): Promise<{ items: FathomMeeting[]; next: string | null }> {
  const key = apiKey();
  if (!key) throw new SourceUnavailableError("Fathom is not connected.");

  const url = new URL(`${FATHOM_BASE}/meetings`);
  url.searchParams.set("include_transcript", "true");
  url.searchParams.set("include_action_items", "true");
  if (cursor) url.searchParams.set("cursor", cursor);

  const response = await fetch(url, {
    headers: { "X-Api-Key": key, Accept: "application/json" },
  });
  if (response.status === 401 || response.status === 403) {
    throw new SourceUnavailableError("Fathom refused the connection. The API key is not valid.");
  }
  if (!response.ok) {
    throw new SourceUnavailableError(`Fathom did not respond (${response.status}).`);
  }
  const body = (await response.json()) as Record<string, unknown>;
  const items = Array.isArray(body["items"]) ? (body["items"] as FathomMeeting[]) : [];
  const next = typeof body["next_cursor"] === "string" ? (body["next_cursor"] as string) : null;
  return { items, next };
}

/**
 * Read one conversation. Fathom's external API lists meetings rather than
 * fetching one by id, so we walk pages until the reference matches, and stop.
 */
export async function fetchFathomConversation(
  ref: ConversationSourceRef,
): Promise<NormalizedConversation> {
  let cursor: string | null = null;
  for (let i = 0; i < PAGE_LIMIT; i += 1) {
    const result: { items: FathomMeeting[]; next: string | null } = await page(cursor);
    const found = result.items.find((meeting) => matches(meeting, ref));
    if (found) return normalize(found, ref);
    if (!result.next) break;
    cursor = result.next;
  }
  throw new SourceNotFoundError(
    "That call is not in the connected Fathom workspace, or it is older than the calls Steward can reach.",
  );
}

/** Recent calls, so a person can pick rather than paste. */
export async function listFathomConversations(limit = 10): Promise<NormalizedConversation[]> {
  const result = await page(null);
  return result.items.slice(0, limit).map((meeting) =>
    normalize(meeting, {
      provider: "fathom",
      url: text(meeting["url"]) ?? text(meeting["share_url"]) ?? "",
    }),
  );
}
