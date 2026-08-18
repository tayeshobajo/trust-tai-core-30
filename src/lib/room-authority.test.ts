import { afterEach, describe, expect, it } from "vitest";

import { visibleApps } from "@/domain/app-access";
import {
  RoomAuthorityError,
  canWorkInRoom,
  clearRoomAuthority,
  guardRoomWrites,
  roomIsVisible,
  setRoomAuthority,
} from "./room-authority";

const service = {
  async detail() {
    return "read";
  },
  async setStatus() {
    return "written";
  },
};

const guarded = guardRoomWrites("roadmap", "Roadmap", service, ["detail"]);

/** The live shape from Settings: view on Roadmap, Scout hidden. */
function publishMemberAccess() {
  setRoomAuthority(
    visibleApps({
      role: "member",
      membershipActive: true,
      organization: { enabled: {} },
      overrides: { roadmap: "view", scout: "hidden", conductor: "hidden" },
    }),
  );
}

afterEach(() => clearRoomAuthority());

describe("room authority", () => {
  it("stays silent before the workspace boundary has resolved anything", async () => {
    expect(canWorkInRoom("roadmap")).toBe(true);
    await expect(guarded.setStatus()).resolves.toBe("written");
  });

  it("lets a view-only member read Roadmap", async () => {
    publishMemberAccess();
    expect(roomIsVisible("roadmap")).toBe(true);
    await expect(guarded.detail()).resolves.toBe("read");
  });

  it("refuses a Roadmap write from view-only access", async () => {
    publishMemberAccess();
    expect(canWorkInRoom("roadmap")).toBe(false);
    expect(() => guarded.setStatus()).toThrow(RoomAuthorityError);
  });

  it("closes a hidden room entirely", () => {
    publishMemberAccess();
    expect(roomIsVisible("scout")).toBe(false);
    expect(canWorkInRoom("scout")).toBe(false);
  });

  it("allows the write once access carries authority to work", async () => {
    setRoomAuthority(
      visibleApps({
        role: "member",
        membershipActive: true,
        organization: { enabled: {} },
        overrides: { roadmap: "work" },
      }),
    );
    await expect(guarded.setStatus()).resolves.toBe("written");
  });

  it("gives a deactivated membership no room at all", () => {
    setRoomAuthority(
      visibleApps({
        role: "admin",
        membershipActive: false,
        organization: { enabled: {} },
        overrides: {},
      }),
    );
    expect(roomIsVisible("roadmap")).toBe(false);
    expect(canWorkInRoom("roadmap")).toBe(false);
    expect(roomIsVisible("home")).toBe(false);
  });
});
