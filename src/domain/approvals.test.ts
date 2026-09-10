/**
 * The laws of Approvals, checked rather than assumed.
 *
 * These tests exist because the doctrine is only real if the code refuses to
 * break it: nothing reaches an executed state without a human, approval and
 * execution stay separate, the owning room's permission still applies, and the
 * same source state never becomes two decisions.
 */

import { describe, expect, it } from "vitest";

import {
  ALLOWED_APPROVAL_TRANSITIONS,
  BOARD_COLUMNS,
  approvalRefusal,
  approvalSourceKey,
  assertApprovalTransition,
  availableActions,
  canApprovalTransition,
  columnFor,
  inTab,
  isHumanAuthorised,
  matchesSearch,
  priorityRank,
  readyItemIds,
  sortApprovals,
  summariseBatch,
  tabCounts,
  tabFor,
  type ApprovalItem,
  type ApprovalRequest,
  type ApprovalStatus,
} from "./approvals";
import { registeredDownstreamTypes, downstreamAdapter } from "@/data/approvals/downstream";

const NOW = "2025-03-10T12:00:00.000Z";

function request(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: "apr_1",
    organizationId: "org-1",
    sourceApp: "comms",
    category: "communication",
    approvalType: "comms_draft",
    title: "Message to Ada Rowe",
    summary: "A first message after the intro call.",
    whyItNeedsYou: "Nothing goes out in your name unread.",
    status: "ready",
    urgency: "soon",
    impact: "medium",
    sourceEntity: { type: "comms_relationship", id: "rel-1", label: "Ada Rowe" },
    submittedBy: { type: "agent", id: "trust-tai", label: "Trust Tai" },
    sourceKey: "comms:comms_draft:comms_relationship:rel-1",
    requiredCapability: "comms.write",
    boundary: { willDo: ["Queue this message for sending"], willNotDo: ["Send anything unread"] },
    evidence: [],
    payload: {},
    revision: 1,
    createdAt: "2025-03-10T09:00:00.000Z",
    updatedAt: "2025-03-10T09:00:00.000Z",
    ...overrides,
  };
}

