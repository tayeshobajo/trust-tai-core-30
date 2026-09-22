/**
 * A verified professional address saved in Scout must reach the shared record.
 *
 * Prepare outreach used to put a researched person on record with the address
 * marked only "found", because a by-hand entry may never claim verification.
 * The result was that a real, provider-verified address arrived in Comms as
 * unchecked and the person read as unreachable.
 *
 * These tests pin the one narrow path that fixes it: an address stored on a
 * durable Scout People row may be carried across as verified, with the
 * provider named, and a title the lookup recovered travels with it. Without a
 * saved Scout row, nothing is carried and nothing claims verification.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeSupabase } from "./fake-supabase";

const db = createFakeSupabase();

vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: { from: (table: string) => db.from(table) },
}));

vi.mock("@/data/people/registry", () => ({
  getPeopleProvider: () => null,
}));

const { peopleService } = await import("./people-service");

const CONTEXT = { organizationId: "org-1", userId: "user-1" };

beforeEach(() => {
  for (const table of Object.keys(db.tables)) db.tables[table] = [];
  db.tables["contacts"] = [];
  db.tables["activities"] = [];
});

async function personOnRecord() {
  const { person } = await peopleService.addManual(
    { prospectId: "prospect-1", fullName: "Robin Shah" },
    CONTEXT,
  );
  return person;
}

describe("carrying a Scout-verified address onto the shared record", () => {
  it("stores the address as verified, names the provider, and keeps the title", async () => {
    const person = await personOnRecord();
    expect(person.emailStatus).not.toBe("verified");

    const updated = await peopleService.recordProviderVerifiedEmail(
      person,
      {
        email: "Robin@ThymeCare.com",
        scoutPersonId: "scout-row-1",
        providerLabel: "Apollo",
        roleTitle: "Co-founder; Executive Chairman",
      },
      CONTEXT,
    );

    expect(updated.email).toBe("robin@thymecare.com");
    expect(updated.emailStatus).toBe("verified");
    expect(updated.emailCheckedBy).toBe("Apollo");
    expect(updated.roleTitle).toBe("Co-founder; Executive Chairman");
  });

  it("refuses when no saved Scout person backs the verification", async () => {
    const person = await personOnRecord();
    await expect(
      peopleService.recordProviderVerifiedEmail(
        person,
        { email: "robin@thymecare.com", scoutPersonId: "  ", providerLabel: "Apollo" },
        CONTEXT,
      ),
    ).rejects.toThrow(/saved on a Scout person/i);
    expect(db.tables["contacts"]?.[0]?.["email"] ?? null).toBeNull();
  });

  it("never overwrites a title somebody already entered by hand", async () => {
    const { person } = await peopleService.addManual(
      { prospectId: "prospect-1", fullName: "Robin Shah", roleTitle: "Co-founder" },
      CONTEXT,
    );
    const updated = await peopleService.recordProviderVerifiedEmail(
      person,
      {
        email: "robin@thymecare.com",
        scoutPersonId: "scout-row-1",
        providerLabel: "Apollo",
        roleTitle: "Executive Chairman",
      },
      CONTEXT,
    );
    expect(updated.roleTitle).toBe("Co-founder");
  });
});
