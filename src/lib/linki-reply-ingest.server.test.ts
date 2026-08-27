import { describe, expect, it } from "vitest";

import {
  ingestLinkedInReply,
  normalizeLinkedinUrl,
  resolveSender,
  truncateForSummary,
  type LinkedInReplyObserved,
} from "@/lib/linki-reply-ingest.server";

/**
 * A minimal stand-in for the governed Supabase client — the same shape the
 * comms-intake tests use, extended for the three tables the seam touches:
 * contacts (resolution), comms_relationships / comms_touches (thread append),
 * linkedin_replies (landing ledger), activities (event stream).
 */
interface ContactSeed {
  id: string;
  organization_id?: string;
  metadata: Record<string, unknown>;
}

/** Row shape used by the fake — everything is a plain record. */
interface ContactSeed {
  [key: string]: unknown;
  id: string;
  organization_id?: string;
  metadata: Record<string, unknown>;
}

interface RelationshipSeed {
  [key: string]: unknown;
  id: string;
  organization_id: string;
  contact_id: string;
  created_at?: string;
}

function fakeClient(seed?: {
  contacts?: ContactSeed[];
  relationships?: RelationshipSeed[];
}) {
  const state = {
    contacts: [...(seed?.contacts ?? [])] as Record<string, unknown>[],
    relationships: [...(seed?.relationships ?? [])] as Record<string, unknown>[],
    linkedinReplies: [] as Record<string, unknown>[],
    touches: [] as Record<string, unknown>[],
    activities: [] as Record<string, unknown>[],
    /** Set true and any .insert on the named table throws a non-23505 error. */
    failInsertOn: null as string | null,
  };
  let counter = 0;

  function matchesFilters(table: string, filters: Record<string, string>, orFilter?: string): Record<string, unknown>[] {
    const rows =
      table === "contacts"
        ? state.contacts
        : table === "comms_relationships"
          ? state.relationships
          : [];
    const columnMatches = (row: Record<string, unknown>, column: string, value: string): boolean => {
      if (column === "metadata->>linkedin_url") {
        const meta = row["metadata"] as Record<string, unknown> | undefined;
        return (meta?.["linkedin_url"] as string) === value;
      }
      if (column === "metadata->people->>linkedin_url") {
        const meta = row["metadata"] as Record<string, unknown> | undefined;
        const people = meta?.["people"] as Record<string, unknown> | undefined;
        return (people?.["linkedin_url"] as string) === value;
      }
      return String(row[column]) === value;
    };
    return rows.filter((row) => {
      for (const [column, value] of Object.entries(filters)) {
        if (!columnMatches(row, column, value)) return false;
      }
      if (orFilter) {
        // "col.eq.v,col.eq.v" — PostgREST OR over the two metadata locations.
        const clauses = orFilter.split(",").map((clause) => {
          const [column, op, value] = clause.split(".");
          return { column: column!, op: op!, value: value! };
        });
        if (!clauses.some((clause) => columnMatches(row, clause.column, clause.value))) {
          return false;
        }
      }
      return true;
    });
  }

  function applyUpdate(table: string, filters: Record<string, string>, patch: Record<string, unknown>): void {
    const rows =
      table === "linkedin_replies"
        ? state.linkedinReplies
        : table === "comms_relationships"
          ? state.relationships
          : [];
    for (const row of rows) {
      let ok = true;
      for (const [column, value] of Object.entries(filters)) {
        if (String(row[column]) !== value) {
          ok = false;
          break;
        }
      }
      if (ok) Object.assign(row, patch);
    }
  }

  function from(table: string) {
    const filters: Record<string, string> = {};
    let orFilter: string | undefined;
    let insertedRow: Record<string, unknown> | null = null;
    let updatePatch: Record<string, unknown> | null = null;
    let ordered = false;

    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: string) => {
        filters[column] = value;
        return builder;
      },
      or: (clause: string) => {
        orFilter = clause;
        return builder;
      },
      order: () => {
        ordered = true;
        return builder;
      },
      limit: (n: number) => {
        let rows = matchesFilters(table, filters, orFilter);
        if (table === "comms_relationships" && ordered) {
          rows = [...rows].sort((a, b) =>
            String(a["created_at"] ?? "").localeCompare(String(b["created_at"] ?? "")),
          );
        }
        return Promise.resolve({ data: rows.slice(0, n), error: null });
      },
      insert: (row: Record<string, unknown>) => {
        if (state.failInsertOn === table) {
          return Promise.resolve({
            data: null,
            error: { code: "42P01", message: `forced failure on ${table}` },
          });
        }
        // Simulate the migration's unique (source, external_message_ref)
        // constraint on linkedin_replies: redelivery gets Postgres 23505.
        if (
          table === "linkedin_replies" &&
          state.linkedinReplies.some(
            (existing) =>
              existing["source"] === row["source"] &&
              existing["external_message_ref"] === row["external_message_ref"],
          )
        ) {
          const failure = { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
          return {
            select: () => ({ single: () => Promise.resolve(failure) }),
            then: (resolve: (value: typeof failure) => unknown) => resolve(failure),
          };
        }
        counter += 1;
        const id = `${table}-${counter}`;
        insertedRow = { ...row, id };
        if (table === "contacts") state.contacts.push(insertedRow);
        if (table === "comms_relationships") state.relationships.push(insertedRow);
        if (table === "linkedin_replies") state.linkedinReplies.push(insertedRow);
        if (table === "comms_touches") state.touches.push(insertedRow);
        if (table === "activities") state.activities.push(insertedRow);
        return {
          select: () => ({ single: () => Promise.resolve({ data: insertedRow, error: null }) }),
          then: (resolve: (value: { error: null }) => unknown) => resolve({ error: null }),
        };
      },
      update: (patch: Record<string, unknown>) => {
        updatePatch = patch;
        const updateFilters: Record<string, string> = { ...filters };
        const updateBuilder: Record<string, unknown> = {
          eq: (column: string, value: string) => {
            updateFilters[column] = value;
            return updateBuilder;
          },
          then: (resolve: (value: { error: null }) => unknown) => {
            applyUpdate(table, updateFilters, updatePatch!);
            resolve({ error: null });
          },
        };
        return updateBuilder;
      },
    };
    return builder;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { from } as any, state };
}

