import { describe, expect, it } from "vitest";

import { grantedGmailScopes } from "@/domain/comms-integrations";
import {
  authorizeUrl,
  buildLabelListPath,
  COMMS_GMAIL_LABEL,
  COMMS_LABEL_MISSING_MESSAGE,
  connectionRowFor,
  counterpartAddresses,
  findCommsLabelId,
  findTrackedCounterpart,
  parseAddress,
  type RelationshipRow,
} from "@/lib/comms-gmail.server";
import { canSendWithScopes } from "@/lib/comms-gmail-send.server";

describe("parseAddress", () => {
  it("splits a display name from the address", () => {
    expect(parseAddress("Tai Smith <Tai@Trust-Tai.com>")).toEqual({
      name: "Tai Smith",
      email: "tai@trust-tai.com",
    });
  });

  it("handles a quoted display name", () => {
    expect(parseAddress('"Smith, Tai" <tai@trust-tai.com>')).toEqual({
      name: "Smith, Tai",
      email: "tai@trust-tai.com",
    });
  });

  it("accepts a bare address", () => {
    expect(parseAddress("  TAI@trust-tai.com ")).toEqual({ email: "tai@trust-tai.com" });
  });

  it("returns nothing for a value with no address", () => {
    expect(parseAddress("unknown sender")).toEqual({});
    expect(parseAddress(undefined)).toEqual({});
  });
});

describe("findCommsLabelId", () => {
  it("matches the exact nested label name, not a partial or parent label", () => {
    const labels = [
      { id: "INBOX", name: "INBOX" },
      { id: "Label_9", name: "Trust Tai" },
      { id: "Label_42", name: "Trust Tai/Comms" },
      { id: "Label_7", name: "Trust Tai/Comms Archive" },
    ];
    expect(findCommsLabelId(labels)).toBe("Label_42");
  });

  it("falls back to a case-insensitive match. Gmail label names are case-insensitively unique", () => {
    expect(findCommsLabelId([{ id: "Label_5", name: "trust tai/comms" }])).toBe("Label_5");
    expect(findCommsLabelId([{ id: "Label_6", name: "TRUST TAI/COMMS" }])).toBe("Label_6");
  });

  it("returns null when the label is missing, the safe no-op trigger, never a fallback", () => {
    expect(findCommsLabelId([])).toBeNull();
    expect(findCommsLabelId([{ id: "INBOX", name: "INBOX" }])).toBeNull();
    expect(findCommsLabelId([{ id: "Label_1", name: "Comms" }])).toBeNull();
  });

  it("the missing-label message names the label and rules out whole-mailbox reading", () => {
    expect(COMMS_LABEL_MISSING_MESSAGE).toContain(COMMS_GMAIL_LABEL);
    expect(COMMS_LABEL_MISSING_MESSAGE).toContain("never falls back");
  });
});

describe("buildLabelListPath", () => {
  it("gates on the label id first, unlabeled mail can never enter the candidate set", () => {
    const path = buildLabelListPath({ labelId: "Label_42", days: 2, maxResults: 60 });
    expect(path).toContain("labelIds=Label_42");
    const decoded = decodeURIComponent(path);
    expect(decoded).toContain("q=newer_than:2d -in:spam -in:trash");
    expect(decoded).toContain("maxResults=60");
  });

  it("carries no address scoping, identity is decided after listing, not by mailbox discovery", () => {
    const decoded = decodeURIComponent(
      buildLabelListPath({ labelId: "Label_42", days: 30, maxResults: 25 }),
    );
    expect(decoded).not.toMatch(/from:|to:/);
    // And no free-text label search, which would split on the space and slash.
    expect(decoded).not.toContain("label:");
  });

  it("carries the page token when one is given", () => {
    const path = buildLabelListPath({
      labelId: "Label_42",
      days: 2,
      maxResults: 10,
      pageToken: "tok/abc",
    });
    expect(decodeURIComponent(path)).toContain("pageToken=tok/abc");
  });
});

