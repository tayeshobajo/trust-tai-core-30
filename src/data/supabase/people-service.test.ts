/**
 * Integration tests for the People layer.
 *
 * These run the real service, the real contacts mapper, and the real activity
 * writer against an in-memory Supabase stand-in, so they check the behaviour
 * that matters in production: what gets stored, what provenance travels with
 * it, what the activity stream records, and what a provider is not allowed to
 * overwrite.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { isReachable, type PeopleProvider, type PersonDraft } from "@/domain/people";
import type { ProspectCandidate } from "@/domain/scout";

import { createFakeSupabase, type FakeRow } from "./fake-supabase";

const db = createFakeSupabase();

vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: {
    from: (table: string) => db.from(table),
  },
}));

const providers = new Map<string, PeopleProvider>();
vi.mock("@/data/people/registry", () => ({
  getPeopleProvider: (id: string) => providers.get(id) ?? null,
}));

const { peopleService } = await import("./people-service");

const CONTEXT = { organizationId: "org-1", userId: "user-1" };
const PROSPECT_ID = "prospect-1";

function candidate(): ProspectCandidate {
  return {
    prospect: {
      id: PROSPECT_ID,
      organizationId: "org-1",
      name: "Northbeam Studio",
      websiteUrl: "https://northbeam.example",
      status: "discovered",
      source: "scout_live_website",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    signals: [],
    fit: { whyItFits: "", strongestSignal: "", missingInputs: [] },
    evaluation: {
      score: 0,
      light: "neutral",
      scoreable: false,
      criteria: [],
      explanation: "",
      strongestSignal: "",
      evaluatorVersion: "test",
      icpVersion: null,
      evaluatedAt: new Date().toISOString(),
    },
  } as unknown as ProspectCandidate;
}

function stubProvider(id: string, drafts: PersonDraft[], available = true): PeopleProvider {
  const provider: PeopleProvider = {
    id,
    label: `Test source ${id}`,
    description: "Test source",
    kind: "enrichment",
    approved: true,
    baseConfidence: "asserted_by_provider",
    async available() {
      return available;
    },
    async discover() {
      return drafts;
    },
  };
  providers.set(id, provider);
  return provider;
}

function contacts(): FakeRow[] {
  return db.tables["contacts"] ?? [];
}

function activities(): FakeRow[] {
  return db.tables["activities"] ?? [];
}

function meta(row: FakeRow): Record<string, unknown> {
  return (row["metadata"] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  db.tables["contacts"] = [];
  db.tables["activities"] = [];
  providers.clear();
});

describe("provider ingestion", () => {
  it("stores what a provider returns with its source and provenance intact", async () => {
    stubProvider("test-source", [
      {
        fullName: "Ada Rowe",
        roleTitle: "Founder",
        email: "ADA@northbeam.example",
        sourceUrl: "https://northbeam.example/team",
        confidence: "observed",
      },
    ]);

    const result = await peopleService.ingest("test-source", candidate(), CONTEXT);

    expect(result.added).toHaveLength(1);
    const person = result.added[0]!;
    expect(person.fullName).toBe("Ada Rowe");
    expect(person.seniority).toBe("founder");
    // Addresses are stored lowercased, and never claimed as verified.
    expect(person.email).toBe("ada@northbeam.example");
    expect(person.emailStatus).toBe("found");
    expect(person.sourceId).toBe("test-source");
    expect(person.sourceUrl).toBe("https://northbeam.example/team");
    expect(person.provenance.appId).toBe("scout");
    expect(person.provenance.actor).toEqual({ type: "user", id: "user-1" });
  });

  it("writes the person to Supabase scoped to the organization and prospect", async () => {
    stubProvider("test-source", [{ fullName: "Ada Rowe", roleTitle: "Founder" }]);
    await peopleService.ingest("test-source", candidate(), CONTEXT);

    expect(contacts()).toHaveLength(1);
    const row = contacts()[0]!;
    expect(row["organization_id"]).toBe("org-1");
    expect(row["full_name"]).toBe("Ada Rowe");
    expect(row["created_by"]).toBe("user-1");
    expect(meta(row)["prospect_id"]).toBe(PROSPECT_ID);
    expect(meta(row)["source_id"]).toBe("test-source");
    expect(meta(row)["provenance"]).toMatchObject({ appId: "scout" });
  });

  it("records one contact.created activity event per person ingested", async () => {
    stubProvider("test-source", [
      { fullName: "Ada Rowe", roleTitle: "Founder" },
      { fullName: "Jon Mears", roleTitle: "Head of Operations" },
    ]);

    await peopleService.ingest("test-source", candidate(), CONTEXT);

    const events = activities();
    expect(events).toHaveLength(2);
    expect(events.every((event) => event["event_type"] === "contact.created")).toBe(true);
    expect(events[0]!["app_key"]).toBe("scout");
    expect(events[0]!["actor_user_id"]).toBe("user-1");
    expect(events[0]!["entity_type"]).toBe("contact");
    const payload = events[0]!["payload"] as Record<string, unknown>;
    expect(payload["provider"]).toBe("test-source");
    expect(payload["provenance"]).toMatchObject({ appId: "scout" });
  });

  it("refuses a source that is not on the approved registry", async () => {
    await expect(peopleService.ingest("shadow-vendor", candidate(), CONTEXT)).rejects.toThrow(
      /not approved/i,
    );
    expect(contacts()).toHaveLength(0);
  });

  it("stores nothing and explains itself when an approved source is not connected", async () => {
    stubProvider("test-source", [{ fullName: "Ada Rowe" }], false);

    const result = await peopleService.ingest("test-source", candidate(), CONTEXT);

    expect(result.added).toHaveLength(0);
    expect(result.note).toMatch(/not connected/i);
    expect(contacts()).toHaveLength(0);
  });
});

describe("deduping", () => {
  it("does not duplicate a person a second run returns again", async () => {
    stubProvider("test-source", [{ fullName: "Ada Rowe", roleTitle: "Founder" }]);

    await peopleService.ingest("test-source", candidate(), CONTEXT);
    const second = await peopleService.ingest("test-source", candidate(), CONTEXT);

    expect(contacts()).toHaveLength(1);
    expect(second.added).toHaveLength(0);
    expect(second.skipped).toBe(1);
  });

  it("matches on email even when the name is written differently", async () => {
    stubProvider("test-source", [{ fullName: "Ada Rowe", email: "ada@northbeam.example" }]);
    await peopleService.ingest("test-source", candidate(), CONTEXT);

    stubProvider("test-source", [
      { fullName: "Ada R. Rowe", email: "ada@northbeam.example", roleTitle: "Founder" },
    ]);
    const second = await peopleService.ingest("test-source", candidate(), CONTEXT);

    expect(contacts()).toHaveLength(1);
    // The gap was filled rather than a second record created.
    expect(second.added[0]?.roleTitle).toBe("Founder");
  });

  it("fills gaps on a provider-owned record without downgrading it", async () => {
    stubProvider("test-source", [{ fullName: "Ada Rowe" }]);
    await peopleService.ingest("test-source", candidate(), CONTEXT);

    stubProvider("test-source", [
      { fullName: "Ada Rowe", roleTitle: "Founder", email: "ada@northbeam.example" },
    ]);
    const second = await peopleService.ingest("test-source", candidate(), CONTEXT);

    const person = second.added[0]!;
    expect(person.roleTitle).toBe("Founder");
    expect(person.email).toBe("ada@northbeam.example");
    expect(person.emailStatus).toBe("found");
    expect(activities().some((e) => e["event_type"] === "contact.updated")).toBe(true);
  });

  it("never lets a provider overwrite a record a person entered by hand", async () => {
    await peopleService.addManual(
      { prospectId: PROSPECT_ID, fullName: "Ada Rowe", roleTitle: "Founder & CEO" },
      CONTEXT,
    );

    stubProvider("test-source", [
      { fullName: "ada rowe", roleTitle: "Marketing Assistant", email: "wrong@example.com" },
    ]);
    const result = await peopleService.ingest("test-source", candidate(), CONTEXT);

    expect(result.added).toHaveLength(0);
    expect(result.skipped).toBe(1);
    expect(contacts()).toHaveLength(1);
    expect(contacts()[0]!["title"]).toBe("Founder & CEO");
    expect(contacts()[0]!["email"]).toBeNull();
  });

  it("keeps people belonging to different prospects apart", async () => {
    stubProvider("test-source", [{ fullName: "Ada Rowe" }]);
    await peopleService.ingest("test-source", candidate(), CONTEXT);

    const other = candidate();
    other.prospect.id = "prospect-2";
    await peopleService.ingest("test-source", other, CONTEXT);

    expect(contacts()).toHaveLength(2);
    expect(await peopleService.list("org-1", PROSPECT_ID)).toHaveLength(1);
    expect(await peopleService.list("org-1", "prospect-2")).toHaveLength(1);
  });
});

describe("email status and human confirmation", () => {
  it("stamps who checked an address and when a human confirms it", async () => {
    const { person } = await peopleService.addManual(
      { prospectId: PROSPECT_ID, fullName: "Ada Rowe", email: "ada@northbeam.example" },
      CONTEXT,
    );
    expect(person.emailStatus).toBe("found");
    expect(person.emailCheckedAt).toBeUndefined();

    const confirmed = await peopleService.confirmEmail(person, CONTEXT);

    expect(confirmed.emailStatus).toBe("verified");
    expect(confirmed.confidence).toBe("human_confirmed");
    expect(confirmed.emailCheckedBy).toBe("human");
    expect(confirmed.emailCheckedAt).toBeTruthy();
    expect(
      activities().some(
        (event) =>
          event["event_type"] === "contact.updated" &&
          String(event["summary"]).includes("confirmed"),
      ),
    ).toBe(true);
  });

  it("records a provider verdict against the provider, not the person", async () => {
    const provider = stubProvider("test-source", []);
    provider.verifyEmail = async (email: string) => ({ email, status: "bounced" as const });

    const { person } = await peopleService.addManual(
      { prospectId: PROSPECT_ID, fullName: "Ada Rowe", email: "ada@northbeam.example" },
      CONTEXT,
    );
    const checked = await peopleService.verifyEmail("test-source", person, CONTEXT);

    expect(checked.emailStatus).toBe("bounced");
    expect(checked.emailCheckedBy).toBe("Test source test-source");
    expect(checked.emailCheckedAt).toBeTruthy();
  });

  it("refuses to verify an address that does not exist", async () => {
    const { person } = await peopleService.addManual(
      { prospectId: PROSPECT_ID, fullName: "Ada Rowe" },
      CONTEXT,
    );
    await expect(peopleService.confirmEmail(person, CONTEXT)).rejects.toThrow(/no address/i);
  });
});

describe("linkedin route confirmation", () => {
  it("stamps the human-confirmed LinkedIn route with full provenance", async () => {
    const { person } = await peopleService.addManual(
      { prospectId: PROSPECT_ID, fullName: "Ada Rowe", roleTitle: "Founder" },
      CONTEXT,
    );
    expect(person.linkedinConfirmed).toBeFalsy();
    expect(isReachable(person)).toBe(false);

    const confirmed = await peopleService.confirmLinkedinRoute(
      person,
      {
        linkedinUrl: "https://www.linkedin.com/in/ada-rowe-example/",
        fullName: "Ada Rowe",
        headline: "Founder at Northbeam",
        location: "Nashville",
        degree: null,
        company: null,
        why: ["Company match: Northbeam"],
        score: 3,
      },
      CONTEXT,
    );

    expect(confirmed.linkedinUrl).toBe("https://www.linkedin.com/in/ada-rowe-example/");
    expect(confirmed.linkedinConfirmed).toBe(true);
    expect(confirmed.linkedinProvider).toBe("zenmode");
    expect(confirmed.linkedinConfidence).toBe("confirmed");
    expect(confirmed.linkedinCheckedAt).toBeTruthy();
    expect(confirmed.confidence).toBe("human_confirmed");
    expect(isReachable(confirmed)).toBe(true);
    expect(
      activities().some(
        (event) =>
          event["event_type"] === "contact.updated" &&
          String(event["summary"]).includes("LinkedIn route was confirmed"),
      ),
    ).toBe(true);
  });

  it("does not let a later lookup overwrite the human confirmation path", async () => {
    const { person } = await peopleService.addManual(
      { prospectId: PROSPECT_ID, fullName: "Ada Rowe", roleTitle: "Founder" },
      CONTEXT,
    );
    const confirmed = await peopleService.confirmLinkedinRoute(
      person,
      {
        linkedinUrl: "https://www.linkedin.com/in/ada-rowe-example/",
        fullName: "Ada Rowe",
        headline: null,
        location: null,
        degree: null,
        company: null,
        why: [],
        score: 0,
      },
      CONTEXT,
    );

    const row = (db.tables["contacts"] ?? []).find((r) => r["id"] === confirmed.id);
    const storedMeta = meta(row as FakeRow);
    expect(storedMeta["linkedin_confirmed"]).toBe(true);
    // "zenmode" since 2026-09-09, when the Linki lookup was removed. Rows written
    // before that still read "linki" — that is real provenance and is never rewritten.
    expect(storedMeta["linkedin_provider"]).toBe("zenmode");
  });
});

describe("manual entry", () => {
  it("marks a hand-entered person as human confirmed with a manual source", async () => {
    const { person } = await peopleService.addManual(
      { prospectId: PROSPECT_ID, fullName: "  Ada Rowe  ", roleTitle: "Founder" },
      CONTEXT,
    );

    expect(person.fullName).toBe("Ada Rowe");
    expect(person.confidence).toBe("human_confirmed");
    expect(person.sourceId).toBe("manual");
    const payload = activities()[0]!["payload"] as Record<string, unknown>;
    expect(payload["entered_by"]).toBe("human");
  });

  it("will not save a person without a name", async () => {
    await expect(
      peopleService.addManual({ prospectId: PROSPECT_ID, fullName: "   " }, CONTEXT),
    ).rejects.toThrow(/needs a name/i);
    expect(contacts()).toHaveLength(0);
  });

  it("cannot yield a verified address: a by-hand entry is capped at found", async () => {
    // The type already refuses "verified"; a caller dodging the compiler is
    // clamped at runtime too. Verified is earned via confirmEmail/setRoute.
    const { person } = await peopleService.addManual(
      {
        prospectId: PROSPECT_ID,
        fullName: "Ada Rowe",
        email: "ada@northbeam.example",
        emailStatus: "verified" as unknown as "found",
      },
      CONTEXT,
    );
    expect(person.emailStatus).toBe("found");
  });
});

describe("manual entry deduping", () => {
  it("matches on email across the whole organization, even for another prospect", async () => {
    await peopleService.addManual(
      { prospectId: PROSPECT_ID, fullName: "Ada Rowe", email: "ada@northbeam.example" },
      CONTEXT,
    );

    const { person, matchedExisting } = await peopleService.addManual(
      { prospectId: "prospect-2", fullName: "A. Rowe", email: "ADA@northbeam.example" },
      CONTEXT,
    );

    expect(matchedExisting).toBe(true);
    expect(contacts()).toHaveLength(1);
    expect(person.fullName).toBe("Ada Rowe");
  });

  it("matches on name only inside the same prospect, despite case and spacing noise", async () => {
    const first = await peopleService.addManual(
      { prospectId: PROSPECT_ID, fullName: "Ada Rowe" },
      CONTEXT,
    );
    expect(first.matchedExisting).toBe(false);

    const again = await peopleService.addManual(
      { prospectId: PROSPECT_ID, fullName: "  ada   ROWE  ", roleTitle: "Founder" },
      CONTEXT,
    );

    expect(again.matchedExisting).toBe(true);
    expect(contacts()).toHaveLength(1);
    // The gap was filled on the existing record rather than a second row written.
    expect(again.person.roleTitle).toBe("Founder");
  });

  it("keeps two same-named people at two different companies as two records", async () => {
    await peopleService.addManual({ prospectId: PROSPECT_ID, fullName: "Ada Rowe" }, CONTEXT);

    const other = await peopleService.addManual(
      { prospectId: "prospect-2", fullName: "Ada Rowe" },
      CONTEXT,
    );

    expect(other.matchedExisting).toBe(false);
    expect(contacts()).toHaveLength(2);
  });

  it("fills only missing fields and never overwrites what a record already holds", async () => {
    await peopleService.addManual(
      { prospectId: PROSPECT_ID, fullName: "Ada Rowe", roleTitle: "Founder" },
      CONTEXT,
    );

    const { person, matchedExisting } = await peopleService.addManual(
      {
        prospectId: PROSPECT_ID,
        fullName: "Ada Rowe",
        roleTitle: "Marketing Assistant",
        email: "ada@northbeam.example",
        phone: "+1 615 555 0100",
      },
      CONTEXT,
    );

    expect(matchedExisting).toBe(true);
    expect(contacts()).toHaveLength(1);
    // The title the record already had stands; the missing email and phone land.
    expect(person.roleTitle).toBe("Founder");
    expect(person.email).toBe("ada@northbeam.example");
    expect(person.phone).toBe("+1 615 555 0100");
  });

  it("never downgrades a verified address when the same person is entered again", async () => {
    const { person } = await peopleService.addManual(
      { prospectId: PROSPECT_ID, fullName: "Ada Rowe", email: "ada@northbeam.example" },
      CONTEXT,
    );
    const confirmed = await peopleService.confirmEmail(person, CONTEXT);
    expect(confirmed.emailStatus).toBe("verified");

    const again = await peopleService.addManual(
      {
        prospectId: PROSPECT_ID,
        fullName: "Ada Rowe",
        email: "ada@northbeam.example",
        emailStatus: "found",
        roleTitle: "Founder",
      },
      CONTEXT,
    );

    expect(again.matchedExisting).toBe(true);
    expect(again.person.email).toBe("ada@northbeam.example");
    expect(again.person.emailStatus).toBe("verified");
    expect(again.person.confidence).toBe("human_confirmed");
  });

  it("returns the existing person unchanged when the entry brings nothing new", async () => {
    const first = await peopleService.addManual(
      {
        prospectId: PROSPECT_ID,
        fullName: "Ada Rowe",
        roleTitle: "Founder",
        email: "ada@northbeam.example",
      },
      CONTEXT,
    );

    const again = await peopleService.addManual(
      {
        prospectId: PROSPECT_ID,
        fullName: "Ada Rowe",
        roleTitle: "Founder",
        email: "ada@northbeam.example",
      },
      CONTEXT,
    );

    expect(again.matchedExisting).toBe(true);
    expect(contacts()).toHaveLength(1);
    expect(again.person.id).toBe(first.person.id);
    expect(again.person.roleTitle).toBe("Founder");
    expect(again.person.email).toBe("ada@northbeam.example");
    expect(again.person.emailStatus).toBe(first.person.emailStatus);
  });

  it("says out loud in the activity stream that the entry landed on an existing record", async () => {
    await peopleService.addManual({ prospectId: PROSPECT_ID, fullName: "Ada Rowe" }, CONTEXT);
    db.tables["activities"] = [];

    await peopleService.addManual(
      { prospectId: PROSPECT_ID, fullName: "Ada Rowe", roleTitle: "Founder" },
      CONTEXT,
    );

    const events = activities();
    expect(events).toHaveLength(1);
    expect(events[0]!["event_type"]).toBe("contact.updated");
    const payload = events[0]!["payload"] as Record<string, unknown>;
    expect(payload["matched_existing_record"]).toBe(true);
  });
});

describe("setRoute", () => {
  async function somebody() {
    const { person } = await peopleService.addManual(
      { prospectId: PROSPECT_ID, fullName: "Ada Rowe", roleTitle: "Founder" },
      CONTEXT,
    );
    return person;
  }

  it("stores an unconfirmed address as found, and the person stays unreachable", async () => {
    const person = await somebody();

    const updated = await peopleService.setRoute(
      person,
      { email: "  Ada@Northbeam.example  " },
      CONTEXT,
    );

    expect(updated.email).toBe("ada@northbeam.example");
    expect(updated.emailStatus).toBe("found");
    expect(isReachable(updated)).toBe(false);
  });

  it("treats a member's confirmation as verification and makes the person reachable", async () => {
    const person = await somebody();

    const updated = await peopleService.setRoute(
      person,
      { email: "ada@northbeam.example", emailConfirmed: true },
      CONTEXT,
    );

    expect(updated.emailStatus).toBe("verified");
    expect(updated.confidence).toBe("human_confirmed");
    expect(updated.emailCheckedBy).toBe("human");
    expect(isReachable(updated)).toBe(true);
  });

  it("keeps verified when the same verified address is re-saved without the checkbox", async () => {
    const person = await somebody();
    const verified = await peopleService.setRoute(
      person,
      { email: "ada@northbeam.example", emailConfirmed: true },
      CONTEXT,
    );
    expect(verified.emailStatus).toBe("verified");

    // Re-typing your own verified address without the checkbox is not new
    // doubt: the earlier confirmation stands.
    const again = await peopleService.setRoute(
      verified,
      { email: "  Ada@Northbeam.example  " },
      CONTEXT,
    );
    expect(again.emailStatus).toBe("verified");
    expect(isReachable(again)).toBe(true);
  });

  it("drops to found when a DIFFERENT address arrives without confirmation", async () => {
    const person = await somebody();
    const verified = await peopleService.setRoute(
      person,
      { email: "ada@northbeam.example", emailConfirmed: true },
      CONTEXT,
    );

    const changed = await peopleService.setRoute(verified, { email: "ada@other.example" }, CONTEXT);
    expect(changed.email).toBe("ada@other.example");
    expect(changed.emailStatus).toBe("found");
    expect(isReachable(changed)).toBe(false);
  });

  it("stores a confirmed LinkedIn profile as a legitimate manual route", async () => {
    const person = await somebody();

    const updated = await peopleService.setRoute(
      person,
      { linkedinUrl: "https://www.linkedin.com/in/ada-rowe/", linkedinConfirmed: true },
      CONTEXT,
    );

    expect(updated.linkedinUrl).toBe("https://www.linkedin.com/in/ada-rowe/");
    expect(updated.linkedinConfirmed).toBe(true);
    expect(updated.linkedinProvider).toBe("manual");
    expect(updated.linkedinConfidence).toBe("confirmed");
    expect(isReachable(updated)).toBe(true);
  });

  it("stores an unconfirmed LinkedIn link without turning it into a route", async () => {
    const person = await somebody();

    const updated = await peopleService.setRoute(
      person,
      { linkedinUrl: "https://www.linkedin.com/in/ada-rowe/" },
      CONTEXT,
    );

    expect(updated.linkedinUrl).toBe("https://www.linkedin.com/in/ada-rowe/");
    expect(updated.linkedinConfirmed).toBeFalsy();
    expect(isReachable(updated)).toBe(false);
  });

  it("refuses to save nothing", async () => {
    const person = await somebody();
    await expect(peopleService.setRoute(person, {}, CONTEXT)).rejects.toThrow(
      /email or a LinkedIn profile/i,
    );
  });

  it("refuses an address that is not an address", async () => {
    const person = await somebody();
    await expect(
      peopleService.setRoute(person, { email: "not-an-email" }, CONTEXT),
    ).rejects.toThrow(/does not look like an email/i);
  });

  it.each([
    "https://evil.com/linkedin.com/in/x",
    "https://notlinkedin.com/in/x",
    "https://my-linkedin.com/in/x",
    "ftp://linkedin.com/in/x",
  ])("refuses the LinkedIn lookalike %s", async (linkedinUrl) => {
    const person = await somebody();
    await expect(peopleService.setRoute(person, { linkedinUrl }, CONTEXT)).rejects.toThrow(
      /linkedin\.com/i,
    );
  });

  it("records who put the route on record in the activity stream", async () => {
    const person = await somebody();
    db.tables["activities"] = [];

    await peopleService.setRoute(
      person,
      {
        email: "ada@northbeam.example",
        linkedinUrl: "https://www.linkedin.com/in/ada-rowe/",
        linkedinConfirmed: true,
      },
      CONTEXT,
    );

    const events = activities();
    expect(events).toHaveLength(1);
    expect(events[0]!["event_type"]).toBe("contact.updated");
    const payload = events[0]!["payload"] as Record<string, unknown>;
    expect(payload["entered_by"]).toBe("human");
    expect(payload["email_confirmed"]).toBe(false);
    expect(payload["linkedin_confirmed"]).toBe(true);
    expect(String(events[0]!["summary"])).toMatch(/nobody has checked/i);
  });
});
