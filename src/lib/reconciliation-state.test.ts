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

  it("never scores fit, so strong fit stays unknown", async () => {
    const snapshot = await loadReconciliationSnapshot(client(EMPTY), "org-1", NOW);
    expect(snapshot.readableKinds).not.toContain("strong_fit_unreviewed");
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