describe("findTrackedCounterpart", () => {
  const tracked: RelationshipRow = {
    id: "rel-1",
    email: "john@example.com",
    full_name: "John Schmidt",
  };
  const byEmail = new Map<string, RelationshipRow>([["john@example.com", tracked]]);
  const mailbox = "me@trust-tai.com";

  it("matches inbound mail from a tracked person", () => {
    expect(
      findTrackedCounterpart(
        { fromEmail: "john@example.com", toEmails: [mailbox], ccEmails: [] },
        mailbox,
        byEmail,
      ),
    ).toBe(tracked);
  });

  it("matches outbound mail to (or cc'ing) a tracked person", () => {
    expect(
      findTrackedCounterpart(
        { fromEmail: mailbox, toEmails: ["john@example.com"], ccEmails: [] },
        mailbox,
        byEmail,
      ),
    ).toBe(tracked);
    expect(
      findTrackedCounterpart(
        { fromEmail: mailbox, toEmails: ["other@example.com"], ccEmails: ["john@example.com"] },
        mailbox,
        byEmail,
      ),
    ).toBe(tracked);
  });

  it("never matches unknown senders, they cannot be stored or become relationships", () => {
    expect(
      findTrackedCounterpart(
        { fromEmail: "newsletter@noise.io", toEmails: [mailbox], ccEmails: [] },
        mailbox,
        byEmail,
      ),
    ).toBeUndefined();
  });

  it("ignores the mailbox's own address", () => {
    expect(
      findTrackedCounterpart(
        { fromEmail: mailbox, toEmails: [mailbox], ccEmails: [] },
        mailbox,
        byEmail,
      ),
    ).toBeUndefined();
  });
});

describe("counterpartAddresses", () => {
  const mailbox = "me@trust-tai.com";

  it("collects every participant except the mailbox, deduped and normalized", () => {
    expect(
      counterpartAddresses(
        {
          providerMessageId: "m1",
          providerThreadId: "t1",
          direction: "inbound",
          fromEmail: "ANA@Example.org",
          toEmails: [mailbox, "ana@example.org"],
          ccEmails: ["team@example.org"],
          occurredAt: "2026-08-22T10:00:00.000Z",
        },
        mailbox,
      ),
    ).toEqual(["ana@example.org", "team@example.org"]);
  });

  it("returns nothing when the mailbox is the only participant", () => {
    expect(
      counterpartAddresses(
        {
          providerMessageId: "m2",
          providerThreadId: "t2",
          direction: "outbound",
          fromEmail: mailbox,
          toEmails: [mailbox],
          ccEmails: [],
          occurredAt: "2026-08-22T10:00:00.000Z",
        },
        mailbox,
      ),
    ).toEqual([]);
  });
});

describe("authorizeUrl", () => {
  function withConfig(run: () => void): void {
    const savedId = process.env["GOOGLE_OAUTH_CLIENT_ID"];
    const savedSecret = process.env["GOOGLE_OAUTH_CLIENT_SECRET"];
    process.env["GOOGLE_OAUTH_CLIENT_ID"] = "test-client";
    process.env["GOOGLE_OAUTH_CLIENT_SECRET"] = "test-secret";
    try {
      run();
    } finally {
      if (savedId === undefined) delete process.env["GOOGLE_OAUTH_CLIENT_ID"];
      else process.env["GOOGLE_OAUTH_CLIENT_ID"] = savedId;
      if (savedSecret === undefined) delete process.env["GOOGLE_OAUTH_CLIENT_SECRET"];
      else process.env["GOOGLE_OAUTH_CLIENT_SECRET"] = savedSecret;
    }
  }

  it("requests labeled reading plus send, never gmail.modify", () => {
    withConfig(() => {
      const url = new URL(
        authorizeUrl({ redirectUri: "https://example.org/cb", state: "signed-state" }),
      );
      const scopes = (url.searchParams.get("scope") ?? "").split(/\s+/);
      expect(scopes).toContain("https://www.googleapis.com/auth/gmail.readonly");
      expect(scopes).toContain("https://www.googleapis.com/auth/gmail.send");
      expect(scopes).toContain("openid");
      expect(scopes).toContain("email");
      expect(scopes.some((scope) => scope.includes("gmail.modify"))).toBe(false);
      expect(scopes).toHaveLength(4);
    });
  });

  it("keeps the reconnect recipe: consent prompt, granted scopes kept, offline access", () => {
    withConfig(() => {
      const url = new URL(
        authorizeUrl({ redirectUri: "https://example.org/cb", state: "signed-state" }),
      );
      expect(url.searchParams.get("prompt")).toBe("consent");
      expect(url.searchParams.get("include_granted_scopes")).toBe("true");
      expect(url.searchParams.get("access_type")).toBe("offline");
    });
  });
});

