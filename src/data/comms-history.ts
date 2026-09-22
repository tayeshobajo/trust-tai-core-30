/**
 * The history read.
 *
 * One organization-scoped read of the message store, one of the draft store,
 * and the people they belong to. Everything is filtered to a declared window
 * before any paging, ordered newest first, and never silently truncated.
 *
 * A read that fails is reported as unavailable. It is never dressed up as an
 * empty history, because "nothing happened" and "I could not look" are
 * different facts.
 *
 * Nothing here writes. Opening history changes no record.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import { toMessage, type MessageRow } from "@/data/supabase/comms-messages";
import { commsService } from "@/data/supabase/comms-service";
import type { StoredMailboxMessage } from "@/domain/comms-integrations";
import type { ID } from "@/domain/entities";
import {
  entriesFromDrafts,
  entriesFromMessages,
  peopleById,
  sortHistory,
  type HistoryDraft,
  type HistoryEntry,
} from "@/domain/comms-history";

const BASE_COLUMNS =
  "id, organization_id, relationship_id, thread_id, provider_message_id, provider_thread_id, direction, from_email, from_name, subject, snippet, occurred_at, provenance";

const COLUMN_VARIANTS = [`${BASE_COLUMNS}, body_text`, BASE_COLUMNS] as const;

/** The window history opens on. Stated on screen, never implied. */
export const HISTORY_WINDOW_DAYS = 180;

/** How many records open with, and how many each "Show more" adds. */
export const HISTORY_PAGE = 25;

export class HistoryUnavailable extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "HistoryUnavailable";
  }
}

function notProvisioned(message: string): boolean {
  return /does not exist|could not find the table|schema cache/i.test(message);
}

export interface HistoryRead {
  entries: HistoryEntry[];
  /** True when at least one store held more than this page asked for. */
  more: boolean;
  windowDays: number;
  since: string;
  requested: number;
}

async function readMessages(
  organizationId: ID,
  since: string,
  limit: number,
): Promise<StoredMailboxMessage[]> {
  for (let index = 0; index < COLUMN_VARIANTS.length; index += 1) {
    const result = await supabase
      .from("comms_messages")
      .select(COLUMN_VARIANTS[index]!)
      .eq("organization_id", organizationId)
      .gte("occurred_at", since)
      .order("occurred_at", { ascending: false })
      .range(0, limit - 1);

    if (!result.error) {
      return ((result.data ?? []) as unknown as MessageRow[]).map(toMessage);
    }
    if (notProvisioned(result.error.message)) {
      throw new HistoryUnavailable(
        "History cannot be read: the message store is not available in this workspace.",
      );
    }
    if (/body_text/i.test(result.error.message)) continue;
    throw new HistoryUnavailable("History could not be read just now.");
  }
  throw new HistoryUnavailable("History could not be read just now.");
}

async function readSentDrafts(
  organizationId: ID,
  since: string,
  limit: number,
): Promise<HistoryDraft[]> {
  const result = await supabase
    .from("comms_drafts")
    .select("id, organization_id, relationship_id, subject, body, review_state, created_at")
    .eq("organization_id", organizationId)
    .in("review_state", ["sent", "send_failed"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .range(0, limit - 1);

  if (result.error) {
    // A draft store that is not provisioned leaves messages standing.
    if (notProvisioned(result.error.message)) return [];
    throw new HistoryUnavailable("The sent drafts could not be read just now.");
  }

  return ((result.data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
    id: String(row["id"] ?? ""),
    relationshipId: String(row["relationship_id"] ?? ""),
    subject: typeof row["subject"] === "string" ? row["subject"] : null,
    body: typeof row["body"] === "string" ? row["body"] : "",
    reviewState: String(row["review_state"] ?? ""),
    createdAt: String(row["created_at"] ?? ""),
  }));
}

export async function listHistory(
  organizationId: ID,
  options: { limit?: number; windowDays?: number; now?: Date } = {},
): Promise<HistoryRead> {
  const windowDays = options.windowDays ?? HISTORY_WINDOW_DAYS;
  const limit = Math.max(1, options.limit ?? HISTORY_PAGE);
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  const [messages, drafts, relationships] = await Promise.all([
    readMessages(organizationId, since, limit),
    readSentDrafts(organizationId, since, limit),
    commsService.list(organizationId).catch(() => []),
  ]);

  const people = peopleById(relationships);
  const entries = sortHistory([
    ...entriesFromMessages(messages, people),
    ...entriesFromDrafts(drafts, people),
  ]);

  return {
    entries: entries.slice(0, limit),
    more: messages.length >= limit || drafts.length >= limit || entries.length > limit,
    windowDays,
    since,
    requested: limit,
  };
}
