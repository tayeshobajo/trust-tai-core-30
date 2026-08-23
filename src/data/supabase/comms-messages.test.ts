/**
 * Provenance → client mapping for stored mailbox messages.
 *
 * Multi-mailbox law: mailboxes own transport identity; relationships own
 * memory. The server stamps `provenance.mailbox` on every synced Gmail
 * message and every Comms-sent row; the client mapping must surface it so
 * the timeline and composer can keep replies with the mailbox that owns
 * the conversation. Absent provenance means no mailbox — never inferred.
 */
import { describe, expect, it } from "vitest";
import { toMessage, type MessageRow } from "@/data/supabase/comms-messages";

function row(overrides: Partial<MessageRow>): MessageRow {
  return {
    id: "msg-1",
    organization_id: "org-1",
    relationship_id: "rel-1",
    thread_id: null,
    provider_message_id: "pm-1",
    provider_thread_id: null,
    direction: "inbound",
    from_email: "riley@example.com",
    from_name: null,
    subject: null,
    snippet: null,
    occurred_at: "2026-08-22T00:00:00Z",
    attachments: null,
    provenance: null,
    ...overrides,
  };
}

describe("toMessage mailbox provenance mapping", () => {
  it("maps a synced Gmail row's provenance.mailbox onto the client message", () => {
    const message = toMessage(
      row({
        provenance: {
          source: "gmail",
          fetched_at: "2026-08-22T00:00:00Z",
          mailbox: "tai@trusttai.com",
        },
      }),
    );

    expect(message.mailbox).toBe("tai@trusttai.com");
    expect(message.sentViaComms).toBeUndefined();
  });

  it("maps a sent-via-Comms row's provenance.mailbox and flags the sentinel", () => {
    const message = toMessage(
      row({
        direction: "outbound",
        provenance: {
          source: "gmail-send",
          mailbox: " Tai@TrustTai.com ",
          idempotency_key: "k-1",
          sent_at: "2026-08-22T00:00:00Z",
        },
      }),
    );

    // mailboxFromProvenance normalizes case/whitespace.
    expect(message.mailbox).toBe("tai@trusttai.com");
    expect(message.sentViaComms).toBe(true);
  });

  it("does not infer a mailbox when provenance is absent", () => {
    const message = toMessage(row({ provenance: null }));

    expect(message.mailbox).toBeUndefined();
    expect("mailbox" in message).toBe(false);
  });

  it("does not infer a mailbox when provenance lacks one", () => {
    const message = toMessage(row({ provenance: { source: "gmail" } }));

    expect(message.mailbox).toBeUndefined();
    expect("mailbox" in message).toBe(false);
  });
});