describe("grantedGmailScopes", () => {
  it("persists send when Google granted it alongside reading", () => {
    expect(
      grantedGmailScopes(
        "openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
      ),
    ).toEqual([
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
    ]);
  });

  it("stays read-only when send was not granted", () => {
    expect(
      grantedGmailScopes("openid email https://www.googleapis.com/auth/gmail.readonly"),
    ).toEqual(["https://www.googleapis.com/auth/gmail.readonly"]);
  });

  it("drops scopes Comms does not understand, even broad ones", () => {
    expect(
      grantedGmailScopes(
        "https://mail.google.com/ https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify",
      ),
    ).toEqual(["https://www.googleapis.com/auth/gmail.readonly"]);
  });

  it("falls back to read-only when Google reports no scope field, send stays blocked", () => {
    expect(grantedGmailScopes(undefined)).toEqual([
      "https://www.googleapis.com/auth/gmail.readonly",
    ]);
    expect(grantedGmailScopes("")).toEqual(["https://www.googleapis.com/auth/gmail.readonly"]);
  });
});

describe("connectionRowFor", () => {
  it("persists the granted scopes exactly, send survives the write", () => {
    const granted = [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
    ];
    const row = connectionRowFor(
      { organizationId: "org-1", accountEmail: "tai@example.org", scopes: granted },
      "user-1",
    );
    expect(row.scopes).toEqual(granted);
    expect(row.provider).toBe("gmail");
    expect(row.status).toBe("connected");
  });

  it("never widens a read-only grant on save", () => {
    const row = connectionRowFor(
      {
        organizationId: "org-1",
        accountEmail: "tai@example.org",
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      },
      "user-1",
    );
    expect(row.scopes).toEqual(["https://www.googleapis.com/auth/gmail.readonly"]);
  });
});

describe("canSendWithScopes", () => {
  it("stays blocked on a read-only grant", () => {
    expect(canSendWithScopes(["https://www.googleapis.com/auth/gmail.readonly"])).toBe(false);
  });

  it("is ready once gmail.send is in the persisted grant", () => {
    expect(
      canSendWithScopes([
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.send",
      ]),
    ).toBe(true);
  });

  it("stays blocked on malformed or missing scope data", () => {
    expect(canSendWithScopes(undefined)).toBe(false);
    expect(canSendWithScopes(null)).toBe(false);
    expect(canSendWithScopes("gmail.send")).toBe(false);
    expect(canSendWithScopes([])).toBe(false);
  });
});

/* ======================================================================
 * Multi-mailbox
 * ==================================================================== */

import {
  GMAIL_READ_SCOPES,
  GMAIL_SEND_SCOPE,
  mailboxFromProvenance,
  resolveSendMailbox,
  type SendMailboxRef,
} from "@/domain/comms-integrations";
import {
  gmailRedirectUri,
  pickGmailConnection,
  REDIRECT_URI_MISMATCH_MESSAGE,
} from "@/lib/comms-gmail.server";
import { mailboxCapabilityOf } from "@/lib/comms-gmail-send.server";

const PRODUCTION_REDIRECT = "https://cmd.trusttai.com/api/public/comms/gmail/connect";

function mailbox(id: string, email: string, canSend: boolean, connected = true): SendMailboxRef {
  return { id, accountEmail: email, canSend, connected };
}

