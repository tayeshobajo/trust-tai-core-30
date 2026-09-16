import { describe, expect, it } from "vitest";

import {
  buildOutreachHandoff,
  canPrepareOutreach,
  dedupePeople,
  forDisplay,
  inferBuyingRole,
  isEnrichmentConnected,
  nextAction,
  planBulkEnrichment,
  providerOrder,
  recommendPeople,
  workEmailState,
  NOT_CONNECTED_MESSAGE,
  type ScoutPerson,
} from "./scout-people";

const NOW = "2026-09-16T12:00:00.000Z";

function person(overrides: Partial<ScoutPerson> = {}): ScoutPerson {
  return {
    key: overrides.key ?? "p1",
    fullName: "Dana Reid",
    companyName: "Northwind Services",
    companyDomain: "northwind.com",
    buyingRole: "unknown",
    whyThisPerson: "Named on the operations page of the company site.",
    emailStatus: "not_checked",
    provider: "apollo",
    discoveredAt: NOW,
    support: 10,
    ...overrides,
  };
}

describe("email state and the next action", () => {
  it("is not checked when nothing has been looked up", () => {
    expect(workEmailState(person(), NOW)).toBe("not_checked");
    expect(nextAction("not_checked")).toBe("find_email");
  });

  it("is verified when the provider verified it recently", () => {
    const state = workEmailState(
      person({
        workEmail: "dana@northwind.com",
        emailStatus: "verified",
        emailVerifiedAt: "2026-09-01T00:00:00.000Z",
      }),
      NOW,
    );
    expect(state).toBe("verified");
    expect(nextAction(state)).toBe("prepare_outreach");
  });

  it("is found, not verified when the provider gave no verification evidence", () => {
    expect(
      workEmailState(
        person({
          workEmail: "dana@northwind.com",
          emailStatus: "found_unverified",
          emailFetchedAt: "2026-09-10T00:00:00.000Z",
        }),
        NOW,
      ),
    ).toBe("found_unverified");
  });

  it("is stale past the policy age and keeps the address", () => {
    const row = person({
      workEmail: "dana@northwind.com",
      emailStatus: "verified",
      emailVerifiedAt: "2026-05-01T00:00:00.000Z",
    });
    expect(workEmailState(row, NOW)).toBe("stale");
    expect(row.workEmail).toBe("dana@northwind.com");
    expect(nextAction("stale")).toBe("refresh");
  });
});

describe("buying role", () => {
  it("is owner when a senior title leads the function the work sits in", () => {
    const read = inferBuyingRole({
      title: "Chief Operating Officer",
      opportunity: { functionalOwners: ["operations"] },
    });
    expect(read.role).toBe("owner");
    expect(read.evidence).toContain("Chief Operating Officer");
  });

  it("is unknown when the evidence cannot carry a conclusion", () => {
    expect(inferBuyingRole({ title: "", opportunity: { functionalOwners: ["operations"] } }).role).toBe(
      "unknown",
    );
    expect(
      inferBuyingRole({ title: "Warehouse Assistant", opportunity: { functionalOwners: ["digital"] } })
        .role,
    ).toBe("unknown");
  });

  it("is champion when somebody in the area publishes on it", () => {
    const read = inferBuyingRole({
      title: "Operations Manager",
      opportunity: { functionalOwners: ["operations"] },
      thoughtLeadership: {
        summary: "Writes a monthly column on service operations.",
        provider: "clay",
        observedAt: NOW,
      },
    });
    expect(read.role).toBe("champion");
  });
});

describe("recommendation", () => {
  it("shows at most four of twelve people", () => {
    const twelve = Array.from({ length: 12 }, (_, index) =>
      person({
        key: `p${index}`,
        fullName: `Person ${index}`,
        title: index < 6 ? "Head of Operations" : "Coordinator",
        buyingRole: index < 6 ? "owner" : "unknown",
        support: index,
      }),
    );
    const result = recommendPeople(twelve);
    expect(result.recommended).toHaveLength(4);
    expect(result.others).toHaveLength(8);
    expect(result.recommended.every((row) => row.buyingRole === "owner")).toBe(true);
  });

  it("keeps the stored reason on the person it belongs to", () => {
    const [top] = recommendPeople([
      person({
        key: "ops",
        buyingRole: "owner",
        whyThisPerson: "Owns operations, the function this engagement changes.",
      }),
    ]).recommended;
    expect(top?.whyThisPerson).toBe("Owns operations, the function this engagement changes.");
  });
});

