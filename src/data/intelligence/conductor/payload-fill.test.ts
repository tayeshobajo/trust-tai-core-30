import { describe, expect, it } from "vitest";

import type { ActionProposal } from "@/domain/intelligence-engine";
import { scoutDiscoveryAdapter } from "@/data/conductor/adapters-scout";
import {
  DISCOVERY_RUN_OPERATION,
  deriveDiscoveryBrief,
  fillProposalPayloads,
  type IcpContext,
} from "./payload-fill";

const icp: IcpContext = {
  profileId: "icp-1",
  version: 3,
  title: "Ideal Client Profile",
  contentMarkdown: "# Who we serve\n\n- UK **professional services** firms\n- 10-50 people\n",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

function discoveryProposal(): ActionProposal {
  return {
    id: "act:rec:hyp:thin_pipeline:scout.open_discovery",
    recommendationId: "rec:hyp:thin_pipeline",
    appId: "scout",
    operation: "scout.open_discovery",
    title: "Open a sourcing session against the current ICP",
    summary: "Opens Scout discovery.",
    willDo: ["Open Scout discovery"],
    willNotDo: ["Change the ICP"],
    payload: { theme: "growth" },
    reversible: true,
    route: "/modules/scout?view=discover",
    routeLabel: "Open Scout discovery",
    requiresApproval: true,
  };
}

describe("discovery payload auto-fill", () => {
  it("derives a brief from the saved ICP without inventing criteria", () => {
    const brief = deriveDiscoveryBrief(icp);
    expect(brief).toContain("UK professional services firms");
    expect(brief).toContain("10-50 people");
    expect(brief).not.toContain("#");
  });

  it("returns nothing when no ICP is saved", () => {
    expect(deriveDiscoveryBrief(null)).toBeNull();
    expect(deriveDiscoveryBrief({ ...icp, contentMarkdown: "## \n---\n" })).toBeNull();
  });

  it("upgrades the proposal to a routable run carrying ICP identifiers", () => {
    const [filled] = fillProposalPayloads([discoveryProposal()], icp);
    expect(filled!.operation).toBe(DISCOVERY_RUN_OPERATION);
    expect(filled!.payload["icpProfileId"]).toBe("icp-1");
    expect(filled!.payload["icpVersion"]).toBe(3);
    expect(filled!.payload["theme"]).toBe("growth");
    expect(filled!.requiresApproval).toBe(true);
  });

  it("leaves the proposal untouched with no ICP", () => {
    const [same] = fillProposalPayloads([discoveryProposal()], null);
    expect(same!.operation).toBe("scout.open_discovery");
    expect(same!.payload["brief"]).toBeUndefined();
  });

  it("satisfies Scout's adapter instead of failing missing_input", () => {
    const access = { can: (permission: string) => permission === "scout.write" };
    const base = {
      id: "action:1",
      organizationId: "org-1",
      owningApp: "scout",
      status: "approved" as const,
      requiredCapability: "scout.write",
      consequence: "internal_change" as const,
    };

    const empty = scoutDiscoveryAdapter.canRoute(
      { ...base, operation: DISCOVERY_RUN_OPERATION, payload: {} } as never,
      access as never,
    );
    expect(empty.routable).toBe(false);
    expect(empty.refusal).toBe("missing_input");

    const [filled] = fillProposalPayloads([discoveryProposal()], icp);
    const ok = scoutDiscoveryAdapter.canRoute(
      { ...base, operation: DISCOVERY_RUN_OPERATION, payload: filled!.payload } as never,
      access as never,
    );
    expect(ok.routable).toBe(true);
  });
});