describe("multi-mailbox connections", () => {
  it("two Gmail connection rows can coexist, connecting a second never replaces the first", () => {
    const first = connectionRowFor(
      {
        organizationId: "org",
        accountEmail: "tayeshobajo@gmail.com",
        scopes: [GMAIL_READ_SCOPES[0]!, GMAIL_SEND_SCOPE],
      },
      "user",
    );
    const second = connectionRowFor(
      {
        organizationId: "org",
        accountEmail: "tai@trusttai.com",
        scopes: [GMAIL_READ_SCOPES[0]!],
      },
      "user",
    );
    // Identity is (organization, provider, account_email): two account emails
    // are two rows, and an upsert matches only its own email.
    expect(first.account_email).toBe("tayeshobajo@gmail.com");
    expect(second.account_email).toBe("tai@trusttai.com");
    expect(first.scopes).toEqual([GMAIL_READ_SCOPES[0]!, GMAIL_SEND_SCOPE]);
    expect(second.scopes).toEqual([GMAIL_READ_SCOPES[0]!]);
  });

  it("member actions resolve a specific mailbox by id", () => {
    const rows = [{ id: "a" }, { id: "b" }];
    expect(pickGmailConnection(rows, "b")).toEqual({ kind: "found", row: { id: "b" } });
    expect(pickGmailConnection(rows, "zzz")).toEqual({ kind: "none" });
    expect(pickGmailConnection(rows)).toEqual({ kind: "ambiguous", count: 2 });
    expect(pickGmailConnection([{ id: "a" }])).toEqual({ kind: "found", row: { id: "a" } });
    expect(pickGmailConnection([])).toEqual({ kind: "none" });
  });

  it("each mailbox carries its own capability from its own persisted scopes", () => {
    const readOnly = mailboxCapabilityOf({
      id: "a",
      account_email: "tayeshobajo@gmail.com",
      scopes: [GMAIL_READ_SCOPES[0]!],
      status: "connected",
      cursor: null,
    });
    const sender = mailboxCapabilityOf({
      id: "b",
      account_email: "tai@trusttai.com",
      scopes: [GMAIL_READ_SCOPES[0]!, GMAIL_SEND_SCOPE],
      status: "connected",
      cursor: null,
    });
    expect(readOnly.canSend).toBe(false);
    expect(readOnly.requiredScope).toBe(GMAIL_SEND_SCOPE);
    expect(sender.canSend).toBe(true);
    expect(sender.requiredScope).toBeUndefined();
  });

  it("a reply goes from the mailbox that owns the thread, provenance beats any From choice", () => {
    const connections = [
      mailbox("a", "tayeshobajo@gmail.com", true),
      mailbox("b", "tai@trusttai.com", true),
    ];
    const resolution = resolveSendMailbox({
      connections,
      threadMailbox: "tai@trusttai.com",
      integrationId: "a", // even an explicit choice cannot reroute a reply
    });
    expect(resolution).toEqual({
      kind: "resolved",
      connection: connections[1],
      reason: "thread_owner",
    });
  });

  it("thread ownership is read from message provenance", () => {
    expect(mailboxFromProvenance({ mailbox: "tai@trusttai.com", via: "send" })).toBe(
      "tai@trusttai.com",
    );
    expect(mailboxFromProvenance({ mailbox: " Tai@TrustTai.com " })).toBe("tai@trusttai.com");
    expect(mailboxFromProvenance({})).toBeNull();
    expect(mailboxFromProvenance(null)).toBeNull();
  });

  it("a reply on a thread owned by a read-only mailbox resolves to that mailbox, so only it is blocked", () => {
    const connections = [
      mailbox("a", "tayeshobajo@gmail.com", false),
      mailbox("b", "tai@trusttai.com", true),
    ];
    const resolution = resolveSendMailbox({
      connections,
      threadMailbox: "tayeshobajo@gmail.com",
    });
    // Resolution is scope-blind on purpose: the caller blocks this one mailbox
    // by name instead of silently rerouting the reply to another account.
    expect(resolution).toEqual({
      kind: "resolved",
      connection: connections[0],
      reason: "thread_owner",
    });
  });

  it("a reply on a thread whose mailbox was disconnected is a calm blocked outcome", () => {
    const resolution = resolveSendMailbox({
      connections: [mailbox("b", "tai@trusttai.com", true)],
      threadMailbox: "tayeshobajo@gmail.com",
    });
    expect(resolution).toEqual({ kind: "owner_missing", mailbox: "tayeshobajo@gmail.com" });
  });

  it("a new conversation needs an explicit From only when several mailboxes can send", () => {
    const two = [
      mailbox("a", "tayeshobajo@gmail.com", true),
      mailbox("b", "tai@trusttai.com", true),
    ];
    expect(resolveSendMailbox({ connections: two })).toEqual({
      kind: "needs_choice",
      options: two,
    });
    // One send-capable mailbox keeps the choice invisible and automatic.
    const one = [
      mailbox("a", "tayeshobajo@gmail.com", false),
      mailbox("b", "tai@trusttai.com", true),
    ];
    expect(resolveSendMailbox({ connections: one })).toEqual({
      kind: "resolved",
      connection: one[1],
      reason: "only_send_capable",
    });
    // The explicit choice is honored for a new conversation.
    expect(resolveSendMailbox({ connections: two, integrationId: "a" })).toEqual({
      kind: "resolved",
      connection: two[0],
      reason: "explicit",
    });
    expect(resolveSendMailbox({ connections: two, integrationId: "zzz" })).toEqual({
      kind: "unknown_choice",
    });
    // No send-capable mailbox at all is an honest empty state.
    expect(
      resolveSendMailbox({ connections: [mailbox("a", "tayeshobajo@gmail.com", false)] }),
    ).toEqual({
      kind: "none_send_capable",
      connections: [mailbox("a", "tayeshobajo@gmail.com", false)],
    });
    expect(resolveSendMailbox({ connections: [] })).toEqual({ kind: "none_connected" });
  });

  it("production redirect is the registered cmd.trusttai.com callback, always", () => {
    delete process.env["GOOGLE_OAUTH_REDIRECT_URI"];
    const request = new Request("https://cmd.trusttai.com/api/public/comms/gmail/connect");
    expect(gmailRedirectUri(request)).toBe(PRODUCTION_REDIRECT);
    // Any other production-shaped origin still resolves to the one registered
    // callback. Google accepts only what the OAuth client lists.
    const apex = new Request("https://trusttai.com/api/public/comms/gmail/connect");
    expect(gmailRedirectUri(apex)).toBe(PRODUCTION_REDIRECT);
  });

  it("a preview origin keeps its own callback unless the env var overrides it", () => {
    delete process.env["GOOGLE_OAUTH_REDIRECT_URI"];
    const preview = new Request(
      "https://id-preview--example.lovable.app/api/public/comms/gmail/connect",
    );
    expect(gmailRedirectUri(preview)).toBe(
      "https://id-preview--example.lovable.app/api/public/comms/gmail/connect",
    );
  });

  it("an explicit redirect env var wins (development and preview flows)", () => {
    process.env["GOOGLE_OAUTH_REDIRECT_URI"] =
      "https://id-preview--example.lovable.app/api/public/comms/gmail/connect";
    try {
      const request = new Request("http://localhost:8080/api/public/comms/gmail/connect");
      expect(gmailRedirectUri(request)).toBe(
        "https://id-preview--example.lovable.app/api/public/comms/gmail/connect",
      );
    } finally {
      delete process.env["GOOGLE_OAUTH_REDIRECT_URI"];
    }
  });

  it("the mismatch error names the exact authorized redirect URI Google Cloud must contain", () => {
    expect(REDIRECT_URI_MISMATCH_MESSAGE).toContain(PRODUCTION_REDIRECT);
    expect(REDIRECT_URI_MISMATCH_MESSAGE).toContain("redirect_uri_mismatch");
  });
});

