import { describe, expect, it } from "vitest";

import {
  resolveAppAccess,
  roleDefaultAccess,
  visibleApps,
  normalizeAccessLevel,
} from "./app-access";

const base = { membershipActive: true, organizationEnabled: true };

describe("app access", () => {
  it("fails closed for an unknown app", () => {
    const decision = resolveAppAccess("nonexistent", { ...base, role: "owner" });
    expect(decision.visible).toBe(false);
    expect(decision.level).toBe("hidden");
  });

  it("fails closed for an unknown role", () => {
    const decision = resolveAppAccess("conductor", { ...base, role: "wizard" });
    // unknown role normalises to `member`, which cannot approve in Conductor
    expect(decision.canManage).toBe(false);
  });

  it("fails closed when the membership is inactive", () => {
    expect(resolveAppAccess("scout", { ...base, membershipActive: false, role: "owner" }).visible).toBe(
      false,
    );
  });

  it("fails closed when the organization has the app switched off", () => {
    const decision = resolveAppAccess("scout", {
      ...base,
      organizationEnabled: false,
      role: "owner",
    });
    expect(decision.visible).toBe(false);
    expect(decision.because).toMatch(/switched off/i);
  });

  it("honours a hidden override even for an owner", () => {
    expect(
      resolveAppAccess("scout", { ...base, role: "owner", override: "hidden" }).visible,
    ).toBe(false);
  });

  it("never widens beyond the role ceiling", () => {
    const decision = resolveAppAccess("scout", { ...base, role: "viewer", override: "manage" });
    expect(decision.level).toBe("view");
    expect(decision.canWork).toBe(false);
  });

  it("gives role templates sensible defaults", () => {
    expect(roleDefaultAccess("owner", "scout")).toBe("manage");
    expect(roleDefaultAccess("team_member", "scout")).toBe("work");
    expect(roleDefaultAccess("viewer", "scout")).toBe("view");
    expect(roleDefaultAccess("viewer", "ops")).toBe("hidden");
  });

  it("normalises unknown levels to hidden", () => {
    expect(normalizeAccessLevel("superuser")).toBe("hidden");
    expect(normalizeAccessLevel("Work")).toBe("work");
  });

  it("lists only the rooms a person may see", () => {
    const apps = visibleApps({
      role: "team_member",
      membershipActive: true,
      organization: { enabled: { conductor: false } },
      overrides: { scout: "hidden" },
    }).map((app) => app.appId);

    expect(apps).toContain("steward");
    expect(apps).toContain("projects");
    expect(apps).not.toContain("scout");
    expect(apps).not.toContain("conductor");
  });
});

/**
 * The commissioned scenario, as a contract: Sarah is invited as a team member
 * with Steward, Projects and Roadmap (view), while Scout and Conductor are
 * hidden. The shell must show exactly the three allowed rooms plus Home.
 */
describe("invited team member with a narrowed room set", () => {
  const overrides: Record<string, AppAccessLevel> = {
    steward: "work",
    projects: "work",
    roadmap: "view",
    scout: "hidden",
    conductor: "hidden",
  };

  const decisions = visibleApps({
    role: "team_member",
    membershipActive: true,
    organization: { enabled: {} },
    overrides,
  });
  const ids = decisions.map((decision) => decision.appId);

  it("hides every room set to hidden", () => {
    expect(ids).not.toContain("scout");
    expect(ids).not.toContain("conductor");
  });

  it("keeps the allowed rooms visible", () => {
    expect(ids).toContain("steward");
    expect(ids).toContain("projects");
    expect(ids).toContain("roadmap");
  });

  it("keeps roadmap read-only", () => {
    const roadmap = decisions.find((decision) => decision.appId === "roadmap");
    expect(roadmap?.canWork).toBe(false);
  });

  it("gives nothing at all once the membership is deactivated", () => {
    expect(
      visibleApps({
        role: "team_member",
        membershipActive: false,
        organization: { enabled: {} },
        overrides,
      }),
    ).toHaveLength(0);
  });
});
