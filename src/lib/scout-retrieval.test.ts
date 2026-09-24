/**
 * The Scout retrieval contract, pinned.
 *
 * Scout must reason through the shared Intelligence Runtime bundle, not an
 * isolated prompt. These tests hold the laws that make the wiring worth
 * having: corrections ahead of inference, canonical companies and people read
 * as known rather than re-inferred, derived context never promoted, and
 * unreadable sources staying unknown.
 */

import { describe, expect, it } from "vitest";

import type { IntelligenceCase } from "@/domain/intelligence-canon";

import { composeScoutRetrieval, scoutRetrievalPacket } from "./scout-retrieval";

const NOW = "2026-09-09T10:00:00.000Z";

function correction(): IntelligenceCase {
  return {
    id: "case-1",
    organizationId: "org-1",
    patternId: "wrong_domain",
    patternVersion: 1,
    entities: [],
    evidenceRefs: [],
    hypothesis: "Northfield Dental sits at northfield.com.",
    humanDecision: "It is northfielddental.com.",
    decidedBy: "user-1",
    decidedAt: NOW,
    correction: "Northfield Dental is northfielddental.com, not northfield.com.",
    lesson: "Confirm the domain from the source, never from the name.",
    diagnosisVerdict: "incorrect",
    createdAt: NOW,
  };
}

const base = {
  organizationId: "org-1",
  now: NOW,
  subject: "IT companies in Nashville",
};

describe("composeScoutRetrieval", () => {
  it("composes the shared bundle for the scout room", () => {
    const bundle = composeScoutRetrieval(base);
    expect(bundle.room).toBe("scout");
    expect(bundle.organizationId).toBe("org-1");
    expect(bundle.capabilities).toBeTruthy();
  });

  it("carries canonical companies and people as observed, not inference", () => {
    const bundle = composeScoutRetrieval({
      ...base,
      known: [{ name: "Northfield Dental", domain: "northfielddental.com", intent: "Referral" }],
      people: [{ name: "Tai", title: "Founder", company: "Trust Tai" }],
    });
    const company = bundle.evidence.find((entry) => entry.id === "scout:company:0");
    const person = bundle.evidence.find((entry) => entry.id === "scout:person:0");
    expect(company?.tier).toBe("observed");
    expect(company?.statement).toContain("northfielddental.com");
    expect(company?.statement).toContain("Referral");
    expect(person?.tier).toBe("observed");
    expect(person?.label).toMatch(/do not research again/i);
  });

  it("keeps Scout's own reading derived, and decided truth decided", () => {
    const bundle = composeScoutRetrieval({
      ...base,
      decided: ["Active ICP governs fit."],
      derived: ["They may be growing."],
    });
    const derived = bundle.evidence.find((entry) => entry.id === "scout:derived:0");
    expect(derived?.tier).toBe("derived");
    expect(bundle.decided).toEqual(["Active ICP governs fit."]);
    expect(bundle.decided).not.toContain("They may be growing.");
  });

  it("keeps unreadable sources withheld rather than empty", () => {
    const bundle = composeScoutRetrieval({
      ...base,
      withheld: [
        { appId: "intelligence_cases", reason: "not_connected" },
        { appId: "icp_profiles", reason: "no_data" },
      ],
    });
    expect(bundle.withheld.map((row) => row.appId)).toEqual(["intelligence_cases", "icp_profiles"]);
  });
});

describe("scoutRetrievalPacket", () => {
  it("reads human corrections first and orders evidence by provenance", () => {
    const packet = scoutRetrievalPacket(
      composeScoutRetrieval({
        ...base,
        decided: ["Active ICP governs fit."],
        known: [{ name: "Northfield Dental", domain: "northfielddental.com" }],
        derived: ["They may be growing."],
        cases: [correction()],
      }),
      base.subject,
    );
    expect(Object.keys(packet)[0]).toBe("humanCorrections");
    expect((packet["humanCorrections"] as { correction: string }[])[0]?.correction).toContain(
      "northfielddental.com",
    );
    expect(packet["subject"]).toBe("IT companies in Nashville");
    const tiers = (packet["evidence"] as { tier: string }[]).map((entry) => entry.tier);
    expect(tiers[0]).toBe("decided");
    expect(tiers[tiers.length - 1]).toBe("derived");
  });

  it("reports no corrections honestly rather than inventing them", () => {
    const packet = scoutRetrievalPacket(composeScoutRetrieval(base));
    expect(packet["humanCorrections"]).toEqual([]);
    expect(packet["room"]).toBe("scout");
  });
});

