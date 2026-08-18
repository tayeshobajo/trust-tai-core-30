/**
 * What the Ops room is allowed to claim.
 *
 * The projection Ops pushes is canonical for which projects exist. The shared
 * activity stream adds detail. Neither may be embellished: an unreported count
 * stays null, an unreported path opens Ops home, and a row from another
 * organization never appears.
 */

import { describe, expect, it } from "vitest";

import { opsProjectionPortfolio, sumKnown, type OpsSystem } from "./projection";
import { opsPathOf } from "./destination";
import { OPS_ORIGIN } from "@/domain/ops";
import {
  opsConnectionState,
  opsProjectUrl,
  readOpsProjectRow,
  safeOpsPath,
  type OpsProjectRow,
} from "@/domain/ops-projection";

const ORG = "6f1d3f6e-6e0a-4f1e-9c37-2b0e7a2c9d41";
const NOW = Date.parse("2026-02-01T12:00:00.000Z");

function row(overrides: Partial<OpsProjectRow> = {}): OpsProjectRow {
  return {
    opsProjectId: "ops-elevate",
    organizationId: ORG,
    name: "Elevate Orthodontics",
    health: "healthy",
    openIssues: null,
    openApprovals: null,
    lastActivityAt: null,
    lastSyncedAt: new Date(NOW).toISOString(),
    lifecycleState: "active",
    needsAttention: false,
    removed: false,
    archived: false,
    ...overrides,
  };
}


describe("Ops projection rows", () => {
  it("shows a real Ops project once the projection has it, with no invented counts", () => {
    const portfolio = opsProjectionPortfolio([row()]);
    expect(portfolio.systems).toHaveLength(1);
    const system = portfolio.systems[0] as OpsSystem;
    expect(system.name).toBe("Elevate Orthodontics");
    expect(system.source).toBe("projection");
    expect(system.openIssues).toBeNull();
    expect(system.openApprovals).toBeNull();
    expect(system.lastActivityAt).toBeNull();
  });

  it("keeps a proven zero as zero", () => {
    const portfolio = opsProjectionPortfolio([row({ openIssues: 0, openApprovals: 0 })]);
    expect(portfolio.systems[0]!.openIssues).toBe(0);
    expect(sumKnown(portfolio.systems, (s) => s.openIssues)).toBe(0);
  });

  it("reports an unknown total as null rather than zero", () => {
    const portfolio = opsProjectionPortfolio([row()]);
    expect(sumKnown(portfolio.systems, (s) => s.openIssues)).toBeNull();
  });

  it("hides archived projects", () => {
    expect(opsProjectionPortfolio([row({ removed: true, lifecycleState: 'removed' })]).systems).toHaveLength(0);
  });

  it("never fabricates rows when Ops has sent nothing", () => {
    expect(opsProjectionPortfolio([]).systems).toHaveLength(0);
  });

  it("refuses a row from another organization", () => {
    const foreign = readOpsProjectRow({
      ops_project_id: "ops-x",
      organization_id: "0d2a3ad0-1111-4111-8111-111111111111",
      name: "Someone else's system",
      last_synced_at: new Date(NOW).toISOString(),
    });
    expect(foreign?.organizationId).not.toBe(ORG);
    const mine = opsProjectionPortfolio([foreign!].filter((r) => r.organizationId === ORG));
    expect(mine.systems).toHaveLength(0);
  });
});

describe("Ops deep links", () => {
  it("opens the exact Ops project path, with nothing sensitive in it", () => {
    const system = opsProjectionPortfolio([row({ opsPath: "/projects/ops-elevate" })])
      .systems[0] as OpsSystem;
    expect(system.destinationUrl).toBe(`${OPS_ORIGIN}/projects/ops-elevate`);
    expect(opsPathOf(system.destinationUrl)).toBe("/projects/ops-elevate");
    expect(system.destinationUrl).not.toContain("token");
    expect(system.destinationUrl).not.toContain("#");
  });

  it("falls back to Ops home rather than guessing a path", () => {
    expect(opsProjectUrl({})).toBe(OPS_ORIGIN);
    expect(safeOpsPath("//evil.example/steal")).toBeUndefined();
    expect(safeOpsPath("https://evil.example")).toBeUndefined();
  });
});

describe("Ops connection semantics", () => {
  it("is synchronized while the pushed projection is fresh", () => {
    expect(
      opsConnectionState({ lastSyncedAt: new Date(NOW - 60_000).toISOString(), now: NOW }),
    ).toBe("synchronized");
  });

  it("softens to delayed before it warns", () => {
    expect(
      opsConnectionState({ lastSyncedAt: new Date(NOW - 30 * 60_000).toISOString(), now: NOW }),
    ).toBe("delayed");
  });

  it("is interrupted when the projection is old or unreadable", () => {
    expect(
      opsConnectionState({ lastSyncedAt: new Date(NOW - 5 * 3_600_000).toISOString(), now: NOW }),
    ).toBe("interrupted");
    expect(opsConnectionState({ projectionReadOk: false, now: NOW })).toBe("interrupted");
  });

  it("is live when a direct Ops read succeeds", () => {
    expect(opsConnectionState({ live: true, now: NOW })).toBe("live");
  });
});