const URL_CONFIRMED = "https://www.linkedin.com/in/jonathan-mull";

function confirmedContact(over: Partial<ContactSeed> = {}): ContactSeed {
  return {
    id: over.id ?? "contact-1",
    organization_id: "org-1",
    metadata: {
      linkedin_url: URL_CONFIRMED,
      linkedin_confirmed: true,
      ...(over.metadata ?? {}),
    },
    ...over,
  };
}

function replyInput(over: Partial<LinkedInReplyObserved> = {}): LinkedInReplyObserved {
  return {
    organizationId: "org-1",
    source: "linki",
    externalThreadRef: "thread-abc",
    externalMessageRef: "msg-001",
    senderLinkedinUrl: URL_CONFIRMED,
    senderName: "Jonathan Mull",
    body: "Thanks for the note — let's talk next week.",
    observedAt: "2026-08-27T18:00:00.000Z",
    accountRef: "linki-account-31f9",
    ...over,
  };
}

/* ------------------------------------------------------------ flag off */

describe("feature flag", () => {
  it("is a no-op when LINKI_REPLY_INGESTION_ENABLED is unset (default off)", async () => {
    const { client, state } = fakeClient({ contacts: [confirmedContact()] });
    const result = await ingestLinkedInReply(client, replyInput(), {});
    expect(result.status).toBe("disabled");
    expect(state.linkedinReplies).toHaveLength(0);
    expect(state.touches).toHaveLength(0);
    expect(state.activities).toHaveLength(0);
  });

  it("is a no-op when the flag is explicitly false", async () => {
    const { client, state } = fakeClient({ contacts: [confirmedContact()] });
    const result = await ingestLinkedInReply(client, replyInput(), {
      LINKI_REPLY_INGESTION_ENABLED: "false",
    });
    expect(result.status).toBe("disabled");
    expect(state.linkedinReplies).toHaveLength(0);
  });

  it("runs only when the flag is exactly 'true'", async () => {
    const { client, state } = fakeClient({ contacts: [confirmedContact()] });
    const result = await ingestLinkedInReply(client, replyInput(), {
      LINKI_REPLY_INGESTION_ENABLED: "true",
    });
    expect(result.status).not.toBe("disabled");
    expect(state.linkedinReplies).toHaveLength(1);
  });
});

/* ------------------------------------------------------ URL normalization */

describe("normalizeLinkedinUrl", () => {
  it("canonicalizes host, tracking params, and trailing slash", () => {
    expect(
      normalizeLinkedinUrl("https://LinkedIn.com/in/Jonathan-Mull/?tracking=xyz"),
    ).toBe(URL_CONFIRMED);
  });

  it("reads the nested people-metadata location as the same person", () => {
    // documented behavior parity with peopleMetaOf — both spellings normalize equal
    expect(normalizeLinkedinUrl("www.linkedin.com/in/jonathan-mull")).toBe(URL_CONFIRMED);
  });

  it("rejects non-profile paths and non-LinkedIn hosts", () => {
    expect(normalizeLinkedinUrl("https://www.linkedin.com/company/trusttai")).toBeNull();
    expect(normalizeLinkedinUrl("https://example.com/in/someone")).toBeNull();
    expect(normalizeLinkedinUrl(null)).toBeNull();
  });
});

