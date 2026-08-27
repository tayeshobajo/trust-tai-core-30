/**
 * Integration tests for the People layer.
 *
 * These run the real service, the real contacts mapper, and the real activity
 * writer against an in-memory Supabase stand-in — so they check the behaviour
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
    const person = await peopleService.addManual(
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

    const person = await peopleService.addManual(
      { prospectId: PROSPECT_ID, fullName: "Ada Rowe", email: "ada@northbeam.example" },
      CONTEXT,
    );
    const checked = await peopleService.verifyEmail("test-source", person, CONTEXT);

    expect(checked.emailStatus).toBe("bounced");
    expect(checked.emailCheckedBy).toBe("Test source test-source");
    expect(checked.emailCheckedAt).toBeTruthy();
  });

  it("refuses to verify an address that does not exist", async () => {
    const person = await peopleService.addManual(
      { prospectId: PROSPECT_ID, fullName: "Ada Rowe" },
      CONTEXT,
    );
    await expect(peopleService.confirmEmail(person, CONTEXT)).rejects.toThrow(/no address/i);
  });
});

describe("linkedin route confirmation", () => {
  it("stamps the human-confirmed LinkedIn route with full provenance", async () => {
    const person = await peopleService.addManual(
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
    expect(confirmed.linkedinProvider).toBe("linki");
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
    const person = await peopleService.addManual(
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
    expect(storedMeta["linkedin_provider"]).toBe("linki");
  });
});

describe("manual entry", () => {
  it("marks a hand-entered person as human confirmed with a manual source", async () => {
    const person = await peopleService.addManual(
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
});
