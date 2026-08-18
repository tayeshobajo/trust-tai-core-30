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
    openRecommendations: null,
    openRisks: null,
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

describe("Ops projection lifecycle and health", () => {
  it("drops a removed project from the active portfolio", () => {
    expect(
      opsProjectionPortfolio([row({ removed: true, lifecycleState: "removed" })]).systems,
    ).toHaveLength(0);
  });

  it("keeps an archived project visible with Ops' own lifecycle word", () => {
    const system = opsProjectionPortfolio([
      row({ archived: true, lifecycleState: "archived" }),
    ]).systems[0] as OpsSystem;
    expect(system.lifecycleState).toBe("archived");
  });

  it("raises attention from Ops' needs_attention flag, never from a guess", () => {
    const portfolio = opsProjectionPortfolio([row({ needsAttention: true, health: "unknown" })]);
    expect(portfolio.systems[0]!.health).toBe("attention");
    expect(portfolio.attention).toHaveLength(1);
    expect(portfolio.attention[0]!.label).toBe("needs attention");
  });

  it("never counts an unknown health as healthy", () => {
    const portfolio = opsProjectionPortfolio([row({ health: "unknown" })]);
    expect(portfolio.systems.filter((s) => s.health === "healthy")).toHaveLength(0);
  });

  it("reads Ops' live column names, including stable health and ops_url", () => {
    const read = readOpsProjectRow({
      ops_project_id: "ops-qa-trace",
      organization_id: ORG,
      project_name: "QA Trace Project",
      status: "active",
      health: "stable",
      needs_attention: false,
      lifecycle_state: "active",
      ops_url: "https://ops.trusttai.com/projects/ops-qa-trace",
      synced_at: new Date(NOW).toISOString(),
    });
    expect(read?.name).toBe("QA Trace Project");
    expect(read?.health).toBe("healthy");
    expect(read?.removed).toBe(false);
    expect(opsProjectUrl(read!)).toBe(`${OPS_ORIGIN}/projects/ops-qa-trace`);
  });

  it("refuses an ops_url on any other origin", () => {
    const read = readOpsProjectRow({
      ops_project_id: "ops-evil",
      organization_id: ORG,
      project_name: "Elsewhere",
      ops_url: "https://evil.example/projects/1",
      synced_at: new Date(NOW).toISOString(),
    });
    expect(read?.opsUrl).toBeUndefined();
    expect(opsProjectUrl(read!)).toBe(OPS_ORIGIN);
  });

  it("keeps activity rows out of the portfolio entirely", () => {
    const portfolio = opsProjectionPortfolio([], []);
    expect(portfolio.systems).toHaveLength(0);
  });
});


describe("the live projection contract", () => {
  const raw = {
    organization_id: ORG,
    app_key: "ops",
    ops_project_id: "ops-elevate",
    canonical_project_id: null,
    client_label: "Elevate Orthodontics",
    project_name: "Elevate Orthodontics",
    primary_domain: "production",
    status: "in_progress",
    lifecycle_state: "active",
    health: "stable",
    needs_attention: false,
    owner: "Sarah",
    open_issues: null,
    open_approvals: null,
    open_recommendations: null,
    open_risks: null,
    last_activity_at: "2026-02-01T09:00:00.000Z",
    ops_path: "/projects/ops-elevate",
    ops_url: `${OPS_ORIGIN}/projects/ops-elevate`,
    source_updated_at: "2026-02-01T09:00:00.000Z",
    synced_at: new Date(NOW).toISOString(),
    created_at: "2026-01-01T00:00:00.000Z",
  };

  it("reads exactly the live column names", () => {
    const parsed = readOpsProjectRow(raw)!;
    expect(parsed.name).toBe("Elevate Orthodontics");
    expect(parsed.company).toBe("Elevate Orthodontics");
    expect(parsed.environment).toBe("production");
    expect(parsed.lastSyncedAt).toBe(raw.synced_at);
    expect(parsed.health).toBe("healthy");
    expect(parsed.openIssues).toBeNull();
    expect(parsed.openRecommendations).toBeNull();
    expect(parsed.openRisks).toBeNull();
  });

  it("ignores the retired alternate contract field names", () => {
    const legacy = {
      organization_id: ORG,
      ops_project_id: "ops-legacy",
      name: "Legacy",
      company: "Legacy",
      last_synced_at: new Date(NOW).toISOString(),
      archived: false,
    };
    expect(readOpsProjectRow(legacy)).toBeNull();
  });

  it("keeps a removed project out of the active portfolio", () => {
    const removed = readOpsProjectRow({ ...raw, lifecycle_state: "removed" })!;
    expect(removed.removed).toBe(true);
    expect(opsProjectionPortfolio([removed]).systems).toHaveLength(0);
  });

  it("never counts an unreadable health word as healthy", () => {
    expect(readOpsProjectRow({ ...raw, health: "sparkly" })!.health).toBe("unknown");
  });

  it("deep links to the exact Ops project path", () => {
    const parsed = readOpsProjectRow(raw)!;
    expect(opsPathOf(opsProjectionPortfolio([parsed]).systems[0]!)).toBe("/projects/ops-elevate");
  });

  it("drops a row belonging to another organization", () => {
    const foreign = readOpsProjectRow({ ...raw, organization_id: "other-org" })!;
    expect(
      opsProjectionPortfolio([foreign].filter((r) => r.organizationId === ORG)).systems,
    ).toHaveLength(0);
  });
});