/* -------------------------------------------------------- resolution rule */

describe("resolveSender", () => {
  it("resolves the sender by confirmed linkedin_url provenance (happy path)", async () => {
    const { client } = fakeClient({ contacts: [confirmedContact()] });
    const outcome = await resolveSender(client, replyInput());
    expect(outcome.contactId).toBe("contact-1");
    expect(outcome.relationshipId).toBeNull(); // no relationship seeded
    expect(outcome.queueReason).toBeUndefined();
  });

  it("never resolves on an unconfirmed linkedin_url", async () => {
    const { client } = fakeClient({
      contacts: [
        {
          id: "contact-unconfirmed",
          metadata: { linkedin_url: URL_CONFIRMED }, // present but NOT confirmed
        },
      ],
    });
    const outcome = await resolveSender(client, replyInput());
    expect(outcome.contactId).toBeNull();
    expect(outcome.queueReason).toMatch(/confirmed LinkedIn route/i);
  });

  it("queues when nothing matches (false negative acceptable, never a guess)", async () => {
    const { client } = fakeClient({
      contacts: [
        confirmedContact({ metadata: { linkedin_url: "https://www.linkedin.com/in/someone-else" } }),
      ],
    });
    const outcome = await resolveSender(client, replyInput());
    expect(outcome.contactId).toBeNull();
    expect(outcome.queueReason).toBeDefined();
  });

  it("queues when MORE THAN ONE contact carries the same confirmed route", async () => {
    const { client } = fakeClient({
      contacts: [confirmedContact({ id: "a" }), confirmedContact({ id: "b" })],
    });
    const outcome = await resolveSender(client, replyInput());
    expect(outcome.contactId).toBeNull();
    expect(outcome.queueReason).toMatch(/disambiguate/i);
  });

  it("queues immediately when the payload has no sender URL", async () => {
    const { client } = fakeClient({ contacts: [confirmedContact()] });
    const outcome = await resolveSender(client, replyInput({ senderLinkedinUrl: undefined }));
    expect(outcome.contactId).toBeNull();
    expect(outcome.queueReason).toMatch(/no sender profile URL/i);
  });
});

/* ------------------------------------------------------- full ingestion */

describe("ingestLinkedInReply — resolved happy path", () => {
  function seeded() {
    return fakeClient({
      contacts: [confirmedContact()],
      relationships: [
        { id: "rel-1", contact_id: "contact-1", organization_id: "org-1", created_at: "2026-08-01" },
      ],
    });
  }

  it("appends to the SAME relationship thread model email uses, channel='linkedin'", async () => {
    const { client, state } = seeded();
    const result = await ingestLinkedInReply(client, replyInput(), {
      LINKI_REPLY_INGESTION_ENABLED: "true",
    });
    expect(result.status).toBe("ingested");
    expect(result.contactId).toBe("contact-1");
    expect(result.relationshipId).toBe("rel-1");
    expect(result.touchId).toBe("comms_touches-2");

    const touch = state.touches[0] as Record<string, unknown> | undefined;
    expect(touch).toBeDefined();
    expect(touch!["relationship_id"]).toBe("rel-1");
    expect(touch!["channel"]).toBe("linkedin");
    expect(touch!["direction"]).toBe("inbound");
    expect(touch!["occurred_at"]).toBe("2026-08-27T18:00:00.000Z");
    expect(touch!["body"]).toBe("Thanks for the note — let's talk next week.");
    const provenance = touch!["provenance"] as Record<string, unknown>;
    expect(provenance["source"]).toBe("linki");
    expect(provenance["external_message_ref"]).toBe("msg-001");
    expect(provenance["account_ref"]).toBe("linki-account-31f9");
  });

  it("starts the reply clock on the relationship, like email inbound", async () => {
    const { client, state } = seeded();
    await ingestLinkedInReply(client, replyInput(), { LINKI_REPLY_INGESTION_ENABLED: "true" });
    const rel = state.relationships[0] as Record<string, unknown> | undefined;
    expect(rel!["last_touch_at"]).toBe("2026-08-27T18:00:00.000Z");
    expect(rel!["response_due_at"]).toBe("2026-08-29T18:00:00.000Z");
  });

  it("lands the ledger row as resolved, stamped with contact + relationship", async () => {
    const { client, state } = seeded();
    await ingestLinkedInReply(client, replyInput(), { LINKI_REPLY_INGESTION_ENABLED: "true" });
    const row = state.linkedinReplies[0] as Record<string, unknown> | undefined;
    expect(row!["status"]).toBe("resolved");
    expect(row!["resolved_contact_id"]).toBe("contact-1");
    expect(row!["relationship_id"]).toBe("rel-1");
    expect(row!["sender_linkedin_url"]).toBe(URL_CONFIRMED);
    expect(row!["body"]).toContain("next week");
  });

  it("emits relationship.message_received with a linki dedupe key", async () => {
    const { client, state } = seeded();
    await ingestLinkedInReply(client, replyInput(), { LINKI_REPLY_INGESTION_ENABLED: "true" });
    const event = state.activities[0] as Record<string, unknown> | undefined;
    expect(event!["event_type"]).toBe("relationship.message_received");
    expect(event!["entity_id"]).toBe("rel-1");
    expect(event!["source_event_key"]).toBe("linki:reply_observed:org-1:msg-001");
    const payload = event!["payload"] as Record<string, unknown>;
    expect(payload["channel"]).toBe("linkedin");
    expect(payload["source"]).toBe("linki");
  });

  it("absorbs redelivery of the same observed reply as a duplicate no-op", async () => {
    const { client, state } = seeded();
    const env = { LINKI_REPLY_INGESTION_ENABLED: "true" };
    const first = await ingestLinkedInReply(client, replyInput(), env);
    expect(first.status).toBe("ingested");
    const second = await ingestLinkedInReply(client, replyInput(), env);
    expect(second.status).toBe("duplicate");
    expect(state.touches).toHaveLength(1);
    expect(state.activities).toHaveLength(1);
  });
});

