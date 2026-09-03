/**
 * Contract tests for the governed LinkedIn action domain model.
 *
 * These pin the law: the status machine, fail-closed switches, and default
 * caps. If any of these change, a human must have decided that.
 */

import { describe, expect, it } from "vitest";

import {
  canTransition,
  CAP_COUNTED_STATUSES,
  DEFAULT_LINKI_DAILY_CONN_CAP,
  DEFAULT_LINKI_DAILY_MSG_CAP,
  isLinkiActionStatus,
  isLinkiActionType,
  LINKI_ACTION_STATUSES,
  LINKI_ACTION_TRANSITIONS,
  linkiActionErrorStatus,
  linkiDailyCap,
  linkiExecutionEnabled,
  TERMINAL_LINKI_ACTION_STATUSES,
} from "./linki-actions";

describe("linki action types (P2 scope only)", () => {
  it("accepts only connection_request and message", () => {
    expect(isLinkiActionType("connection_request")).toBe(true);
    expect(isLinkiActionType("message")).toBe(true);
    expect(isLinkiActionType("inmail")).toBe(false);
    expect(isLinkiActionType("auto_follow_up")).toBe(false);
    expect(isLinkiActionType(null)).toBe(false);
  });
});

describe("linki action statuses", () => {
  it("is the exact six-state vocabulary", () => {
    expect([...LINKI_ACTION_STATUSES].sort()).toEqual(
      ["approved", "executed", "executing", "failed", "pending_tai_approval", "verified"].sort(),
    );
  });

  it("rejects unknown statuses", () => {
    expect(isLinkiActionStatus("sent")).toBe(false);
    expect(isLinkiActionStatus("cancelled")).toBe(false);
    expect(isLinkiActionStatus(undefined)).toBe(false);
  });
});

describe("status machine, the legal transitions", () => {
  it("pending_tai_approval can ONLY become approved (human boundary)", () => {
    expect(LINKI_ACTION_TRANSITIONS.pending_tai_approval).toEqual(["approved"]);
  });

  it("approved can only start executing", () => {
    expect(LINKI_ACTION_TRANSITIONS.approved).toEqual(["executing"]);
  });

  it("executing resolves to executed or failed", () => {
    expect(LINKI_ACTION_TRANSITIONS.executing).toEqual(["executed", "failed"]);
  });

  it("executed can only be verified", () => {
    expect(LINKI_ACTION_TRANSITIONS.executed).toEqual(["verified"]);
  });

  it("failed and verified are terminal, no transitions out", () => {
    expect(LINKI_ACTION_TRANSITIONS.failed).toEqual([]);
    expect(LINKI_ACTION_TRANSITIONS.verified).toEqual([]);
  });

  it("canTransition rejects every illegal move", () => {
    // The send cannot be reached without approval, ever.
    expect(canTransition("pending_tai_approval", "executing")).toBe(false);
    expect(canTransition("pending_tai_approval", "executed")).toBe(false);
    // No re-approval, no un-approval, no re-execute.
    expect(canTransition("approved", "approved")).toBe(false);
    expect(canTransition("approved", "pending_tai_approval")).toBe(false);
    expect(canTransition("approved", "executed")).toBe(false);
    expect(canTransition("executed", "executing")).toBe(false);
    expect(canTransition("executed", "failed")).toBe(false);
    expect(canTransition("failed", "executing")).toBe(false);
    expect(canTransition("failed", "executed")).toBe(false);
    expect(canTransition("verified", "executing")).toBe(false);
    expect(canTransition("verified", "failed")).toBe(false);
  });

  it("canTransition accepts every legal move", () => {
    expect(canTransition("pending_tai_approval", "approved")).toBe(true);
    expect(canTransition("approved", "executing")).toBe(true);
    expect(canTransition("executing", "executed")).toBe(true);
    expect(canTransition("executing", "failed")).toBe(true);
    expect(canTransition("executed", "verified")).toBe(true);
  });
});

describe("daily cap counting", () => {
  it("counts everything except failed", () => {
    expect(CAP_COUNTED_STATUSES).not.toContain("failed");
    expect(CAP_COUNTED_STATUSES).toContain("pending_tai_approval");
    expect(CAP_COUNTED_STATUSES).toContain("executed");
  });

  it("failed actions are terminal", () => {
    expect(TERMINAL_LINKI_ACTION_STATUSES).toEqual(["failed", "verified"]);
  });
});

describe("kill switch. LINKI_EXECUTION_ENABLED", () => {
  it("defaults OFF when unset", () => {
    expect(linkiExecutionEnabled({})).toBe(false);
  });

  it("stays OFF for truthy-but-not-true values", () => {
    expect(linkiExecutionEnabled({ LINKI_EXECUTION_ENABLED: "" })).toBe(false);
    expect(linkiExecutionEnabled({ LINKI_EXECUTION_ENABLED: "1" })).toBe(false);
    expect(linkiExecutionEnabled({ LINKI_EXECUTION_ENABLED: "yes" })).toBe(false);
    expect(linkiExecutionEnabled({ LINKI_EXECUTION_ENABLED: "TRUE" })).toBe(false);
  });

  it("is ON only for the exact string 'true'", () => {
    expect(linkiExecutionEnabled({ LINKI_EXECUTION_ENABLED: "true" })).toBe(true);
  });
});

describe("daily caps from env", () => {
  it("messages default to 10 and connections to 5", () => {
    expect(DEFAULT_LINKI_DAILY_MSG_CAP).toBe(10);
    expect(DEFAULT_LINKI_DAILY_CONN_CAP).toBe(5);
    expect(linkiDailyCap({}, "message")).toBe(10);
    expect(linkiDailyCap({}, "connection_request")).toBe(5);
  });

  it("honors explicit overrides", () => {
    expect(linkiDailyCap({ LINKI_DAILY_MSG_CAP: "3" }, "message")).toBe(3);
    expect(linkiDailyCap({ LINKI_DAILY_CONN_CAP: "1" }, "connection_request")).toBe(1);
  });

  it("falls back to defaults on garbage", () => {
    expect(linkiDailyCap({ LINKI_DAILY_MSG_CAP: "zero" }, "message")).toBe(10);
    expect(linkiDailyCap({ LINKI_DAILY_CONN_CAP: "-5" }, "connection_request")).toBe(5);
  });
});

describe("error → HTTP status mapping", () => {
  it("maps the kill switch to 503 and everything else sensibly", () => {
    expect(linkiActionErrorStatus("kill_switch")).toBe(503);
    expect(linkiActionErrorStatus("not_found")).toBe(404);
    expect(linkiActionErrorStatus("forbidden")).toBe(403);
    expect(linkiActionErrorStatus("cap_exceeded")).toBe(429);
    expect(linkiActionErrorStatus("illegal_transition")).toBe(409);
    expect(linkiActionErrorStatus("send_failed")).toBe(502);
    expect(linkiActionErrorStatus("validation")).toBe(400);
  });
});
