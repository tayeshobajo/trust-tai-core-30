import { describe, expect, it } from "vitest";

import type { OpsEvent } from "@/domain/ops";

import {
  EMPTY_OPS_FILTERS,
  filterOpsSystems,
  opsFreshness,
  opsPortfolio,
  paginateOpsSystems,
  sortOpsSystems,
} from "./projection";

function event(partial: Partial<OpsEvent> & Pick<OpsEvent, "name" | "at">): OpsEvent {
  return {
    id: partial.id ?? `${partial.name}-${partial.at}`,
    organizationId: "org",
    summary: partial.summary ?? "something happened",
    idempotencyKey: partial.idempotencyKey ?? `${partial.name}-${partial.at}`,
    chainKey: partial.chainKey ?? "chain-a",
    destinationUrl: partial.destinationUrl ?? "https://ops.trusttai.com/projects/a",
    humanDecision: false,
    subjectLabel: partial.subjectLabel ?? "Northlight platform",
    ...partial,
  } as OpsEvent;
}

describe("opsPortfolio", () => {
  it("counts open issues and approvals, and clears resolved chains", () => {
    const portfolio = opsPortfolio([
      event({ name: "ops.issue_detected", at: "2026-08-01T10:00:00Z" }),
      event({ name: "ops.fix_applied", at: "2026-08-02T10:00:00Z" }),
      event({ name: "ops.approval_required", at: "2026-08-03T10:00:00Z" }),
    ]);
    expect(portfolio.systems).toHaveLength(1);
    const system = portfolio.systems[0]!;
    expect(system.openIssues).toBe(0);
    expect(system.openApprovals).toBe(1);
    expect(system.health).toBe("attention");
    expect(portfolio.attention.map((item) => item.kind)).toEqual(["ops.approval_required"]);
  });

  it("reports healthy when nothing is open, and never invents fields", () => {
    const portfolio = opsPortfolio([event({ name: "ops.qa_passed", at: "2026-08-04T10:00:00Z" })]);
    const system = portfolio.systems[0]!;
    expect(system.health).toBe("healthy");
    expect(system.company).toBeUndefined();
    expect(system.environment).toBeUndefined();
    expect(system.latestRun).toEqual({ label: "qa passed", at: "2026-08-04T10:00:00Z", passed: true });
  });

  it("filters by search and health", () => {
    const portfolio = opsPortfolio([
      event({ name: "ops.blocked", at: "2026-08-05T10:00:00Z", chainKey: "a", subjectLabel: "Alpha" }),
      event({ name: "ops.completed", at: "2026-08-05T11:00:00Z", chainKey: "b", subjectLabel: "Beta" }),
    ]);
    expect(filterOpsSystems(portfolio.systems, { ...EMPTY_OPS_FILTERS, query: "beta" })).toHaveLength(1);
    expect(
      filterOpsSystems(portfolio.systems, { ...EMPTY_OPS_FILTERS, health: "incident" })[0]!.name,
    ).toBe("Alpha");
  });
});

describe("opsFreshness", () => {
  it("is truthful when nothing has arrived", () => {
    expect(opsFreshness(undefined, Date.now())).toContain("No Ops activity");
  });

  it("reads in seconds then minutes", () => {
    const now = Date.parse("2026-08-05T12:00:00Z");
    expect(opsFreshness("2026-08-05T11:59:18Z", now)).toBe("Ops synced 42 sec ago");
    expect(opsFreshness("2026-08-05T11:48:00Z", now)).toBe("Ops synced 12 min ago");
  });
});

describe("sorting and pagination", () => {
  const many = (count: number) =>
    opsPortfolio(
      Array.from({ length: count }, (_, index) =>
        event({
          name: index % 2 === 0 ? "ops.issue_detected" : "ops.completed",
          at: `2026-08-${String((index % 27) + 1).padStart(2, "0")}T10:00:00Z`,
          chainKey: `chain-${index}`,
          subjectLabel: `System ${String(index).padStart(2, "0")}`,
        }),
      ),
    ).systems;

  it("orders by name, by open incidents, and keeps attention first by default", () => {
    const systems = many(6);
    expect(sortOpsSystems(systems, "name")[0]!.name).toBe("System 00");
    expect(sortOpsSystems(systems, "open_issues")[0]!.openIssues).toBe(1);
    expect(sortOpsSystems(systems, "attention")[0]!.health).toBe("incident");
  });

  it("pages a large portfolio and clamps out-of-range pages", () => {
    const systems = sortOpsSystems(many(42), "name");
    const first = paginateOpsSystems(systems, 1, 10);
    expect(first.items).toHaveLength(10);
    expect(first.pageCount).toBe(5);
    expect([first.from, first.to]).toEqual([1, 10]);

    const last = paginateOpsSystems(systems, 99, 10);
    expect(last.page).toBe(5);
    expect(last.items).toHaveLength(2);
    expect([last.from, last.to]).toEqual([41, 42]);

    const empty = paginateOpsSystems([], 3, 25);
    expect(empty).toMatchObject({ page: 1, pageCount: 1, total: 0, from: 0, to: 0 });
  });
});
