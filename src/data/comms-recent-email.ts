/**
 * The Dashboard's recent-email read.
 *
 * One organization-scoped read of `comms_messages`, filtered to a declared
 * window BEFORE any paging, ordered newest first, and paged with an exact
 * scoped count. There is no silent first-thousand truncation: the total is the
 * database's own count of the window, and the rows are the page asked for.
 *
 * A read that fails, or a table that is not there, is reported as unavailable.
 * It never returns an empty success, because an empty inbox and an unread
 * inbox are different facts.
 *
 * Nothing here writes. Reading the Dashboard changes no record.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import { toMessage, type MessageRow } from "@/data/supabase/comms-messages";
import type { StoredMailboxMessage } from "@/domain/comms-integrations";
import type { ID } from "@/domain/entities";
import { RECENT_EMAIL_WINDOW_DAYS } from "@/domain/comms-recent-email";

const BASE_COLUMNS =
  "id, organization_id, relationship_id, thread_id, provider_message_id, provider_thread_id, direction, from_email, from_name, subject, snippet, occurred_at, provenance";

/** Richest first. Each fallback sheds exactly the column the error names. */
const COLUMN_VARIANTS = [`${BASE_COLUMNS}, body_text`, BASE_COLUMNS] as const;

export interface RecentEmailRead {
  messages: StoredMailboxMessage[];
  /** The true number of messages in the window, counted by the database. */
  total: number;
  windowDays: number;
  /** The oldest instant this read could include. */
  since: string;
  /** How many rows were asked for, so the UI can tell a full page apart. */
  requested: number;
}

/** A read that could not be completed. Never dressed up as an empty inbox. */
export class RecentEmailUnavailable extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "RecentEmailUnavailable";
  }
}

function missingColumn(message: string): string | null {
  return /body_text/i.test(message) ? "body_text" : null;
}

function notProvisioned(message: string): boolean {
  return /relation.*comms_messages.* does not exist|could not find the table|schema cache/i.test(
    message,
  );
}

export async function listRecentEmail(
  organizationId: ID,
  options: { limit?: number; windowDays?: number; now?: Date } = {},
): Promise<RecentEmailRead> {
  const windowDays = options.windowDays ?? RECENT_EMAIL_WINDOW_DAYS;
  const limit = Math.max(1, options.limit ?? 40);
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  for (let index = 0; index < COLUMN_VARIANTS.length; index += 1) {
    const columns = COLUMN_VARIANTS[index]!;
    const result = await supabase
      .from("comms_messages")
      .select(columns, { count: "exact" })
      .eq("organization_id", organizationId)
      .gte("occurred_at", since)
      .order("occurred_at", { ascending: false })
      .range(0, limit - 1);

    if (!result.error) {
      const rows = (result.data ?? []) as unknown as MessageRow[];
      return {
        messages: rows.map(toMessage),
        total: result.count ?? rows.length,
        windowDays,
        since,
        requested: limit,
      };
    }

    if (notProvisioned(result.error.message)) {
      throw new RecentEmailUnavailable(
        "Recent email cannot be read: the message store is not available in this workspace.",
      );
    }
    const missing = missingColumn(result.error.message);
    if (missing && columns.includes(missing)) continue;
    throw new RecentEmailUnavailable(`Recent email could not be read. ${result.error.message}`);
  }

  throw new RecentEmailUnavailable("Recent email could not be read from the message store.");
}