describe("edit-learning corrections in retrieval", () => {
  it("surfaces stored edit corrections in the corrections lane, ahead of inference", () => {
    const bundle = composeScoutRetrieval({
      ...base,
      editCorrections: [
        {
          id: "act-1",
          organizationId: "org-1",
          lesson:
            "A human edited a scout_intro, decide:begin_conversation draft before approving it. 1 sentence(s) added or rewritten.",
          capturedAt: NOW,
          capturedBy: "user-1",
        },
      ],
    });
    const lifted = bundle.corrections.find((entry) => entry.id === "act-1");
    expect(lifted).toBeTruthy();
    expect(lifted?.correction).toContain("edited a scout_intro");

    const packet = scoutRetrievalPacket(bundle);
    const corrections = packet["humanCorrections"] as { id: string; correction: string }[];
    expect(corrections.some((entry) => entry.id === "act-1")).toBe(true);
  });

  it("merges edit corrections with the case ledger instead of replacing it", () => {
    const bundle = composeScoutRetrieval({
      ...base,
      cases: [correction()],
      editCorrections: [
        {
          id: "act-2",
          organizationId: "org-1",
          lesson: "A scout_intro draft was discarded by a human after review.",
          capturedAt: NOW,
        },
      ],
    });
    const ids = bundle.corrections.map((entry) => entry.id);
    expect(ids).toContain("case-1");
    expect(ids).toContain("act-2");
  });
});

describe("learned principles at live call sites", () => {
  const row = (over: Record<string, unknown>) => ({
    id: "p-1",
    organization_id: "org-1",
    principle: "Stay with the moment; congratulate before pitching.",
    scope_domain: "relationship_nurture",
    scope_context_tags: ["milestone_event"],
    status: "active",
    source: "inferred",
    confidence: 0.8,
    supporting_evidence: [],
    contradicting_evidence: [],
    contexts_observed: [],
    relationships_observed: [],
    last_validated_at: NOW,
    superseded_by: null,
    transition_reason: null,
    ...over,
  });

  function fakeClient(rows: Record<string, unknown>[]) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: async () => ({ data: rows, error: null }),
          }),
        }),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  it("draft-intro claims milestone_event only when the World Card observed a change", async () => {
    const { draftIntroPrincipleScope } = await import("./scout-retrieval");
    expect(draftIntroPrincipleScope({ recentChanges: ["Opened a second studio"] })).toEqual({
      domain: "relationship_nurture",
      contextTags: ["milestone_event"],
    });
    expect(draftIntroPrincipleScope({ recentChanges: [] })).toEqual({
      domain: "relationship_nurture",
      contextTags: [],
    });
  });

  it("the call-site read passes only active/strengthened, in-scope principles", async () => {
    const { readRetrievalPrinciples } = await import("./organizational-principles.server");
    const { draftIntroPrincipleScope, composeScoutRetrieval: compose, scoutRetrievalPacket: packetOf } =
      await import("./scout-retrieval");
    const principles = await readRetrievalPrinciples(
      fakeClient([
        row({}),
        row({ id: "p-2", status: "provisional" }),
        row({ id: "p-3", status: "challenged" }),
        row({ id: "p-4", status: "retired" }),
        row({ id: "p-5", status: "strengthened" }),
        row({ id: "p-6", scope_domain: "sales" }),
      ]),
      "org-1",
      draftIntroPrincipleScope({ recentChanges: ["announced expansion"] }),
    );
    expect(principles.map((p) => p.id).sort()).toEqual(["p-1", "p-5"]);

    /* And the packet the DECIDE/draft read consumes carries exactly those. */
    const packet = packetOf(compose({ ...base, principles }));
    const corrections = packet["humanCorrections"] as { id: string }[];
    expect(corrections.map((c) => c.id).sort()).toEqual(["p-1", "p-5"]);
  });

  it("a tag-scoped principle never leaks into the sourcing scope", async () => {
    const { readRetrievalPrinciples } = await import("./organizational-principles.server");
    const { SOURCING_PRINCIPLE_SCOPE } = await import("./scout-retrieval");
    const principles = await readRetrievalPrinciples(
      fakeClient([
        row({}), // relationship_nurture, tag-scoped: out of domain
        row({ id: "p-7", scope_domain: "sales", scope_context_tags: ["milestone_event"] }),
        row({ id: "p-8", scope_domain: "sales", scope_context_tags: [] }),
      ]),
      "org-1",
      SOURCING_PRINCIPLE_SCOPE,
    );
    expect(principles.map((p) => p.id)).toEqual(["p-8"]);
  });

  it("a failed principles read degrades to an empty list, never an error", async () => {
    const { readRetrievalPrinciples } = await import("./organizational-principles.server");
    const broken = {
      from: () => {
        throw new Error("store unreachable");
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    await expect(
      readRetrievalPrinciples(broken, "org-1", { domain: "sales", contextTags: [] }),
    ).resolves.toEqual([]);
  });
});
