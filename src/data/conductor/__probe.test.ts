import { describe, expect, it } from "vitest";
import { emptySnapshot } from "@/data/intelligence/derive";
import { answerQuestion } from "@/data/intelligence/conductor";
import { buildControlledActions, routability } from "@/data/intelligence/conductor/control";
import { ROOM_ADAPTERS } from "./adapters";
import { accessContext, can, type Permission } from "@/domain/access";

const NOW = "2026-03-01T09:00:00.000Z";
const ORG = "org-probe";
const owner = accessContext({ userId: "u1", organizationId: ORG, role: "owner" });
const access = { can: (p: string) => can(owner, p as Permission) };
function rel(i: number) {
  return { id: `rel-${i}`, organizationId: ORG, fullName: `Person ${i}`, companyName: `Co ${i}`,
    stage: "conversation", source: "scout", lastTouchAt: "2026-01-01T09:00:00.000Z",
    responseDueAt: "2026-02-01T09:00:00.000Z", observed: [], inferred: [], decided: [], metadata: {},
    createdAt: "2026-01-01T09:00:00.000Z", updatedAt: "2026-01-01T09:00:00.000Z" } as any;
}
describe("probe", () => {
  it("shows graph steps", () => {
    const snap = { ...emptySnapshot(ORG, NOW), relationships: [rel(1), rel(2), rel(3)] };
    for (const q of ["what should I focus on today", "how can we win more business"]) {
      const a = answerQuestion({ snapshot: snap, question: q });
      console.log("Q:", q, "steps:", a.actionGraph?.steps.map((s) => `${s.owningApp}:${s.operation ?? s.id}`));
      if (!a.actionGraph) continue;
      const actions = buildControlledActions({ organizationId: ORG, graph: a.actionGraph, now: NOW });
      for (const act of actions) {
        const v = routability({ action: { ...act, status: "approved" } as any, actions, adapters: ROOM_ADAPTERS, access });
        console.log("  ", act.operation, act.consequence, "routable=", v.routable, v.because);
      }
    }
    expect(true).toBe(true);
  });
});