/* ======================================================================
 * Message fidelity: enrichment counting and row construction
 * ==================================================================== */

import { buildMessageRow, classifySyncedMessages } from "@/lib/comms-gmail.server";
import type { NormalizedMessage } from "@/domain/comms-integrations";

function syncedMessage(overrides: Partial<NormalizedMessage>): NormalizedMessage {
  return {
    providerMessageId: "pm-1",
    providerThreadId: "pt-1",
    direction: "inbound",
    fromEmail: "riley@example.com",
    toEmails: ["tai@trusttai.com"],
    ccEmails: [],
    occurredAt: "2026-08-22T10:00:00Z",
    ...overrides,
  };
}

describe("classifySyncedMessages, resync enriches without counting", () => {
  it("an already-stored message is neither counted nor re-emitted", () => {
    const existing = new Set(["pm-1"]);
    const result = classifySyncedMessages(
      [syncedMessage({ bodyText: "The full body, enriched on resync." })],
      existing,
    );
    expect(result.newCount).toBe(0);
    expect(result.newInbound).toEqual([]);
  });

  it("only genuinely new inbound mail raises an event", () => {
    const result = classifySyncedMessages(
      [
        syncedMessage({ providerMessageId: "pm-old" }),
        syncedMessage({ providerMessageId: "pm-new-in", direction: "inbound" }),
        syncedMessage({ providerMessageId: "pm-new-out", direction: "outbound" }),
      ],
      new Set(["pm-old"]),
    );
    expect(result.newCount).toBe(2);
    expect(result.newInbound.map((message) => message.providerMessageId)).toEqual(["pm-new-in"]);
  });
});

