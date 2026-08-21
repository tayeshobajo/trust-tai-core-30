/**
 * Server readable business state, and the one evaluator that reads it.
 *
 * These prove the honest parts: an unreadable room stays unknown, a cleared
 * shape reads as success, a persistent shape reads as failure only after the
 * defined window, and nothing is written on unknown.
 */

import { describe, expect, it } from "vitest";

import { loadReconciliationSnapshot } from "./reconciliation-state.server";
import {
  evaluateOpenCase,
  outcomeFromReconciliation,
} from "@/data/intelligence/canon/outcome-checks";
import type { IntelligenceCase } from "@/domain/intelligence-canon";

const NOW = new Date("2026-03-01T12:00:00.000Z");

function client(tables: Record<string, { rows?: Record<string, unknown>[]; error?: string }>) {
  return {
    from(table: string) {
      const entry = tables[table] ?? { rows: [] };
      const result = entry.error
        ? { data: null, error: { message: entry.error } }
        : { data: entry.rows ?? [], error: null };
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        limit: () => Promise.resolve(result),
      };
      return builder;
    },
  };
}

function openCase(patternId: string, decidedAt: string): IntelligenceCase {
  return {
    id: "case-1",
    organizationId: "org-1",
    patternId,
    patternVersion: 1,
    entities: [],
    evidenceRefs: [],
    hypothesis: "A reading was acted on.",
    humanDecision: "We acted on it.",
    decidedBy: "user-1",
    decidedAt,
    diagnosisVerdict: "unknown",
    createdAt: decidedAt,
  };
}

const EMPTY = {
  projects: { rows: [] },
  comms_relationships: { rows: [] },
  prospects: { rows: [] },
  roadmaps: { rows: [] },
  roadmap_decisions: { rows: [] },
  commitments: { rows: [] },
};

describe("loadReconciliationSnapshot", () => {
  it("reads every canonical room without a browser session", async () => {
    const snapshot = await loadReconciliationSnapshot(client(EMPTY), "org-1", NOW);
    expect(snapshot.organizationId).toBe("org-1");
    expect(snapshot.unreadable).toEqual([]);
    for (const kind of [
      "project_delayed",
      "project_blocked",
      "no_active_project",
      "reply_debt",
      "commitment_overdue",
      "open_decisions",
      "roadmap_direction_undecided",
      "pipeline_unrouted",
    ]) {
      expect(snapshot.readableKinds).toContain(kind);
    }
    expect(snapshot.conditions).toEqual([]);
  });

  it("keeps a room that cannot be read out of readable kinds", async () => {
    const snapshot = await loadReconciliationSnapshot(
      client({ ...EMPTY, commitments: { error: "permission denied" } }),
      "org-1",
      NOW,
    );
    expect(snapshot.readableKinds).not.toContain("commitment_overdue");
    expect(snapshot.unreadable).toContain("steward");
  });

  it("reports an overdue promise with its source reference", async () => {
    const snapshot = await loadReconciliationSnapshot(
      client({
        ...EMPTY,
        commitments: {
          rows: [
            {
              id: "c-1",
              organization_id: "org-1",
              status: "open",
              due_at: "2026-02-01T00:00:00.000Z",
            },
          ],
        },
      }),
      "org-1",
      NOW,
    );
    const condition = snapshot.conditions.find((row) => row.kind === "commitment_overdue");
    expect(condition?.sourceRefs).toEqual(["steward-commitment-c-1"]);
  });

  it("reads fit only from the evaluation Scout already recorded", async () => {
    const snapshot = await loadReconciliationSnapshot(
      client({
        ...EMPTY,
        prospects: {
          rows: [
            {
              id: "p-1",
              organization_id: "org-1",
              company_name: "Northwind",
              status: "discovered",
              metadata: { scout_fit: { score: 84, scoreable: true } },
            },
          ],
        },
      }),
      "org-1",
      NOW,
    );
    expect(snapshot.readableKinds).toContain("strong_fit_unreviewed");
    const condition = snapshot.conditions.find((row) => row.kind === "strong_fit_unreviewed");
    expect(condition?.sourceRefs).toEqual(["scout:fit:p-1"]);
  });

  it("never scores fit itself, so an unevaluated company stays unknown", async () => {
    const snapshot = await loadReconciliationSnapshot(
      client({
        ...EMPTY,
        prospects: {
          rows: [
            { id: "p-2", organization_id: "org-1", company_name: "Acme", status: "discovered" },
          ],
        },
      }),
      "org-1",
      NOW,
    );
    expect(snapshot.readableKinds).not.toContain("strong_fit_unreviewed");
    expect(snapshot.unreadable).toContain("scout:fit");
  });

  it("lets the owning room settle a case it has explicitly closed", () => {
    const entry = {
      ...openCase("delivery.project_stalling", "2026-02-25T00:00:00.000Z"),
      entities: [{ type: "project" as const, id: "pr-1" }],
    };
    const result = evaluateOpenCase({
      entry,
      snapshot: {
        organizationId: "org-1",
        now: NOW.toISOString(),
        readableKinds: [],
        conditions: [],
        terminal: [
          {
            entity: { type: "project", id: "pr-1" },
            kinds: ["project_delayed"],
            disposition: "resolved",
            statement: "Projects recorded Rebuild as delivered.",
            sourceRefs: ["projects:state:pr-1"],
            changedAt: "2026-02-27T00:00:00.000Z",
            observedAt: NOW.toISOString(),
          },
        ],
        unreadable: ["projects"],
      },
    });
    expect(result?.result).toBe("success");
    expect(result?.source).toBe("room_state");
  });

  it("treats an ambiguous room state as no answer at all", () => {
    const entry = {
      ...openCase("commitments.promises_slipping", "2026-01-01T00:00:00.000Z"),
      entities: [{ type: "relationship" as const, id: "rel-1" }],
    };
    const result = evaluateOpenCase({
      entry,
      snapshot: {
        organizationId: "org-1",
        now: NOW.toISOString(),
        readableKinds: ["commitment_overdue"],
        conditions: [
          {
            kind: "commitment_overdue",
            statement: "A promise is still overdue.",
            sourceRefs: ["steward-commitment-c-1"],
            observedAt: NOW.toISOString(),
          },
        ],
        terminal: [
          {
            entity: { type: "relationship", id: "rel-1" },
            kinds: ["commitment_overdue"],
            disposition: "ambiguous",
            statement: "It was moved to dormant, which does not say what happened.",
            sourceRefs: ["comms:relationship:rel-1"],
            observedAt: NOW.toISOString(),
          },
        ],
        unreadable: [],
      },
    });
    expect(result).toBeNull();
  });
});


