import { describe, expect, it } from "vitest";

import { ensureLabeledRelationship, nameFromEmail } from "@/lib/comms-intake.server";

/**
 * A minimal stand-in for the governed Supabase client: enough table state to
 * prove the laws that matter, one canonical person, one relationship, and a
 * repeated sync that writes nothing new.
 */
function fakeClient(seed?: {
  contacts?: { id: string; email: string }[];
  relationships?: { id: string; email: string; full_name: string }[];
}) {
  const state = {
    contacts: [...(seed?.contacts ?? [])],
    relationships: [...(seed?.relationships ?? [])] as Record<string, unknown>[],
    activities: [] as Record<string, unknown>[],
    inserts: 0,
  };
  let counter = 0;

  function from(table: string) {
    const filters: Record<string, string> = {};
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: string) => {
        filters[column] = value;
        return builder;
      },
      ilike: (column: string, value: string) => {
        filters[column] = value.toLowerCase();
        return builder;
      },
      limit: () => {
        if (table === "contacts") {
          const match = state.contacts.filter((row) => row.email === filters["email"]);
          return Promise.resolve({ data: match, error: null });
        }
        const match = state.relationships.filter((row) => row["email"] === filters["email"]);
        return Promise.resolve({ data: match, error: null });
      },
      insert: (row: Record<string, unknown>) => {
        state.inserts += 1;
        counter += 1;
        const id = `${table}-${counter}`;
        if (table === "contacts") state.contacts.push({ id, email: String(row["email"]) });
        if (table === "comms_relationships") state.relationships.push({ ...row, id });
        if (table === "activities") state.activities.push(row);
        return {
          select: () => ({
            single: () =>
              Promise.resolve({ data: { id, full_name: row["full_name"] }, error: null }),
          }),
          then: (resolve: (value: { error: null }) => unknown) => resolve({ error: null }),
        };
      },
    };
    return builder;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { from } as any, state };
}

const BASE = {
  organizationId: "org-1",
  mailbox: "tai@trusttai.com",
  providerThreadId: "t1",
  providerMessageId: "m1",
  occurredAt: "2026-08-22T10:00:00.000Z",
};

describe("ensureLabeledRelationship", () => {
  it("brings an unknown labeled correspondent in as one person and one relationship", async () => {
    const { client, state } = fakeClient();
    const outcome = await ensureLabeledRelationship(client, {
      ...BASE,
      email: "claire@dozen.com",
      name: "Claire Meneely",
    });
    expect(outcome.created).toBe(true);
    expect(outcome.fullName).toBe("Claire Meneely");
    expect(state.contacts).toHaveLength(1);
    expect(state.relationships).toHaveLength(1);
    // Provenance names the label, the mailbox, and the first observed thread.
    const metadata = state.relationships[0]!["metadata"] as Record<string, Record<string, string>>;
    expect(metadata["gmail_intake"]!["label"]).toBe("Trust Tai/Comms");
    expect(metadata["gmail_intake"]!["mailbox"]).toBe(BASE.mailbox);
    expect(metadata["gmail_intake"]!["first_provider_thread_id"]).toBe("t1");
    // Exactly one creation event, keyed on the person.
    expect(state.activities).toHaveLength(1);
    expect(String(state.activities[0]!["source_event_key"])).toContain("claire@dozen.com");
  });

  it("is idempotent, a repeated pass finds the relationship and writes nothing", async () => {
    const { client, state } = fakeClient();
    const first = await ensureLabeledRelationship(client, { ...BASE, email: "claire@dozen.com" });
    const writesAfterFirst = state.inserts;
    const second = await ensureLabeledRelationship(client, {
      ...BASE,
      providerMessageId: "m2",
      email: "Claire@Dozen.com",
    });
    expect(second.relationshipId).toBe(first.relationshipId);
    expect(second.created).toBe(false);
    expect(state.inserts).toBe(writesAfterFirst);
    expect(state.relationships).toHaveLength(1);
  });

  it("reuses the existing canonical contact rather than creating a parallel person", async () => {
    const { client, state } = fakeClient({
      contacts: [{ id: "contact-existing", email: "sara@warren.co" }],
    });
    const outcome = await ensureLabeledRelationship(client, { ...BASE, email: "sara@warren.co" });
    expect(outcome.created).toBe(true);
    expect(state.contacts).toHaveLength(1);
    expect(state.relationships[0]!["contact_id"]).toBe("contact-existing");
  });

  it("names a person readably when Gmail carried no display name", () => {
    expect(nameFromEmail("claire.meneely@dozen.com")).toBe("Claire Meneely");
    expect(nameFromEmail("sara@warren.co")).toBe("Sara");
  });

  it("refuses an empty address rather than creating an anonymous relationship", async () => {
    const { client } = fakeClient();
    await expect(ensureLabeledRelationship(client, { ...BASE, email: "  " })).rejects.toThrow();
  });
});
