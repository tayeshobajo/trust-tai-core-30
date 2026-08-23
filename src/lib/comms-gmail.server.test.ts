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
