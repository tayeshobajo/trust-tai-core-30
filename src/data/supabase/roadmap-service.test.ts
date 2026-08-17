/**
 * Integration tests for the live Roadmap persistence layer.
 *
 * The real service, the real row mappers, the real draft engine and the real
 * activity writer run against an in-memory Supabase stand-in. What is checked
 * is the behaviour the schema now supports: create, read, update, delete, the
 * tier discipline of what gets written, and the idempotency of the
 * Scout → Roadmap and Comms → Roadmap handoffs.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeSupabase } from "./fake-supabase";

const db = createFakeSupabase();

vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: {
    from: (table: string) => db.from(table),
  },
}));

const { roadmapService } = await import("./roadmap-service");

const CONTEXT = { organizationId: "org-1", userId: "user-1", userLabel: "Tai" };

function seedProspect(id = "prospect-1") {
  db.tables["prospects"] = [
    {
      id,
      organization_id: "org-1",
      company_name: "Northbeam Studio",
      website_url: "https://northbeam.example",
      status: "qualified",
      fit_score: 72,
      observed: [{ label: "Team", value: "Eleven people listed on the site." }],
      inferred: [],
      suggested: [],
    },
  ];
}

function seedRelationship(id = "relationship-1") {
  db.tables["comms_relationships"] = [
    {
      id,
      organization_id: "org-1",
      full_name: "Ada Rowe",
      company_name: "Northbeam Studio",
      stage: "warm",
      observed: [{ label: "Met", value: "Met at the Nashville founders dinner." }],
      inferred: [],
      decided: [],
    },
  ];
}

beforeEach(() => {
  for (const key of Object.keys(db.tables)) db.tables[key] = [];
});

describe("create", () => {
  it("drafts and persists a roadmap for a prospect", async () => {
    seedProspect();
    const detail = await roadmapService.create(
      { subject: { kind: "prospect", id: "prospect-1" }, objective: "Win the rebuild" },
      CONTEXT,
    );

    expect(detail.roadmap.subjectLabel).toBe("Northbeam Studio");
    expect(detail.roadmap.prospectId).toBe("prospect-1");
    expect(detail.roadmap.status).toBe("draft");
    expect(detail.stages.length).toBeGreaterThan(0);
    expect(db.tables["roadmaps"]).toHaveLength(1);
  });

  it("keeps a proposed destination inferred until a person approves it", async () => {
    seedProspect();
    const detail = await roadmapService.create(
      { subject: { kind: "prospect", id: "prospect-1" }, objective: "Win the rebuild" },
      CONTEXT,
    );
    expect(detail.roadmap.pointB?.tier).toBe("inferred");
  });

  it("writes only observed facts into Point A", async () => {
    seedProspect();
    const detail = await roadmapService.create(
      { subject: { kind: "prospect", id: "prospect-1" }, objective: "Win the rebuild" },
      CONTEXT,
    );
    expect(detail.roadmap.pointA.every((note) => note.tier === "observed")).toBe(true);
  });

  it("opens a decision so the destination gets confirmed by a person", async () => {
    seedProspect();
    const detail = await roadmapService.create(
      { subject: { kind: "prospect", id: "prospect-1" }, objective: "Win the rebuild" },
      CONTEXT,
    );
    expect(detail.decisions.some((decision) => decision.status === "open")).toBe(true);
  });

  it("records the draft in the shared activity stream", async () => {
    seedProspect();
    await roadmapService.create(
      { subject: { kind: "prospect", id: "prospect-1" }, objective: "Win the rebuild" },
      CONTEXT,
    );
    expect((db.tables["activities"] ?? []).length).toBe(1);
  });

  it("refuses a subject that is not in this organization", async () => {
    await expect(
      roadmapService.create(
        { subject: { kind: "prospect", id: "missing" }, objective: "Win the rebuild" },
        CONTEXT,
      ),
    ).rejects.toThrow(/not in this workspace/i);
  });
});

describe("handoff idempotency", () => {
  it("Scout → Roadmap returns the same roadmap on a second handoff", async () => {
    seedProspect();
    const first = await roadmapService.create(
      { subject: { kind: "prospect", id: "prospect-1" }, objective: "Win the rebuild" },
      CONTEXT,
    );
    const second = await roadmapService.create(
      { subject: { kind: "prospect", id: "prospect-1" }, objective: "Something else entirely" },
      CONTEXT,
    );
    expect(second.roadmap.id).toBe(first.roadmap.id);
    expect(db.tables["roadmaps"]).toHaveLength(1);
  });

  it("Comms → Roadmap returns the same roadmap on a second handoff", async () => {
    seedRelationship();
    const first = await roadmapService.create(
      { subject: { kind: "relationship", id: "relationship-1" }, objective: "Agree the path" },
      CONTEXT,
    );
    const second = await roadmapService.create(
      { subject: { kind: "relationship", id: "relationship-1" }, objective: "Agree the path" },
      CONTEXT,
    );
    expect(second.roadmap.id).toBe(first.roadmap.id);
    expect(db.tables["roadmaps"]).toHaveLength(1);
  });

  it("preserves the subject context carried across from Comms", async () => {
    seedRelationship();
    const detail = await roadmapService.create(
      { subject: { kind: "relationship", id: "relationship-1" }, objective: "Agree the path" },
      CONTEXT,
    );
    expect(detail.roadmap.relationshipId).toBe("relationship-1");
    expect(detail.roadmap.subjectLabel).toBe("Northbeam Studio");
    expect(detail.roadmap.pointA.some((note) => note.value.includes("founders dinner"))).toBe(true);
  });

  it("does not re-draft stages when a roadmap already exists", async () => {
    seedProspect();
    const first = await roadmapService.create(
      { subject: { kind: "prospect", id: "prospect-1" }, objective: "Win the rebuild" },
      CONTEXT,
    );
    await roadmapService.create(
      { subject: { kind: "prospect", id: "prospect-1" }, objective: "Win the rebuild" },
      CONTEXT,
    );
    expect(db.tables["roadmap_stages"]).toHaveLength(first.stages.length);
  });
});

describe("read", () => {
  it("lists roadmaps for the organization", async () => {
    seedProspect();
    await roadmapService.create(
      { subject: { kind: "prospect", id: "prospect-1" }, objective: "Win the rebuild" },
      CONTEXT,
    );
    const list = await roadmapService.list("org-1");
    expect(list).toHaveLength(1);
  });

  it("returns nothing for another organization", async () => {
    seedProspect();
    await roadmapService.create(
      { subject: { kind: "prospect", id: "prospect-1" }, objective: "Win the rebuild" },
      CONTEXT,
    );
    expect(await roadmapService.list("org-2")).toHaveLength(0);
  });

  it("surfaces open decisions across roadmaps", async () => {
    seedProspect();
    await roadmapService.create(
      { subject: { kind: "prospect", id: "prospect-1" }, objective: "Win the rebuild" },
      CONTEXT,
    );
    const open = await roadmapService.openDecisions("org-1");
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((decision) => decision.status === "open")).toBe(true);
  });
});

describe("update", () => {
  it("moves a roadmap to another status", async () => {
    seedProspect();
    const detail = await roadmapService.create(
      { subject: { kind: "prospect", id: "prospect-1" }, objective: "Win the rebuild" },
      CONTEXT,
    );
    const updated = await roadmapService.setStatus(
      detail.roadmap.id,
      "in_progress",
      detail.roadmap.subjectLabel,
      CONTEXT,
    );
    expect(updated.status).toBe("in_progress");
  });

  it("turns an approved destination into a decided one", async () => {
    seedProspect();
    const detail = await roadmapService.create(
      { subject: { kind: "prospect", id: "prospect-1" }, objective: "Win the rebuild" },
      CONTEXT,
    );
    const approved = await roadmapService.approveDestination(
      detail.roadmap.id,
      detail.roadmap.subjectLabel,
      detail.roadmap.pointB!,
      CONTEXT,
    );
    expect(approved.pointB?.tier).toBe("decided");
    expect(approved.pointB?.approvedBy).toBe("user-1");
    expect(approved.status).toBe("approved");
  });

  it("moves a stage through the lifecycle", async () => {
    seedProspect();
    const detail = await roadmapService.create(
      { subject: { kind: "prospect", id: "prospect-1" }, objective: "Win the rebuild" },
      CONTEXT,
    );
    const stage = await roadmapService.setStageState(
      detail.stages[0]!,
      "live",
      detail.roadmap.subjectLabel,
      CONTEXT,
    );
    expect(stage.state).toBe("live");
  });

  it("names who carries a stage", async () => {
    seedProspect();
    const detail = await roadmapService.create(
      { subject: { kind: "prospect", id: "prospect-1" }, objective: "Win the rebuild" },
      CONTEXT,
    );
    const stage = await roadmapService.setStageOwner(
      detail.stages[0]!,
      { userId: "user-1", label: "Tai" },
      detail.roadmap.subjectLabel,
      CONTEXT,
    );
    expect(stage.ownerLabel).toBe("Tai");
  });

  it("resolves a decision and stamps who resolved it", async () => {
    seedProspect();
    const detail = await roadmapService.create(
      { subject: { kind: "prospect", id: "prospect-1" }, objective: "Win the rebuild" },
      CONTEXT,
    );
    const resolved = await roadmapService.resolveDecision(
      detail.decisions[0]!,
      "approved",
      detail.roadmap.subjectLabel,
      CONTEXT,
      "Agreed on the call.",
    );
    expect(resolved.status).toBe("approved");
    expect(resolved.resolvedBy).toBe("user-1");
    expect(resolved.resolutionNote).toBe("Agreed on the call.");
  });
});

describe("delete", () => {
  it("removes the roadmap from the organization", async () => {
    seedProspect();
    const detail = await roadmapService.create(
      { subject: { kind: "prospect", id: "prospect-1" }, objective: "Win the rebuild" },
      CONTEXT,
    );
    await roadmapService.remove(detail.roadmap.id, detail.roadmap.subjectLabel, CONTEXT);
    expect(await roadmapService.list("org-1")).toHaveLength(0);
  });

  it("frees the subject so a later handoff drafts a fresh roadmap", async () => {
    seedProspect();
    const first = await roadmapService.create(
      { subject: { kind: "prospect", id: "prospect-1" }, objective: "Win the rebuild" },
      CONTEXT,
    );
    await roadmapService.remove(first.roadmap.id, first.roadmap.subjectLabel, CONTEXT);
    const second = await roadmapService.create(
      { subject: { kind: "prospect", id: "prospect-1" }, objective: "Win the rebuild" },
      CONTEXT,
    );
    expect(second.roadmap.id).not.toBe(first.roadmap.id);
  });
});