describe("ingestLinkedInReply — unresolved goes to the human queue", () => {
  it("queues and never auto-creates a contact or relationship", async () => {
    const { client, state } = fakeClient({ contacts: [] });
    const result = await ingestLinkedInReply(client, replyInput(), {
      LINKI_REPLY_INGESTION_ENABLED: "true",
    });
    expect(result.status).toBe("queued");
    expect(result.queueReason).toBeDefined();

    // The observation is kept for the human...
    expect(state.linkedinReplies).toHaveLength(1);
    expect(state.linkedinReplies[0]!["status"]).toBe("pending_resolution");
    // ...but nothing was invented.
    expect(state.contacts).toHaveLength(0);
    expect(state.relationships).toHaveLength(0);
    expect(state.touches).toHaveLength(0);
    expect(state.activities).toHaveLength(0);
  });

  it("parks a contact-resolved sender with no relationship, instead of creating one", async () => {
    const { client, state } = fakeClient({ contacts: [confirmedContact()] });
    const result = await ingestLinkedInReply(client, replyInput(), {
      LINKI_REPLY_INGESTION_ENABLED: "true",
    });
    expect(result.status).toBe("queued");
    expect(result.contactId).toBe("contact-1");
    const row = state.linkedinReplies[0] as Record<string, unknown> | undefined;
    expect(row!["status"]).toBe("pending_resolution");
    expect(row!["resolved_contact_id"]).toBe("contact-1");
    expect(state.touches).toHaveLength(0);
    expect(state.relationships).toHaveLength(0);
  });
});

/* ------------------------------------------------------------- helpers */

describe("truncateForSummary", () => {
  it("keeps short bodies verbatim and tidies whitespace", () => {
    expect(truncateForSummary("hi  there")).toBe("hi there");
  });

  it("truncates long bodies on a word boundary with an ellipsis", () => {
    const long = "word ".repeat(60).trim();
    const cut = truncateForSummary(long);
    expect(cut.length).toBeLessThanOrEqual(141);
    expect(cut.endsWith("…")).toBe(true);
  });
});

describe("input validation", () => {
  it("refuses an empty body", async () => {
    const { client } = fakeClient();
    await expect(
      ingestLinkedInReply(client, replyInput({ body: "   " }), {
        LINKI_REPLY_INGESTION_ENABLED: "true",
      }),
    ).rejects.toThrow(/needs its text/i);
  });

  it("refuses a payload without Linki refs", async () => {
    const { client } = fakeClient();
    await expect(
      ingestLinkedInReply(client, replyInput({ externalMessageRef: "" }), {
        LINKI_REPLY_INGESTION_ENABLED: "true",
      }),
    ).rejects.toThrow(/thread and message refs/i);
  });
});