describe("buildMessageRow, fidelity columns and inline metadata", () => {
  it("stores body, sanitized html, and inline resources with content ids", () => {
    const row = buildMessageRow({
      organizationId: "org-1",
      relationshipId: "rel-1",
      threadId: "thread-1",
      mailbox: "tai@trusttai.com",
      nowIso: "2026-08-23T00:00:00Z",
      message: syncedMessage({
        bodyText: "Full body here.",
        bodyHtml: "<p>Full <b>body</b> here.</p>",
        attachments: [
          { filename: "brief.pdf", mimeType: "application/pdf", size: 100, attachmentId: "a1" },
        ],
        inlineResources: [
          {
            filename: "logo.png",
            mimeType: "image/png",
            size: 50,
            attachmentId: "a2",
            contentId: "logo@acme",
            inline: true,
          },
        ],
        blockedRemoteImages: 2,
      }),
    });
    expect(row["body_text"]).toBe("Full body here.");
    expect(row["body_html"]).toBe("<p>Full <b>body</b> here.</p>");
    const files = row["attachments"] as Record<string, unknown>[];
    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({ filename: "brief.pdf", attachment_id: "a1" });
    expect(files[1]).toMatchObject({
      attachment_id: "a2",
      content_id: "logo@acme",
      inline: true,
    });
    expect((row["provenance"] as Record<string, unknown>)["blocked_remote_images"]).toBe(2);
    expect((row["provenance"] as Record<string, unknown>)["mailbox"]).toBe("tai@trusttai.com");
  });

  it("leaves body columns null for metadata-era messages", () => {
    const row = buildMessageRow({
      organizationId: "org-1",
      relationshipId: "rel-1",
      threadId: "thread-1",
      mailbox: "tai@trusttai.com",
      nowIso: "2026-08-23T00:00:00Z",
      message: syncedMessage({ snippet: "Just a preview" }),
    });
    expect(row["body_text"]).toBeNull();
    expect(row["body_html"]).toBeNull();
    expect(row["snippet"]).toBe("Just a preview");
  });
});

/* --------------------------------------------- approved-thread continuity */

import {
  buildThreadFetchPath,
  MAX_APPROVED_THREADS_PER_PASS,
  mergeFetchedMessages,
  selectApprovedThreadIds,
  type ObservedThreadRef,
} from "@/lib/comms-gmail.server";

const MAILBOX = "tai@trusttai.com";

function observed(
  providerThreadId: string,
  occurredAt: string,
  mailbox: string | null = MAILBOX,
): ObservedThreadRef {
  return { providerThreadId, mailbox, occurredAt };
}

