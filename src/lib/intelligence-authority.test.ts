/**
 * Authority around intelligence: who may see evidence, and who may change
 * what an agent is held to. Both have to fail closed.
 */

import { afterEach, describe, expect, it } from "vitest";

import { listDiff } from "@/domain/intelligence-audit";
import {
  assertRoomManage,
  canManageRoom,
  canWorkInRoom,
  clearRoomAuthority,
  setRoomAuthority,
} from "@/lib/room-authority";

function publish(level: "view" | "work" | "manage") {
  setRoomAuthority([
    {
      appId: "steward",
      level,
      visible: true,
      canWork: level !== "view",
      canManage: level === "manage",
      because: "test",
    },
  ]);
}

afterEach(() => clearRoomAuthority());

describe("steward authority", () => {
  it("keeps evidence away from a view-only member", () => {
    publish("view");
    expect(canWorkInRoom("steward")).toBe(false);
    expect(canManageRoom("steward")).toBe(false);
  });

  it("lets a working member see evidence but not change the definition", () => {
    publish("work");
    expect(canWorkInRoom("steward")).toBe(true);
    expect(canManageRoom("steward")).toBe(false);
    expect(() => assertRoomManage("steward", "Steward", "Changing required context")).toThrow(
      /Changing required context/,
    );
  });

  it("lets a manager change required context", () => {
    publish("manage");
    expect(() => assertRoomManage("steward", "Steward", "Changing required context")).not.toThrow();
  });

  it("refuses a room nobody published", () => {
    publish("manage");
    expect(canManageRoom("scout")).toBe(false);
  });
});

describe("audit diff", () => {
  it("names what was added and what was taken away", () => {
    expect(listDiff(["roadmap", "brand"], ["brand", "pricing"])).toEqual({
      added: ["pricing"],
      removed: ["roadmap"],
    });
  });
});