function item(overrides: Partial<ApprovalItem> = {}): ApprovalItem {
  return {
    id: "api_1",
    organizationId: "org-1",
    requestId: "apr_1",
    itemKey: "post-1",
    title: "A post",
    state: "ready",
    exceptionReasons: [],
    facts: {},
    position: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("the state machine", () => {
  it("never lets work reach an executed state without passing through approval", () => {
    const unauthorised: ApprovalStatus[] = [
      "needs_review",
      "needs_context",
      "ready",
      "revision_requested",
    ];
    for (const from of unauthorised) {
      expect(canApprovalTransition(from, "executed")).toBe(false);
      expect(canApprovalTransition(from, "queued")).toBe(false);
      expect(canApprovalTransition(from, "verified")).toBe(false);
    }
  });

  it("keeps approved, executed and verified as three distinct states", () => {
    expect(canApprovalTransition("approved", "verified")).toBe(false);
    expect(canApprovalTransition("approved", "executed")).toBe(true);
    expect(canApprovalTransition("executed", "verified")).toBe(true);
    expect(isHumanAuthorised("approved")).toBe(true);
    expect(isHumanAuthorised("ready")).toBe(false);
  });

  it("treats rejected and verified as final", () => {
    expect(ALLOWED_APPROVAL_TRANSITIONS.rejected).toHaveLength(0);
    expect(ALLOWED_APPROVAL_TRANSITIONS.verified).toHaveLength(0);
  });

  it("refuses an illegal move loudly and allows a no-op", () => {
    expect(() => assertApprovalTransition("ready", "executed")).toThrow(/cannot move/i);
    expect(() => assertApprovalTransition("ready", "ready")).not.toThrow();
    expect(() => assertApprovalTransition("ready", "approved")).not.toThrow();
  });

  it("puts every non-terminal state in exactly one board column", () => {
    const open: ApprovalStatus[] = [
      "needs_review",
      "needs_context",
      "ready",
      "revision_requested",
      "approved",
      "queued",
      "executed",
    ];
    for (const status of open) {
      const column = columnFor(status);
      expect(column).not.toBeNull();
      expect(BOARD_COLUMNS).toContain(column!);
    }
    expect(columnFor("rejected")).toBeNull();
    expect(columnFor("verified")).toBeNull();
  });
});

describe("authority", () => {
  const base = {
    active: true,
    requiredCapability: "comms.write" as const,
    requestOrganizationId: "org-1",
    organizationId: "org-1",
  };

  it("requires approval authority as well as the owning room's write permission", () => {
    const writerOnly = approvalRefusal({
      ...base,
      can: (permission) => permission === "comms.write",
    });
    expect(writerOnly).toMatch(/leadership act/i);

    const approverOnly = approvalRefusal({
      ...base,
      can: (permission) => permission === "conductor.approve",
    });
    expect(approverOnly).toMatch(/comms\.write/);

    const both = approvalRefusal({ ...base, can: () => true });
    expect(both).toBeNull();
  });

  it("fails closed on an inactive membership and across organizations", () => {
    expect(approvalRefusal({ ...base, active: false, can: () => true })).toMatch(/not active/i);
    expect(
      approvalRefusal({ ...base, requestOrganizationId: "org-2", can: () => true }),
    ).toMatch(/another organization/i);
  });
});

describe("available actions", () => {
  it("offers no decision once a request is closed", () => {
    const actions = availableActions({
      approvalType: "comms_draft",
      status: "rejected",
      batch: undefined,
    });
    expect(actions.some((action) => action.authorising && action.id !== "reject")).toBe(false);
  });

  it("refuses to offer approval while the request says it lacks context", () => {
    const actions = availableActions({
      approvalType: "scout_relationship",
      status: "needs_context",
      batch: undefined,
    });
    expect(actions.map((action) => action.id)).not.toContain("approve_and_queue");
    expect(actions.map((action) => action.id)).toContain("request_revision");
  });

  it("offers a batch only the partial approval, never a blanket one", () => {
    const actions = availableActions({
      approvalType: "blog_batch",
      status: "needs_review",
      batch: { total: 5, ready: 3, exceptions: 2, failed: 0, approved: 0, executed: 0 },
    });
    const ids = actions.map((action) => action.id);
    expect(ids).toContain("approve_ready");
    expect(ids).not.toContain("approve");
  });

  it("names the act in the language of the room it belongs to", () => {
    const comms = availableActions({ approvalType: "comms_draft", status: "ready" });
    expect(comms[0]!.label).toBe("Approve for sending");
    const delivery = availableActions({ approvalType: "delivery_change", status: "ready" });
    expect(delivery[0]!.label).toBe("Approve and hand over");
  });
});

describe("batching", () => {
  const items = [
    item({ id: "a", state: "ready" }),
    item({ id: "b", state: "ready" }),
    item({ id: "c", state: "exception", exceptionReasons: ["low_confidence"] }),
    item({ id: "d", state: "failed" }),
  ];

  it("summarises without losing the exceptions", () => {
    expect(summariseBatch(items)).toMatchObject({
      total: 4,
      ready: 2,
      exceptions: 1,
      failed: 1,
    });
  });

  it("never lets an exception ride along with a bulk approval", () => {
    expect(readyItemIds(items)).toEqual(["a", "b"]);
  });
});

describe("idempotency", () => {
  it("resolves the same source state to the same key", () => {
    const key = () =>
      approvalSourceKey({
        sourceApp: "scout",
        approvalType: "scout_relationship",
        sourceEntity: { type: "prospect", id: "p-1" },
      });
    expect(key()).toBe(key());
    expect(key()).toBe("scout:scout_relationship:prospect:p-1");
  });

  it("separates two different requests about the same entity", () => {
    const a = approvalSourceKey({
      sourceApp: "scout",
      approvalType: "scout_relationship",
      sourceEntity: { type: "prospect", id: "p-1" },
      aspect: "first_message",
    });
    const b = approvalSourceKey({
      sourceApp: "scout",
      approvalType: "scout_relationship",
      sourceEntity: { type: "prospect", id: "p-1" },
    });
    expect(a).not.toBe(b);
  });
});

describe("navigation", () => {
  it("routes each source app to the tab a person would look under", () => {
    expect(tabFor(request())).toBe("comms");
    expect(tabFor(request({ sourceApp: "scout", category: "qualification" }))).toBe("scout");
    expect(tabFor(request({ sourceApp: "content", category: "marketing" }))).toBe("marketing");
    expect(tabFor(request({ sourceApp: "studio", category: "creative" }))).toBe("marketing");
    expect(tabFor(request({ sourceApp: "projects", category: "delivery" }))).toBe("delivery");
    expect(tabFor(request({ sourceApp: "roadmap", category: "strategy" }))).toBe("roadmap");
  });

  it("counts only open work, so a decided item stops nagging", () => {
    const counts = tabCounts([
      request({ id: "1", status: "ready" }),
      request({ id: "2", status: "approved" }),
      request({ id: "3", status: "rejected" }),
    ]);
    expect(counts.all).toBe(1);
    expect(counts.comms).toBe(1);
  });

  it("matches search across the person and company behind the request", () => {
    const row = request({ payload: { personName: "Ada Rowe", companyName: "Northbeam" } });
    expect(matchesSearch(row, "northbeam")).toBe(true);
    expect(matchesSearch(row, "ada")).toBe(true);
    expect(matchesSearch(row, "")).toBe(true);
    expect(matchesSearch(row, "unrelated")).toBe(false);
  });

  it("keeps everything visible under the all view", () => {
    expect(inTab(request({ sourceApp: "projects", category: "delivery" }), "all")).toBe(true);
  });
});

describe("prioritisation", () => {
  it("puts an urgent, high impact, long-waiting decision first", () => {
    const pressing = request({
      id: "pressing",
      urgency: "now",
      impact: "high",
      createdAt: "2025-03-05T09:00:00.000Z",
    });
    const idle = request({ id: "idle", urgency: "whenever", impact: "low" });
    expect(priorityRank(pressing, NOW)).toBeGreaterThan(priorityRank(idle, NOW));
    expect(sortApprovals([idle, pressing], "priority", NOW)[0]!.id).toBe("pressing");
  });

  it("ranks a request that lacks context below one that is ready", () => {
    const ready = request({ id: "ready", status: "ready" });
    const thin = request({ id: "thin", status: "needs_context" });
    expect(priorityRank(ready, NOW)).toBeGreaterThan(priorityRank(thin, NOW));
  });

  it("orders by time when asked to, without reranking", () => {
    const older = request({ id: "older", createdAt: "2025-03-01T09:00:00.000Z" });
    const newer = request({ id: "newer", createdAt: "2025-03-09T09:00:00.000Z" });
    expect(sortApprovals([older, newer], "newest", NOW)[0]!.id).toBe("newer");
    expect(sortApprovals([older, newer], "oldest", NOW)[0]!.id).toBe("older");
  });
});

describe("the way home", () => {
  it("gives every approval type a downstream path and never claims execution", () => {
    for (const type of registeredDownstreamTypes()) {
      const adapter = downstreamAdapter(type);
      const result = adapter.handover(request({ approvalType: type }), NOW);
      expect(adapter.describe(request({ approvalType: type }))).toBeTruthy();
      expect(result.state).toBe("queued");
      expect(adapter.nextStatus).not.toBe("verified");
    }
  });
});