describe("duplicates", () => {
  it("merges on the same provider person id", () => {
    const rows = dedupePeople([
      person({ key: "a", providerPersonId: "apollo-1" }),
      person({ key: "b", providerPersonId: "apollo-1", title: "Head of Operations" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("Head of Operations");
  });

  it("never merges two people who only share a name and disagree", () => {
    const rows = dedupePeople([
      person({ key: "a", title: "Head of Operations", workEmail: "dana.r@northwind.com" }),
      person({ key: "b", title: "Marketing Lead", workEmail: "dana@northwind.co" }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.ambiguousWith).toContain("b");
    expect(rows[1]?.ambiguousWith).toContain("a");
  });
});

describe("providers", () => {
  it("is not connected when no key is present, and says so plainly", () => {
    const config = { apolloConfigured: false, clayConfigured: false };
    expect(isEnrichmentConnected(config)).toBe(false);
    expect(providerOrder(config)).toEqual([]);
    expect(planBulkEnrichment(3, config).because).toBe(NOT_CONNECTED_MESSAGE);
    expect(planBulkEnrichment(3, config).maximumProviderOperations).toBe(0);
  });

  it("prefers Apollo, then Clay", () => {
    expect(providerOrder({ apolloConfigured: true, clayConfigured: true })).toEqual([
      "apollo",
      "clay",
    ]);
    expect(providerOrder({ apolloConfigured: false, clayConfigured: true })).toEqual(["clay"]);
  });

  it("asks before a paid batch and states the ceiling", () => {
    const plan = planBulkEnrichment(30, { apolloConfigured: true, clayConfigured: true });
    expect(plan.requiresConfirmation).toBe(true);
    expect(plan.people).toBe(30);
    expect(plan.maximumProviderOperations).toBe(60);
    expect(plan.because).toContain("30");
  });

  it("does not ask for a single lookup", () => {
    const plan = planBulkEnrichment(1, { apolloConfigured: true, clayConfigured: false });
    expect(plan.requiresConfirmation).toBe(false);
    expect(plan.provider).toBe("apollo");
    expect(plan.fallback).toBeNull();
  });
});

describe("handoff to Comms", () => {
  const context = ["Hiring three operations roles this quarter, read from their careers page."];

  it("carries the recipient, the reason and the research note", () => {
    const packet = buildOutreachHandoff({
      person: person({
        workEmail: "dana@northwind.com",
        emailStatus: "verified",
        emailVerifiedAt: "2026-09-10T00:00:00.000Z",
        buyingRole: "owner",
        buyingRoleEvidence: "Title leads operations.",
      }),
      now: NOW,
      companyContext: context,
    });
    expect(packet.recipientEmail).toBe("dana@northwind.com");
    expect(packet.emailState).toBe("verified");
    expect(packet.warning).toBeNull();
    expect(packet.companyContext).toEqual(context);
    expect(packet.note).toContain("research");
  });

  it("keeps the warning when the address is stale or unverified", () => {
    const stale = buildOutreachHandoff({
      person: person({
        workEmail: "dana@northwind.com",
        emailStatus: "verified",
        emailVerifiedAt: "2026-01-01T00:00:00.000Z",
      }),
      now: NOW,
      companyContext: [],
    });
    expect(stale.emailState).toBe("stale");
    expect(stale.warning).toContain("Refresh");

    const unverified = buildOutreachHandoff({
      person: person({
        workEmail: "dana@northwind.com",
        emailStatus: "found_unverified",
        emailFetchedAt: NOW,
      }),
      now: NOW,
      companyContext: [],
    });
    expect(unverified.warning).toContain("never verified");
  });

  it("allows outreach only when a route exists", () => {
    expect(canPrepareOutreach("verified")).toBe(true);
    expect(canPrepareOutreach("stale")).toBe(true);
    expect(canPrepareOutreach("not_checked")).toBe(false);
    expect(canPrepareOutreach("not_found", { otherConfirmedChannel: true })).toBe(true);
  });
});

describe("privacy", () => {
  it("drops a personal address and never carries a phone number", () => {
    const shown = forDisplay(person({ workEmail: "dana.reid@gmail.com", emailStatus: "verified" }));
    expect(shown.workEmail).toBeUndefined();
    expect(shown.emailStatus).toBe("not_found");
    expect(Object.keys(shown)).not.toContain("phone");
  });

  it("keeps a work address at the company domain", () => {
    const shown = forDisplay(person({ workEmail: "dana@northwind.com", emailStatus: "verified" }));
    expect(shown.workEmail).toBe("dana@northwind.com");
  });
});
