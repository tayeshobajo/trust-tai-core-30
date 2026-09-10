/**
 * The board's two silent rules: a tab means the same thing in the database as
 * it does in memory, and dragging a card can never become a decision the card
 * itself would refuse.
 */

import { describe, expect, it } from "vitest";

import {
  BOARD_COLUMN_STATUSES,
  columnFor,
  dropOutcome,
  tabFilter,
  tabFor,
  type ApprovalCategory,
  type ApprovalSourceApp,
  type ApprovalStatus,
} from "@/domain/approvals";

const APPS: ApprovalSourceApp[] = [
  "scout",
  "comms",
  "roadmap",
  "website",
  "projects",
  "ops",
  "studio",
  "content",
];

const CATEGORIES: ApprovalCategory[] = [
  "marketing",
  "communication",
  "qualification",
  "strategy",
  "delivery",
  "creative",
  "operations",
];

describe("tab filter", () => {
  it("says the same thing to the database as tabFor says in memory", () => {
    for (const tab of ["marketing", "comms", "scout", "roadmap", "delivery"] as const) {
      const filter = tabFilter(tab);
      for (const sourceApp of APPS) {
        for (const category of CATEGORIES) {
          const matched =
            filter.sourceApps.includes(sourceApp) ||
            (filter.otherApps.includes(sourceApp) && filter.categories.includes(category));
          expect({ tab, sourceApp, category, matched }).toEqual({
            tab,
            sourceApp,
            category,
            matched: tabFor({ sourceApp, category }) === tab,
          });
        }
      }
    }
  });
});

describe("board columns", () => {
  it("places every status in exactly the column that claims it", () => {
    for (const [column, statuses] of Object.entries(BOARD_COLUMN_STATUSES)) {
      for (const status of statuses) {
        expect(columnFor(status as ApprovalStatus)).toBe(column);
      }
    }
  });
});

const base = {
  approvalType: "comms_draft" as const,
  status: "ready" as ApprovalStatus,
  boundary: { willDo: ["Marks the draft approved in Comms."], willNotDo: [] },
};

describe("drag to decide", () => {
  it("approves a ready card through its own authorising action", () => {
    const outcome = dropOutcome(base, "approved");
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.action.authorising).toBe(true);
      expect(outcome.confirm).toBe(false);
    }
  });

  it("refuses to move work backwards", () => {
    const outcome = dropOutcome(base, "needs_review");
    expect(outcome.ok).toBe(false);
  });

  it("refuses a card that is missing context", () => {
    const outcome = dropOutcome({ ...base, status: "needs_context" }, "approved");
    expect(outcome.ok).toBe(false);
  });

  it("refuses a card that is already decided", () => {
    const outcome = dropOutcome({ ...base, status: "approved" }, "approved");
    expect(outcome.ok).toBe(false);
  });

  it("asks first when approving could reach outside Trust Tai", () => {
    const outcome = dropOutcome(
      { ...base, boundary: { willDo: ["Publishes the post to trusttai.com."], willNotDo: [] } },
      "approved",
    );
    expect(outcome.ok && outcome.confirm).toBe(true);
  });
});
