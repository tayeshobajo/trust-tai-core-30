/**
 * The queue has to stay honest and cheap at size.
 *
 * With hundreds of open decisions the board must still read only the cards on
 * screen, count from the whole filtered set rather than from those cards, and
 * answer a search without dragging the queue into the browser first.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { createFakeSupabase } from "@/data/supabase/fake-supabase";
import { BOARD_COLUMNS } from "@/domain/approvals";

const db = createFakeSupabase();

vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: { from: (table: string) => db.from(table) },
}));

const { approvalsService } = await import("@/data/supabase/approvals-service");

const CONTEXT = { organizationId: "org-1", userId: "user-1" };
const TOTAL = 520;

function seed() {
  const rows = [];
  for (let index = 0; index < TOTAL; index += 1) {
    const comms = index % 2 === 0;
    rows.push({
      id: `req-${index}`,
      organization_id: "org-1",
      source_app: comms ? "comms" : "scout",
      source_key: `key-${index}`,
      approval_type: comms ? "comms_draft" : "scout_relationship",
      category: comms ? "communication" : "qualification",
      status: index % 5 === 0 ? "needs_context" : "ready",
      urgency: "soon",
      title: comms ? `Follow up with person ${index}` : `Qualify company ${index}`,
      summary: "Prepared and waiting on a person.",
      why_it_needs_you: "It affects a real relationship.",
      boundary: { willDo: ["Records your decision."], willNotDo: [], reversible: true },
      source_entity: { kind: "relationship", id: `rel-${index}`, label: `Entity ${index}` },
      payload: {},
      evidence: [],
      revision: 1,
      created_at: new Date(Date.now() - index * 60_000).toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
  db.tables["approval_requests"] = rows;
  db.tables["approval_items"] = [];
}

beforeAll(seed);

describe("the queue at size", () => {
  it("reads only one bounded page per column", async () => {
    db.resetStats();
    const pages = await Promise.all(
      BOARD_COLUMNS.map((column) =>
        approvalsService.listPage(CONTEXT, { tab: "all", column, limit: 25 }),
      ),
    );

    for (const page of pages) expect(page.rows.length).toBeLessThanOrEqual(25);
    expect(pages.reduce((sum, page) => sum + page.rows.length, 0)).toBeLessThanOrEqual(100);
    /* Far short of the 520 rows behind the board. */
    expect(db.stats.rowsRead).toBeLessThan(200);
  });

  it("counts the whole filtered set, not the cards on screen", async () => {
    const ready = await approvalsService.listPage(CONTEXT, {
      tab: "all",
      column: "ready",
      limit: 25,
    });
    const readyTotal = TOTAL - Math.ceil(TOTAL / 5);

    expect(ready.rows).toHaveLength(25);
    expect(ready.total).toBe(readyTotal);
    expect(ready.hasMore).toBe(true);
  });

  it("keeps paging bounded and complete", async () => {
    const first = await approvalsService.listPage(CONTEXT, {
      tab: "all",
      column: "ready",
      limit: 50,
    });
    const second = await approvalsService.listPage(CONTEXT, {
      tab: "all",
      column: "ready",
      limit: 50,
      offset: 50,
    });

    expect(second.rows).toHaveLength(50);
    expect(second.offset).toBe(50);
    const ids = new Set([...first.rows, ...second.rows].map((row) => row.id));
    expect(ids.size).toBe(100);
  });

  it("splits the tabs by source without reading everything", async () => {
    const totals = await approvalsService.tabTotals(CONTEXT);
    expect(totals.comms).toBe(TOTAL / 2);
    expect(totals.scout).toBe(TOTAL / 2);
    expect(totals.all).toBe(TOTAL);
    expect(totals.marketing).toBe(0);
  });

  it("gives per-column totals for the tab on screen", async () => {
    const columns = await approvalsService.columnTotals(CONTEXT, { tab: "comms" });
    expect(columns.ready + columns.needs_context).toBe(TOTAL / 2);
    expect(columns.approved).toBe(0);
  });

  it("searches in the database and returns a bounded page", async () => {
    db.resetStats();
    const page = await approvalsService.listPage(CONTEXT, {
      tab: "all",
      column: "ready",
      search: "Qualify company 3",
      limit: 25,
    });

    expect(page.rows.length).toBeGreaterThan(0);
    expect(page.rows.every((row) => row.title.includes("Qualify company 3"))).toBe(true);
    expect(page.rows.length).toBeLessThanOrEqual(25);
    expect(db.stats.rowsRead).toBeLessThan(200);
  });

  it("refuses to be fooled by punctuation in a search term", async () => {
    const page = await approvalsService.listPage(CONTEXT, {
      tab: "all",
      search: "company),(status.eq.approved",
      limit: 10,
    });
    expect(page.total).toBe(0);
  });
});
