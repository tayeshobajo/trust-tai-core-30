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

  it("falls back to a case-insensitive match — Gmail label names are case-insensitively unique", () => {
    expect(findCommsLabelId([{ id: "Label_5", name: "trust tai/comms" }])).toBe("Label_5");
    expect(findCommsLabelId([{ id: "Label_6", name: "TRUST TAI/COMMS" }])).toBe("Label_6");
  });

  it("returns null when the label is missing — the safe no-op trigger, never a fallback", () => {
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
  it("gates on the label id first — unlabeled mail can never enter the candidate set", () => {
    const path = buildLabelListPath({ labelId: "Label_42", days: 2, maxResults: 60 });
    expect(path).toContain("labelIds=Label_42");
    const decoded = decodeURIComponent(path);
    expect(decoded).toContain("q=newer_than:2d -in:spam -in:trash");
    expect(decoded).toContain("maxResults=60");
  });

  it("carries no address scoping — identity is decided after listing, not by mailbox discovery", () => {
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

  it("never matches unknown senders — they cannot be stored or become relationships", () => {
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

  it("requests labeled reading plus send — never gmail.modify", () => {
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

  it("falls back to read-only when Google reports no scope field — send stays blocked", () => {
    expect(grantedGmailScopes(undefined)).toEqual([
      "https://www.googleapis.com/auth/gmail.readonly",
    ]);
    expect(grantedGmailScopes("")).toEqual(["https://www.googleapis.com/auth/gmail.readonly"]);
  });
});

describe("connectionRowFor", () => {
  it("persists the granted scopes exactly — send survives the write", () => {
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
  GMAIL_SEND_SCOPE,
  mailboxFromProvenance,
  resolveSendMailbox,
  type SendMailboxRef,
} from "@/domain/comms-integrations";
import {
  GMAIL_READONLY_SCOPE,
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
  it("two Gmail connection rows can coexist — connecting a second never replaces the first", () => {
    const first = connectionRowFor({
      organizationId: "org",
      accountEmail: "tayeshobajo@gmail.com",
      refreshTokenEnc: "a",
      accessTokenEnc: "b",
      expiresAt: "2026-01-01T00:00:00.000Z",
      scopes: [GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE],
    });
    const second = connectionRowFor({
      organizationId: "org",
      accountEmail: "tai@trusttai.com",
      refreshTokenEnc: "c",
      accessTokenEnc: "d",
      expiresAt: "2026-01-01T00:00:00.000Z",
      scopes: [GMAIL_READONLY_SCOPE],
    });
    // Identity is (organization, provider, account_email): two account emails
    // are two rows, and an upsert matches only its own email.
    expect(first.account_email).toBe("tayeshobajo@gmail.com");
    expect(second.account_email).toBe("tai@trusttai.com");
    expect(first.scopes).toEqual([GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE]);
    expect(second.scopes).toEqual([GMAIL_READONLY_SCOPE]);
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
      scopes: [GMAIL_READONLY_SCOPE],
      status: "connected",
      cursor: null,
    });
    const sender = mailboxCapabilityOf({
      id: "b",
      accountEmail: "tai@trusttai.com",
      account_email: "tai@trusttai.com",
      scopes: [GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE],
      status: "connected",
      cursor: null,
    });
    expect(readOnly.canSend).toBe(false);
    expect(readOnly.requiredScope).toBe(GMAIL_SEND_SCOPE);
    expect(sender.canSend).toBe(true);
    expect(sender.requiredScope).toBeUndefined();
  });

  it("a reply goes from the mailbox that owns the thread — provenance beats any From choice", () => {
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
    ).toEqual({ kind: "none_send_capable", connections: [mailbox("a", "tayeshobajo@gmail.com", false)] });
    expect(resolveSendMailbox({ connections: [] })).toEqual({ kind: "none_connected" });
  });

  it("production redirect is deterministic unless explicitly overridden", () => {
    delete process.env["GOOGLE_OAUTH_REDIRECT_URI"];
    const request = new Request(
      "https://id-preview--example.lovable.app/api/public/comms/gmail/connect",
    );
    expect(gmailRedirectUri(request)).toBe(PRODUCTION_REDIRECT);
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
