import { describe, expect, it } from "vitest";

import {
  buildKnownCorrespondentQueries,
  findTrackedCounterpart,
  parseAddress,
  type RelationshipRow,
} from "@/lib/comms-gmail.server";

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

describe("buildKnownCorrespondentQueries", () => {
  it("scopes every chunk to known addresses only — noise can never enter the candidate set", () => {
    const queries = buildKnownCorrespondentQueries(
      ["john@example.com", "ana@example.org"],
      2,
    );
    expect(queries).toHaveLength(1);
    expect(queries[0]).toBe(
      "newer_than:2d -in:spam -in:trash (from:john@example.com OR to:john@example.com OR from:ana@example.org OR to:ana@example.org)",
    );
    // Nothing in the query admits an arbitrary mailbox message.
    expect(queries[0]).not.toMatch(/newsletter|noreply/);
  });

  it("covers both directions: inbound FROM and outbound TO/CC (Gmail to: matches To, Cc, Bcc)", () => {
    const [query] = buildKnownCorrespondentQueries(["tai@trust-tai.com"], 30);
    expect(query).toContain("from:tai@trust-tai.com");
    expect(query).toContain("to:tai@trust-tai.com");
  });

  it("keeps the overlap window and spam/trash exclusion on every chunk", () => {
    const many = Array.from({ length: 45 }, (_, i) => `person${i}@example.com`);
    const queries = buildKnownCorrespondentQueries(many, 2);
    expect(queries.length).toBeGreaterThan(1);
    for (const query of queries) {
      expect(query.startsWith("newer_than:2d -in:spam -in:trash (")).toBe(true);
      expect(query.length).toBeLessThanOrEqual(1200);
    }
    // Every address appears in exactly one chunk, in both directions.
    const joined = queries.join(" ");
    for (const email of many) {
      expect(joined.split(`from:${email}`).length - 1).toBe(1);
      expect(joined.split(`to:${email}`).length - 1).toBe(1);
    }
  });

  it("returns no queries for an empty tracked set — zero Gmail list work", () => {
    expect(buildKnownCorrespondentQueries([], 2)).toEqual([]);
    expect(buildKnownCorrespondentQueries(["  ", ""], 2)).toEqual([]);
  });

  it("dedupes and normalizes addresses", () => {
    const queries = buildKnownCorrespondentQueries(
      ["Tai@Trust-Tai.com", "tai@trust-tai.com"],
      2,
    );
    expect(queries).toHaveLength(1);
    expect(queries[0]!.split("from:tai@trust-tai.com").length - 1).toBe(1);
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
