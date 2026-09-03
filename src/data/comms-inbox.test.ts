/**
 * The four operating views: Clients, Nurture, Needs you, All.
 *
 * One relationship ledger, four calm reads of the same derived state. These
 * tests prove nobody is duplicated, nobody vanishes, and attention crosses
 * segment lines without a second rules engine.
 */

import { describe, expect, it } from "vitest";

import type { Relationship } from "@/domain/comms";

import {
  inboxEntries,
  inboxPage,
  inboxView,
  needsYou,
  pageSelection,
  RELATIONSHIPS_PER_PAGE,
  segmentViewOf,
} from "./comms-inbox";

const NOW = new Date("2026-08-22T12:00:00.000Z");

function days(count: number): string {
  return new Date(NOW.getTime() - count * 86_400_000).toISOString();
}

function relationship(part: Partial<Relationship> = {}): Relationship {
  return {
    id: "r1",
    organizationId: "org",
    fullName: "Dana Rivers",
    stage: "in_conversation",
    source: "manual",
    observed: [],
    inferred: [],
    decided: [],
    metadata: {},
    lastTouchAt: days(3),
    createdAt: days(60),
    updatedAt: days(1),
    ...part,
  };
}

/** An established client, calm. */
const clientCalm = relationship({ id: "c1", fullName: "Amara Osei", stage: "client" });
/** An established relationship with a reply owed. */
const clientOwed = relationship({
  id: "c2",
  fullName: "Lorena Diaz",
  source: "in_person",
  responseDueAt: days(2),
});
/** A Scout handoff being developed, never touched yet. */
const nurtureNew = (() => {
  const entry = relationship({
    id: "n1",
    fullName: "John Schmidt",
    source: "scout_handoff",
    stage: "ready_to_reach",
    createdAt: days(5),
  });
  delete (entry as Partial<Relationship>).lastTouchAt;
  return entry;
})();
/** A nurture relationship whose reply is overdue. */
const nurtureOwed = relationship({
  id: "n2",
  fullName: "Priya Nair",
  source: "scout_handoff",
  stage: "reached_out",
  responseDueAt: days(1),
});
/** Archived stays in the ledger but crowds no working room. */
const archived = relationship({ id: "a1", fullName: "Old Contact", stage: "archived" });

const all = [clientCalm, clientOwed, nurtureNew, nurtureOwed, archived];
const entries = inboxEntries(all, {}, NOW);

function visibleIds(view: { priority: typeof entries; others: typeof entries }): string[] {
  return [...view.priority, ...view.others].map((entry) => entry.relationship.id);
}

describe("operating views", () => {
  it("Clients holds established relationships and excludes nurture-only ones", () => {
    const ids = visibleIds(inboxView(entries, { tab: "clients", now: NOW }));
    expect(ids).toEqual(expect.arrayContaining(["c1", "c2"]));
    expect(ids).not.toContain("n1");
    expect(ids).not.toContain("n2");
    expect(ids).not.toContain("a1");
  });

  it("Nurture holds deliberate Scout/outbound development, each person once", () => {
    const ids = visibleIds(inboxView(entries, { tab: "nurture", now: NOW }));
    expect(ids).toEqual(expect.arrayContaining(["n1", "n2"]));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("c1");
  });

  it("Needs you crosses Clients and Nurture on existing attention logic", () => {
    const ids = visibleIds(inboxView(entries, { tab: "needs_you", now: NOW }));
    expect(ids).toEqual(expect.arrayContaining(["c2", "n2"]));
    expect(ids).not.toContain("c1");
    expect(ids).not.toContain("n1");
    expect(ids).not.toContain("a1");
  });

  it("All is the complete ledger: everyone exactly once, archived included", () => {
    const ids = visibleIds(inboxView(entries, { tab: "all", now: NOW }));
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
  });

  it("counts each view from the same derived state", () => {
    const view = inboxView(entries, { tab: "all", now: NOW });
    expect(view.tabCounts).toEqual({ clients: 2, nurture: 2, needs_you: 2, all: 5 });
  });

  it("graduation changes the room, never the record", () => {
    const before = inboxEntries([nurtureNew], {}, NOW)[0]!;
    expect(segmentViewOf(before)).toBe("nurture");
    const graduated = { ...nurtureNew, stage: "client" as const };
    const after = inboxEntries([graduated], {}, NOW)[0]!;
    expect(after.relationship.id).toBe(before.relationship.id);
    expect(segmentViewOf(after)).toBe("clients");
    expect(
      visibleIds(inboxView(inboxEntries([graduated], {}, NOW), { tab: "clients", now: NOW })),
    ).toContain("n1");
  });

  it("a reply owed makes anyone needs-you, whatever room they live in", () => {
    expect(
      needsYou(
        entries.find((entry) => entry.relationship.id === "c2")!,
        NOW,
      ),
    ).toBe(true);
    expect(
      needsYou(
        entries.find((entry) => entry.relationship.id === "n2")!,
        NOW,
      ),
    ).toBe(true);
    expect(
      needsYou(
        entries.find((entry) => entry.relationship.id === "a1")!,
        NOW,
      ),
    ).toBe(false);
  });
});

