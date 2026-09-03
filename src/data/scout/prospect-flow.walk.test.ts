/**
 * The prospect walk, proved end to end.
 *
 * A company is created in Scout, a person is confirmed on the Person card,
 * and a Comms message arrives on that conversation. The walk asserts the one
 * thing that must never break: the message lands back on the Scout company
 * against the right person.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeSupabase } from "../supabase/fake-supabase";

const db = createFakeSupabase();

vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: { from: (table: string) => db.from(table) },
}));

vi.mock("@/data/people/registry", () => ({
  getPeopleProvider: () => null,
}));

const { peopleService } = await import("../supabase/people-service");
const { saveProspectPerson } = await import("./person-card");
const { listProspectConversations } = await import("./conversation");

const CONTEXT = { organizationId: "org-1", userId: "user-1" };
const PROSPECT_ID = "prospect-walk-1";

beforeEach(() => {
  for (const table of Object.keys(db.tables)) db.tables[table] = [];
  db.tables["contacts"] = [];
  db.tables["activities"] = [];
  db.tables["comms_relationships"] = [];
  db.tables["comms_drafts"] = [];
  db.tables["comms_messages"] = [];
});

describe("Scout company → Person card → Comms → Scout inbox", () => {
  it("carries one person through the whole walk", async () => {
    const person = await peopleService.addManual(
      { prospectId: PROSPECT_ID, fullName: "Dana Reyes", email: "dana@northline.com" },
      CONTEXT,
    );

    const saved = await saveProspectPerson({
      ...CONTEXT,
      prospectId: PROSPECT_ID,
      companyName: "Northline Systems",
      person,
      identity: {
        fullName: "Dana Reyes",
        roleTitle: "Head of Operations",
        companyName: "Northline Systems",
      },
    });

    // Saving prepares exactly one first message on a real relationship.
    expect(saved.prepared?.created).toBe(true);
    const relationshipId = saved.prepared!.relationshipId;

    const relationshipRow = db.tables["comms_relationships"]!.find(
      (row) => row["id"] === relationshipId,
    );
    expect(relationshipRow?.["prospect_id"]).toBe(PROSPECT_ID);
    expect(relationshipRow?.["contact_id"]).toBe(person.id);

    // Re-saving the card never multiplies drafts.
    const again = await saveProspectPerson({
      ...CONTEXT,
      prospectId: PROSPECT_ID,
      companyName: "Northline Systems",
      person,
      identity: {
        fullName: "Dana Reyes",
        roleTitle: "Head of Operations",
        companyName: "Northline Systems",
      },
    });
    expect(again.prepared?.created).toBe(false);
    expect(again.prepared?.relationshipId).toBe(relationshipId);

    // A labeled Gmail reply arrives on that conversation.
    db.tables["comms_messages"]!.push({
      id: "message-1",
      organization_id: "org-1",
      relationship_id: relationshipId,
      provider: "gmail",
      provider_message_id: "gmail-1",
      provider_thread_id: "thread-1",
      mailbox: "tai@trusttai.com",
      direction: "inbound",
      subject: "Re: Northline Systems",
      snippet: "Happy to talk next week.",
      body_text: "Happy to talk next week.",
      from_name: "Dana Reyes",
      from_email: "dana@northline.com",
      to_emails: ["tai@trusttai.com"],
      occurred_at: "2026-08-30T15:00:00.000Z",
      created_at: "2026-08-30T15:00:00.000Z",
      metadata: {},
    });

    const conversations = await listProspectConversations("org-1", PROSPECT_ID);
    expect(conversations).toHaveLength(1);
    expect(conversations[0]?.relationship.fullName).toBe("Dana Reyes");
    expect(conversations[0]?.messages.map((message) => message.subject)).toEqual([
      "Re: Northline Systems",
    ]);
  });
});
