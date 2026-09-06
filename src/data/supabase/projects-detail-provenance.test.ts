/**
 * What the history says after a correction.
 *
 * A correction to what a person typed is not a change of next move, and the
 * activity trail has to say which one happened. These run the real service and
 * the real activity writer against an in-memory Supabase stand-in.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeSupabase } from "./fake-supabase";
import type { ExecutionProject } from "@/domain/projects";

const db = createFakeSupabase();

vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: { from: (table: string) => db.from(table) },
}));

const { projectsService } = await import("./projects-service");

const CONTEXT = { organizationId: "org-1", userId: "user-1", userLabel: "Tai" };

function project(overrides: Partial<ExecutionProject> = {}): ExecutionProject {
  return {
    id: "proj-1",
    organizationId: "org-1",
    name: "Mental Dental Academy",
    state: "in_flight",
    ownerLabel: "Tai",
    ownerUserId: "user-1",
    pointA: "Nothing recorded yet.",
    pointB: "The academy is live.",
    nextMove: "Draft the outline",
    deliveryItems: [
      { label: "Scope agreed", done: true },
      { label: "First build", done: false },
    ],
    evidence: [],
    dependencies: [],
    origin: { kind: "manual", subjectLabel: "Mental Dental" },
    lastMovedAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function seed(current: ExecutionProject) {
  db.tables["projects"] = [
    {
      id: current.id,
      organization_id: "org-1",
      name: current.name,
      status: current.state,
      point_a: current.pointA,
      point_b: current.pointB,
      client_id: current.clientId ?? null,
      due_date: current.dueDate ?? null,
      created_at: current.createdAt,
      updated_at: current.updatedAt,
      metadata: {
        origin: current.origin,
        next_move: current.nextMove ?? null,
        owner_label: current.ownerLabel ?? null,
        owner_user_id: current.ownerUserId ?? null,
        delivery_items: current.deliveryItems ?? [],
        evidence: [],
        dependencies: [],
      },
    },
  ];
  db.tables["activities"] = [];
}

/** Every activity name written during a call, oldest first. */
function activityNames(): string[] {
  return (db.tables["activities"] ?? []).map((row) =>
    String((row as Record<string, unknown>)["event_type"]),
  );
}

function lastActivity(): Record<string, unknown> {
  const rows = db.tables["activities"] ?? [];
  return (rows[rows.length - 1] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  for (const table of Object.keys(db.tables)) db.tables[table] = [];
  db.resetStats();
});

describe("projectsService.update provenance", () => {
  it("records a delivery-item correction as project.updated, never next_move_changed", async () => {
    const current = project();
    seed(current);

    await projectsService.update(
      current,
      {
        deliveryItems: [
          { label: "Scope agreed", done: true },
          { label: "Handed over", done: false },
        ],
      },
      CONTEXT,
    );

    expect(activityNames()).not.toContain("project.next_move_changed");
    const entry = lastActivity();
    expect(entry["event_type"]).toBe("project.updated");
    const payload = entry["payload"] as Record<string, unknown>;
    expect(payload["fields"]).toEqual(["deliveryItems"]);
    expect((payload["before"] as Record<string, unknown>)["deliveryItems"]).toEqual(
      current.deliveryItems,
    );
  });

  it("says nothing changed rather than inventing a correction when the items are identical", async () => {
    const current = project();
    seed(current);

    await projectsService.update(current, { deliveryItems: current.deliveryItems ?? [] }, CONTEXT);

    expect(activityNames()).toEqual(["project.next_move_changed"]);
  });

  it("keeps a real state transition ahead of the correction", async () => {
    const current = project();
    seed(current);

    await projectsService.update(
      current,
      { state: "in_review", deliveryItems: [{ label: "Scope agreed", done: true }] },
      CONTEXT,
    );

    expect(activityNames()).toEqual(["project.status_changed"]);
  });

  it("still records a typed correction, with what it used to say", async () => {
    const current = project();
    seed(current);

    await projectsService.update(current, { name: "Mental Dental Academy v2" }, CONTEXT);

    const payload = lastActivity()["payload"] as Record<string, unknown>;
    expect(lastActivity()["event_type"]).toBe("project.updated");
    expect(payload["fields"]).toEqual(["name"]);
    expect((payload["before"] as Record<string, unknown>)["name"]).toBe("Mental Dental Academy");
  });

  it("refuses to relabel the company on a project attached to a client", async () => {
    const current = project({ clientId: "client-1" });
    seed(current);

    await expect(
      projectsService.update(current, { subjectLabel: "Someone else" }, CONTEXT),
    ).rejects.toThrow(/Client record/);
    expect(activityNames()).toEqual([]);
  });
});
