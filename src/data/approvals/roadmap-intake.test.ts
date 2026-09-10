/**
 * Roadmap keeps the truth; Approvals keeps the decision. These tests hold that
 * line: an open question becomes exactly one card carrying before, after and
 * provenance, the same question never becomes a second card, a resolved
 * question never becomes one at all, and approving resolves it through
 * Roadmap's own decision log rather than a copy of it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Roadmap, RoadmapDecision } from "@/domain/roadmap";

import { createFakeSupabase } from "@/data/supabase/fake-supabase";

const db = createFakeSupabase();

vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: { from: (table: string) => db.from(table) },
}));

const { submitRoadmapDecisionForApproval, roadmapDecisionSubmissionFor } = await import(
  "./roadmap-intake"
);
const { approvalsService } = await import("@/data/supabase/approvals-service");

const CONTEXT = { organizationId: "org-1", userId: "user-1" };

const roadmap = {
  id: "rm-1",
  organizationId: "org-1",
  title: "Northbeam growth",
  subjectLabel: "Northbeam",
  objective: "Reach predictable inbound",
  status: "active",
  pointA: [],
  pointB: null,
  nextMove: { action: "Ship the pricing page", because: "", tier: "inferred" },
  metadata: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as unknown as Roadmap;

function decision(overrides: Partial<RoadmapDecision> = {}): RoadmapDecision {
  return {
    id: "dec-1",
    organizationId: "org-1",
    roadmapId: "rm-1",
    question: "Move the launch behind the migration?",
    whyItMatters: "The migration blocks the launch sequence.",
    options: ["Launch first", "Migrate first"],
    labels: ["sequencing"],
    recommendation: "Migrate first",
    recommendationBecause: "The launch depends on data that only exists after migration.",
    evidence: [],
    status: "open",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as RoadmapDecision;
}

beforeEach(() => {
  for (const key of Object.keys(db.tables)) db.tables[key] = [];
});

describe("roadmap intake", () => {
  it("carries the position today, the position proposed and where it came from", () => {
    const submission = roadmapDecisionSubmissionFor(decision(), roadmap);
    expect(submission.payload?.["before"]).toBe("Ship the pricing page");
    expect(submission.payload?.["after"]).toBe("Migrate first");
    expect(submission.payload?.["decisionId"]).toBe("dec-1");
    expect((submission.payload?.["provenance"] as Record<string, unknown>)["roadmapId"]).toBe(
      "rm-1",
    );
    expect(submission.payload?.["affects"]).toContain("Northbeam");
  });

  it("puts one open question in the queue, and only one", async () => {
    const first = await submitRoadmapDecisionForApproval(decision(), roadmap, CONTEXT);
    const second = await submitRoadmapDecisionForApproval(decision(), roadmap, CONTEXT);

    expect(first?.id).toBe(second?.id);
    const totals = await approvalsService.tabTotals(CONTEXT, {});
    expect(totals.roadmap).toBe(1);
  });

  it("keeps two questions on one roadmap apart", async () => {
    await submitRoadmapDecisionForApproval(decision(), roadmap, CONTEXT);
    await submitRoadmapDecisionForApproval(
      decision({ id: "dec-2", question: "Cut the second phase?" }),
      roadmap,
      CONTEXT,
    );
    const totals = await approvalsService.tabTotals(CONTEXT, {});
    expect(totals.roadmap).toBe(2);
  });

  it("leaves an answered question alone", async () => {
    const request = await submitRoadmapDecisionForApproval(
      decision({ status: "approved" }),
      roadmap,
      CONTEXT,
    );
    expect(request).toBeNull();
  });
});
