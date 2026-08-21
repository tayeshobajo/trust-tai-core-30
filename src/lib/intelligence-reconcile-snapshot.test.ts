/**
 * Scheduled reconciliation, event first then current state.
 *
 * Written against an in-memory stand in for the Core service role client, so
 * the ordering, the idempotency and the refusal to write on unknown are all
 * provable without touching a real organization.
 */

import { describe, expect, it } from "vitest";

import { reconcileOrganization } from "./intelligence-reconcile.server";

const NOW = new Date("2026-03-01T12:00:00.000Z");
const LONG_AGO = "2026-01-01T00:00:00.000Z";

interface Store {
  cases: Record<string, unknown>[];
  outcomes: Record<string, unknown>[];
  activities: Record<string, unknown>[];
  rooms: Record<string, Record<string, unknown>[]>;
}

function makeClient(store: Store) {
  const inserted: Record<string, Record<string, unknown>[]> = {};

  function rowsFor(table: string): Record<string, unknown>[] {
    if (table === "intelligence_cases") return store.cases;
    if (table === "pattern_outcomes") return store.outcomes;
    if (table === "activities") return store.activities;
    if (table === "intelligence_reconciliation_runs") return [];
    return store.rooms[table] ?? [];
  }

  return {
    inserted,
    from(table: string) {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        gte: () => builder,
        order: () => builder,
        limit: () => Promise.resolve({ data: rowsFor(table), error: null }),
        single: () => Promise.resolve({ data: { id: "run-1" }, error: null }),
        update: () => builder,
        insert: (body: Record<string, unknown>) => {
          inserted[table] = [...(inserted[table] ?? []), body];
          if (table === "pattern_outcomes") store.outcomes.push(body);
          const chain: any = {
            select: () => chain,
            single: () => Promise.resolve({ data: { id: "row-1", ...body }, error: null }),
            then: (resolve: (value: { error: null }) => unknown) => resolve({ error: null }),
          };
          return chain;
        },
      };
      /* A bare select with no order/limit still resolves. */
      builder.then = (resolve: (value: unknown) => unknown) =>
        resolve({ data: rowsFor(table), error: null });
      return builder;
    },
  };
}

function caseRow(id: string, patternId: string): Record<string, unknown> {
  return {
    id,
    organization_id: "org-1",
    pattern_id: patternId,
    pattern_version: 1,
    entities: [],
    evidence_refs: [],
    hypothesis: "A reading was acted on.",
    human_decision: "We acted on it.",
    decided_by: "user-1",
    decided_at: LONG_AGO,
    diagnosis_verdict: "unknown",
    created_at: LONG_AGO,
  };
}

const EMPTY_ROOMS = {
  projects: [],
  comms_relationships: [],
  prospects: [],
  roadmaps: [],
  roadmap_decisions: [],
  commitments: [],
};

describe("scheduled snapshot reconciliation", () => {
  it("settles an open case from current state and records provenance", async () => {
    const store: Store = {
      cases: [caseRow("case-1", "commitments.promises_slipping")],
      outcomes: [],
      activities: [],
      rooms: { ...EMPTY_ROOMS },
    };
    const client = makeClient(store);
    const report = await reconcileOrganization(client as never, "org-1", NOW);

    expect(report.outcomesWritten).toBe(1);
    expect(report.snapshotOutcomes).toBe(1);
    expect(report.eventOutcomes).toBe(0);
    const written = client.inserted["pattern_outcomes"]![0]!;
    expect(written["result"]).toBe("success");
    expect(written["result_source"]).toBe("current_state");
    expect(written["observed_at"]).toBe(NOW.toISOString());
  });

  it("writes nothing when the room cannot be read", async () => {
    const store: Store = {
      cases: [caseRow("case-1", "commitments.promises_slipping")],
      outcomes: [],
      activities: [],
      rooms: { ...EMPTY_ROOMS },
    };
    const client = makeClient(store);
    const original = client.from.bind(client);
    (client as { from: (table: string) => unknown }).from = (table: string) => {
      if (table !== "commitments") return original(table);
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        limit: () => Promise.resolve({ data: null, error: { message: "permission denied" } }),
      };
      return builder;
    };

    const report = await reconcileOrganization(client as never, "org-1", NOW);
    expect(report.outcomesWritten).toBe(0);
    expect(report.unknownLeftOpen).toBe(1);
    expect(client.inserted["pattern_outcomes"]).toBeUndefined();
  });

  it("does not duplicate an outcome on a retry", async () => {
    const store: Store = {
      cases: [caseRow("case-1", "commitments.promises_slipping")],
      outcomes: [],
      activities: [],
      rooms: { ...EMPTY_ROOMS },
    };
    const first = makeClient(store);
    await reconcileOrganization(first as never, "org-1", NOW);
    const second = makeClient(store);
    const report = await reconcileOrganization(second as never, "org-1", NOW);
    expect(report.outcomesWritten).toBe(0);
    expect(second.inserted["pattern_outcomes"]).toBeUndefined();
  });
});
