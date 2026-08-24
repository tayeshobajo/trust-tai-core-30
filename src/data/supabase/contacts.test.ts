/**
 * A human confirmation must land where the next read looks.
 *
 * Regression: contacts written by the discovery pipeline nest people-owned
 * fields under `metadata.people`, and `toPerson` resolves that nested object
 * first. A write that stamped `email_status` at the metadata root was
 * invisible to the next read, so "Confirm this address" saved successfully
 * yet the blocker never cleared — the click looked like nothing happened.
 *
 * These tests pin the shared read/write location for both metadata shapes
 * and prove unrelated metadata survives a confirmation untouched.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeSupabase, type FakeRow } from "./fake-supabase";

const db = createFakeSupabase();

vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: { from: (table: string) => db.from(table) },
}));

vi.mock("@/data/people/registry", () => ({
  getPeopleProvider: () => null,
}));

const { listProspectContacts } = await import("./contacts");
const { peopleService } = await import("./people-service");

const CONTEXT = { organizationId: "org-1", userId: "user-1" };

/** The exact shape the discovery pipeline writes today (scout-discover). */
function legacyDiscoveryRow(): FakeRow {
  return {
    id: "contact-legacy",
    organization_id: "org-1",
    client_id: null,
    full_name: "Sourced Founder",
    title: "Founder",
    email: "founder@example.com",
    phone: null,
    created_by: "user-1",
    created_at: "2026-08-20T00:00:00.000Z",
    updated_at: "2026-08-20T00:00:00.000Z",
    metadata: {
      scout_discovery: { run_id: "run-1", query: "artisan bakeries" },
      people: {
        prospect_id: "prospect-1",
        source_id: "scout_discovery",
        source_url: "https://example.com/about",
        email_status: "found",
        confidence: "observed",
        decision_maker_likelihood: "high",
        note: "Read from a public page during market sourcing.",
        provenance: {
          appId: "scout",
          actor: { type: "intelligence", id: "scout-discover" },
          observedAt: "2026-08-20T00:00:00.000Z",
        },
      },
    },
  };
}

beforeEach(() => {
  db.tables["contacts"] = [];
  db.tables["activities"] = [];
});

describe("contacts metadata round trip", () => {
  it("confirming an address on a root-metadata contact persists and reads verified", async () => {
    const person = await peopleService.addManual(
      { prospectId: "prospect-1", fullName: "Root Person", email: "root@example.com" },
      CONTEXT,
    );
    await peopleService.confirmEmail(person, CONTEXT);

    const [reRead] = await listProspectContacts("org-1", "prospect-1");
    expect(reRead?.emailStatus).toBe("verified");
    expect(reRead?.confidence).toBe("human_confirmed");
    expect(reRead?.emailCheckedBy).toBe("human");
    expect(reRead?.emailCheckedAt).toBeTruthy();

    const stored = db.tables["contacts"]![0]!;
    const metadata = stored["metadata"] as Record<string, unknown>;
    expect(metadata["email_status"]).toBe("verified");
    expect(metadata["people"]).toBeUndefined();
  });

  it("confirming an address on a legacy nested-metadata contact persists and reads verified", async () => {
    db.tables["contacts"] = [legacyDiscoveryRow()];

    const [before] = await listProspectContacts("org-1", "prospect-1");
    expect(before?.emailStatus).toBe("found");

    await peopleService.confirmEmail(before!, CONTEXT);

    const [after] = await listProspectContacts("org-1", "prospect-1");
    expect(after?.emailStatus).toBe("verified");
    expect(after?.confidence).toBe("human_confirmed");
    expect(after?.emailCheckedBy).toBe("human");
    expect(after?.emailCheckedAt).toBeTruthy();

    // The write landed inside the nested object the reader resolves — not at
    // the root, where this record never looks.
    const stored = db.tables["contacts"]![0]!;
    const metadata = stored["metadata"] as Record<string, unknown>;
    const nested = metadata["people"] as Record<string, unknown>;
    expect(nested["email_status"]).toBe("verified");
    expect(nested["email_checked_by"]).toBe("human");
    expect(nested["email_checked_at"]).toBeTruthy();
    expect(metadata["email_status"]).toBeUndefined();
  });

  it("unrelated metadata — root and nested — survives a confirmation", async () => {
    db.tables["contacts"] = [legacyDiscoveryRow()];
    const [before] = await listProspectContacts("org-1", "prospect-1");
    await peopleService.confirmEmail(before!, CONTEXT);

    const stored = db.tables["contacts"]![0]!;
    const metadata = stored["metadata"] as Record<string, unknown>;
    expect(metadata["scout_discovery"]).toEqual({
      run_id: "run-1",
      query: "artisan bakeries",
    });
    const nested = metadata["people"] as Record<string, unknown>;
    expect(nested["decision_maker_likelihood"]).toBe("high");
    expect(nested["note"]).toBe("Read from a public page during market sourcing.");
    expect(nested["source_url"]).toBe("https://example.com/about");
    expect((nested["provenance"] as Record<string, unknown>)["appId"]).toBe("scout");
  });

  it("a confirmation does not disturb the record's own fields", async () => {
    db.tables["contacts"] = [legacyDiscoveryRow()];
    const [before] = await listProspectContacts("org-1", "prospect-1");
    await peopleService.confirmEmail(before!, CONTEXT);

    const stored = db.tables["contacts"]![0]!;
    expect(stored["full_name"]).toBe("Sourced Founder");
    expect(stored["title"]).toBe("Founder");
    expect(stored["email"]).toBe("founder@example.com");
  });
});