describe("evaluateOpenCase", () => {
  const cleared = {
    organizationId: "org-1",
    now: NOW.toISOString(),
    readableKinds: ["commitment_overdue"],
    conditions: [],
    unreadable: [],
  };

  it("writes nothing when the condition kind was not readable", () => {
    const entry = openCase("commitments.promises_slipping", "2026-01-01T00:00:00.000Z");
    const result = evaluateOpenCase({
      entry,
      snapshot: { ...cleared, readableKinds: [], unreadable: ["steward"] },
    });
    expect(result).toBeNull();
  });

  it("reads a persistent condition as failure once the window has passed", () => {
    const entry = openCase("commitments.promises_slipping", "2026-01-01T00:00:00.000Z");
    const result = evaluateOpenCase({
      entry,
      snapshot: {
        ...cleared,
        conditions: [
          {
            kind: "commitment_overdue",
            statement: "2 promises have passed the date a person set.",
            sourceRefs: ["steward-commitment-c-1"],
            observedAt: NOW.toISOString(),
          },
        ],
      },
    });
    expect(result?.result).toBe("failure");
    expect(result?.evidenceRefs).toEqual(["steward-commitment-c-1"]);
  });

  it("stays unknown while the condition is still young", () => {
    const entry = openCase("commitments.promises_slipping", "2026-02-28T12:00:00.000Z");
    const result = evaluateOpenCase({
      entry,
      snapshot: {
        ...cleared,
        conditions: [
          {
            kind: "commitment_overdue",
            statement: "A promise is still overdue.",
            sourceRefs: ["steward-commitment-c-1"],
            observedAt: NOW.toISOString(),
          },
        ],
      },
    });
    expect(result).toBeNull();
  });

  it("carries provenance onto the outcome it becomes", () => {
    const entry = openCase("commitments.promises_slipping", "2026-02-01T00:00:00.000Z");
    const reconciliation = evaluateOpenCase({ entry, snapshot: cleared });
    if (!reconciliation) return;
    const outcome = outcomeFromReconciliation({
      entry,
      reconciliation,
      recordedBy: "user-1",
      now: NOW.toISOString(),
    });
    expect(outcome.resultSource).toBe("current_state");
    expect(outcome.observedAt).toBe(NOW.toISOString());
  });
});
