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

/* ======================================================================
 * Message fidelity: body columns and inline resources
 * ==================================================================== */

describe("toMessage body fidelity mapping", () => {
  it("maps body_text and body_html onto the client message", () => {
    const message = toMessage(
      row({
        snippet: "A short preview…",
        body_text: "The full body, well beyond the snippet.",
        body_html: "<p>The full <b>body</b>.</p>",
      }),
    );
    expect(message.bodyText).toBe("The full body, well beyond the snippet.");
    expect(message.bodyHtml).toBe("<p>The full <b>body</b>.</p>");
    expect(message.snippet).toBe("A short preview…");
  });

  it("maps inline resources with content ids, tolerating camel and snake keys", () => {
    const message = toMessage(
      row({
        attachments: [
          {
            filename: "logo.png",
            mime_type: "image/png",
            size: 50,
            attachment_id: "a2",
            content_id: "logo@acme",
            inline: true,
          },
          { filename: "old.pdf", mimeType: "application/pdf", size: 10, attachmentId: "a1" },
        ],
      }),
    );
    expect(message.attachments).toHaveLength(2);
    expect(message.attachments![0]).toMatchObject({
      attachmentId: "a2",
      contentId: "logo@acme",
      inline: true,
    });
    expect(message.attachments![1]).toMatchObject({ attachmentId: "a1" });
  });

  it("surfaces the remote-image refusal count from provenance", () => {
    const message = toMessage(
      row({
        provenance: { source: "gmail", mailbox: "tai@x.com", blocked_remote_images: 3 },
      }),
    );
    expect(message.blockedRemoteImages).toBe(3);
  });
});
