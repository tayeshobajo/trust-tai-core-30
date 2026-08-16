import { describe, expect, it } from "vitest";
import { emptySnapshot } from "@/data/intelligence/derive";
import { answerQuestion } from "@/data/intelligence/conductor";

const NOW = "2026-03-01T09:00:00.000Z";
const ORG = "org-probe";
function rel(i: number) {
  return {
    id: `rel-${i}`, organizationId: ORG, fullName: `Person ${i}`, companyName: `Co ${i}`,
    stage: "conversation", source: "scout",
    lastTouchAt: "2026-01-01T09:00:00.000Z",
    responseDueAt: "2026-02-01T09:00:00.000Z",
    observed: [], inferred: [], decided: [], metadata: {},
    createdAt: "2026-01-01T09:00:00.000Z", updatedAt: "2026-01-01T09:00:00.000Z",
  } as any;
}
describe("probe", () => {
  it("shows actions", () => {
    const snap = { ...emptySnapshot(ORG, NOW), relationships: [rel(1), rel(2), rel(3)] };
    for (const q of ["what should I focus on today", "how can we win more business", "where are we leaking"]) {
      const a = answerQuestion({ snapshot: snap, question: q });
      console.log(q, "=>", a.proposedActions.map((x) => `${x.appId}:${x.operation}`));
    }
    expect(true).toBe(true);
  });
});