describe("pagination", () => {
  /** Sixty calm client relationships, none needing attention. */
  const many = inboxEntries(
    Array.from({ length: 60 }, (_, index) =>
      relationship({
        id: `p${index + 1}`,
        fullName: `Person ${String(index + 1).padStart(2, "0")}`,
        stage: "client",
      }),
    ),
    {},
    NOW,
  );

  it("pages the view at a fixed 25 per page", () => {
    expect(RELATIONSHIPS_PER_PAGE).toBe(25);
    const view = inboxView(many, { tab: "all", now: NOW });
    const first = inboxPage(view, 1);
    expect(first.rows).toHaveLength(25);
    expect(first.from).toBe(1);
    expect(first.to).toBe(25);
    expect(first.pageCount).toBe(3);
    const last = inboxPage(view, 3);
    expect(last.rows).toHaveLength(10);
    expect(last.from).toBe(51);
    expect(last.to).toBe(60);
  });

  it("clamps an out-of-range page to the last available page", () => {
    const view = inboxView(many, { tab: "all", now: NOW });
    expect(inboxPage(view, 99).page).toBe(3);
    expect(inboxPage(view, 0).page).toBe(1);
  });

  it("keeps counts full-view while only the page is sliced", () => {
    const view = inboxView(many, { tab: "all", now: NOW });
    const page = inboxPage(view, 2);
    expect(page.rows).toHaveLength(25);
    expect(page.total).toBe(60);
    expect(view.tabCounts.all).toBe(60);
    expect(view.tabCounts.clients).toBe(60);
  });

  it("applies search before pagination, so results are never page-local", () => {
    const view = inboxView(many, { tab: "all", query: "Person 5", now: NOW });
    const page = inboxPage(view, 1);
    expect(page.total).toBe(10); // Person 50–59 contain "Person 5"
    expect(page.pageCount).toBe(1);
    expect(page.rows.every((entry) => entry.relationship.fullName.includes("Person 5"))).toBe(true);
  });

  it("keeps priority rows at the front of page one, not alphabet", () => {
    const owed = relationship({
      id: "zz-owed",
      fullName: "Zach Last",
      stage: "client",
      responseDueAt: days(6),
    });
    const view = inboxView(
      inboxEntries([...many.map((entry) => entry.relationship), owed], {}, NOW),
      {
        tab: "all",
        now: NOW,
      },
    );
    const first = inboxPage(view, 1);
    expect(first.rows[0]!.relationship.id).toBe("zz-owed");
  });

  it("selection falls back to the page's first row, or null when empty", () => {
    const view = inboxView(many, { tab: "all", now: NOW });
    const first = inboxPage(view, 1);
    const onPage = first.rows[3]!.relationship.id;
    expect(pageSelection(first.rows, onPage)).toBe(onPage);
    expect(pageSelection(first.rows, "not-here")).toBe(first.rows[0]!.relationship.id);
    expect(pageSelection([], "not-here")).toBeNull();
  });
});
