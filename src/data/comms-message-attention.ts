import { supabase } from "@/integrations/trust-tai/supabase";
import { toMessage, type MessageRow } from "@/data/supabase/comms-messages";
import type { StoredMailboxMessage } from "@/domain/comms-integrations";

/** Read stored metadata only, never provider APIs or message bodies. Fail closed on a partial read. */
export async function listMessageAttention(
  organizationId: string,
): Promise<StoredMailboxMessage[]> {
  const messages: StoredMailboxMessage[] = [];
  let expectedCount: number | undefined;
  const seen = new Set<string>();
  for (let offset = 0; offset < 10000; offset += 500) {
    const { data, error, count } = await supabase
      .from("comms_messages")
      .select(
        "id, organization_id, relationship_id, thread_id, provider_message_id, provider_thread_id, direction, occurred_at, provenance",
        { count: "exact" },
      )
      .eq("organization_id", organizationId)
      .order("id", { ascending: true })
      .range(offset, offset + 499);
    if (error) throw new Error(`Stored message attention is unavailable: ${error.message}`);
    if (count === null) throw new Error("Stored message coverage could not be verified.");
    if (expectedCount !== undefined && count !== expectedCount) {
      throw new Error("Stored messages changed during the read; check again.");
    }
    expectedCount = count;
    const rows = (data ?? []) as unknown as MessageRow[];
    for (const row of rows) {
      if (
        seen.has(row.id) ||
        row.organization_id !== organizationId ||
        !Number.isFinite(Date.parse(row.occurred_at))
      ) {
        throw new Error("Stored message attention could not be verified; check again.");
      }
      seen.add(row.id);
    }
    messages.push(...rows.map(toMessage));
    if (messages.length >= count) return messages;
    if (rows.length < 500) throw new Error("Stored message attention read was incomplete.");
  }
  throw new Error(
    "Stored message attention exceeds the 10,000-record read limit; coverage is incomplete.",
  );
}
