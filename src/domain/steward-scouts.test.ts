import { describe, expect, it } from "vitest";

import { buildScoutCards, filterScoutCards, pageOf } from "./steward-scouts";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

describe("Steward Scouts (D1–D2)", () => {
  const input = {
    prospects: [{ id: A, name: "Alpha", status: "qualified" }, { id: B, name: "Beta", status: "new" }],
    tasks: [
      { id: "t1", status: "complete", correlationId: `scout:prospect:${A}:first-message` },
      { id: "t2", status: "open", sourceApp: "scout", sourceEntityType: "prospect", sourceEntityId: A },
      { id: "t3", status: "needs_approval", sourceApp: "scout", sourceEntityType: "prospect", sourceEntityId: A },
      { id: "t4", status: "open", correlationId: "unrelated" },
    ],
    runs: [{ taskId: "t2", status: "completed", createdAt: "2026-09-02" }, { taskId: "t3", status: "needs_approval", createdAt: "2026-09-03" }],
    peopleCounts: new Map([[A, 3]]),
  };

  it("counts exact-linked tasks, people and latest run", () => {
    const [a, b] = buildScoutCards(input);
    expect(a).toMatchObject({ people: 3, open: 1, done: 1, needsApproval: 1, latestRun: { status: "needs_approval" } });
    expect(b).toMatchObject({ people: 0, open: 0, latestRun: null });
  });

  it("unknown sources stay unknown, never zero", () => {
    const [a] = buildScoutCards({ ...input, runs: null, peopleCounts: null });
    expect(a?.people).toBeNull();
    expect(a?.latestRun).toBe("unknown");
  });

  it("filters before pagination", () => {
    const cards = buildScoutCards(input);
    expect(filterScoutCards(cards, { stage: "all", openOnly: true, agent: "all" }).map((c) => c.name)).toEqual(["Alpha"]);
    expect(filterScoutCards(cards, { stage: "all", openOnly: false, agent: "no_run" }).map((c) => c.name)).toEqual(["Beta"]);
    const many = Array.from({ length: 25 }, (_, i) => i);
    expect(pageOf(many, 3)).toEqual({ items: [24], pages: 3 });
  });
});