describe("approved-thread continuity, the label approves the conversation", () => {
  it("A: a thread discovered through the label becomes an approved watched conversation", () => {
    // The discovery pass stored thread-1; it is now approved for refresh.
    const ids = selectApprovedThreadIds({
      observed: [observed("thread-1", "2026-08-20T10:00:00Z")],
      mailbox: MAILBOX,
      approved: new Set(["thread-1"]),
      soleMailbox: true,
    });
    expect(ids).toEqual(["thread-1"]);
  });

  it("B: a later reply is reachable because the approved thread id is refreshed by thread, not by label", () => {
    const ids = selectApprovedThreadIds({
      observed: [observed("thread-1", "2026-08-20T10:00:00Z")],
      mailbox: MAILBOX,
      approved: new Set(["thread-1"]),
      soleMailbox: true,
    });
    // Gmail's own thread endpoint, no label filter anywhere in the path.
    expect(buildThreadFetchPath(ids[0]!)).toBe("/threads/thread-1?format=full");
    expect(buildThreadFetchPath("thread-1")).not.toContain("labelIds");
  });

  it("C: a new unlabeled thread from the same known correspondent is not watched", () => {
    const ids = selectApprovedThreadIds({
      // thread-2 was never approved through the label gate.
      observed: [
        observed("thread-1", "2026-08-20T10:00:00Z"),
        observed("thread-2", "2026-08-21T10:00:00Z"),
      ],
      mailbox: MAILBOX,
      approved: new Set(["thread-1"]),
      soleMailbox: true,
    });
    expect(ids).toEqual(["thread-1"]);
  });

  it("D: unrelated unlabeled mail is never watched", () => {
    const ids = selectApprovedThreadIds({
      observed: [observed("newsletter-thread", "2026-08-22T10:00:00Z")],
      mailbox: MAILBOX,
      approved: new Set(["thread-1"]),
      soleMailbox: true,
    });
    expect(ids).toEqual([]);
  });

  it("E/F: a reply appearing in both discovery and refresh is fetched once", () => {
    const merged = mergeFetchedMessages(
      [{ id: "m-1" }, { id: "m-2" }],
      [{ id: "m-2" }, { id: "m-3" }, { id: "m-3" }],
    );
    expect(merged.map((entry) => entry.id)).toEqual(["m-1", "m-2", "m-3"]);
  });

  it("F: re-selecting the same approved threads is deterministic and deduped", () => {
    const input = {
      observed: [
        observed("thread-1", "2026-08-20T10:00:00Z"),
        observed("thread-1", "2026-08-21T10:00:00Z"),
        observed("thread-2", "2026-08-19T10:00:00Z"),
      ],
      mailbox: MAILBOX,
      approved: new Set(["thread-1", "thread-2"]),
      soleMailbox: true,
    };
    expect(selectApprovedThreadIds(input)).toEqual(["thread-1", "thread-2"]);
    expect(selectApprovedThreadIds(input)).toEqual(selectApprovedThreadIds(input));
  });

  it("G: a mailbox never refreshes a conversation another mailbox observed", () => {
    const ids = selectApprovedThreadIds({
      observed: [
        observed("thread-mine", "2026-08-20T10:00:00Z"),
        observed("thread-theirs", "2026-08-21T10:00:00Z", "other@trusttai.com"),
      ],
      mailbox: MAILBOX,
      approved: new Set(["thread-mine", "thread-theirs"]),
      soleMailbox: false,
    });
    expect(ids).toEqual(["thread-mine"]);
  });

  it("G: legacy threads without mailbox provenance are claimed only by a sole mailbox", () => {
    const legacy = [observed("thread-legacy", "2026-08-20T10:00:00Z", null)];
    expect(
      selectApprovedThreadIds({
        observed: legacy,
        mailbox: MAILBOX,
        approved: new Set(["thread-legacy"]),
        soleMailbox: true,
      }),
    ).toEqual(["thread-legacy"]);
    expect(
      selectApprovedThreadIds({
        observed: legacy,
        mailbox: MAILBOX,
        approved: new Set(["thread-legacy"]),
        soleMailbox: false,
      }),
    ).toEqual([]);
  });

  it("bounds the work: most recent first, capped, never a whole-history scan", () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      observed(`thread-${index}`, `2026-08-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`),
    );
    const ids = selectApprovedThreadIds({
      observed: many,
      mailbox: MAILBOX,
      approved: new Set(many.map((entry) => entry.providerThreadId)),
      soleMailbox: true,
    });
    expect(ids).toHaveLength(MAX_APPROVED_THREADS_PER_PASS);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
