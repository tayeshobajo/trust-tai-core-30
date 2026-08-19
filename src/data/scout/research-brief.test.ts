import { describe, expect, it } from "vitest";

import {
  contradictions,
  evidenceCoverage,
  evidenceThemes,
  researchState,
  scoutRead,
} from "./research-brief";
import { researchPermission } from "./research-consent";
import { reviewStatedEvidence } from "./research-workspace";
import type { ProspectCandidate, ScoutSignal } from "@/domain/scout";
import type { FounderSignalPacket } from "@/domain/stated";

function signal(id: string, statement: string, sourceUrl?: string): ScoutSignal {
  return {
    id,
    statement,
    provenance: {
      appId: "scout",
      actor: { type: "system", id: "scout.research" },
      observedAt: "2026-08-19T10:00:00.000Z",
      confidence: "observed",
    },
    ...(sourceUrl ? { sourceUrl } : {}),
  };
}

function packet(
  claims: FounderSignalPacket["claims"],
  authorizesResearch: boolean | null,
): FounderSignalPacket {
  return {
    submissionId: "sub_1",
    submissionRowId: "row_1",
    statedAt: "2026-08-18T09:00:00.000Z",
    claims,
    transcript: [],
    understanding: { authorizesResearch },
    attribution: {},
  };
}

function candidate(input: {
  stated?: FounderSignalPacket;
  signals?: ScoutSignal[];
  consent?: ProspectCandidate["researchConsent"];
}): ProspectCandidate {
  return {
    prospect: {
      id: "p1",
      organizationId: "org1",
      name: "Northwind",
      domain: "northwind.com",
      websiteUrl: "https://northwind.com",
      status: "discovered",
      createdAt: "2026-08-18T09:00:00.000Z",
      updatedAt: "2026-08-18T09:00:00.000Z",
    } as unknown as ProspectCandidate["prospect"],
    signals: input.signals ?? [],
    fit: { whyItFits: "", recommendation: "" },
    source: { kind: input.stated ? "website_intake" : "preview_demo", label: "src" },
    evaluation: { score: 40, criteria: [], scoreable: false } as unknown as ProspectCandidate["evaluation"],
    lastCheckedAt: "2026-08-19T10:00:00.000Z",
    ...(input.stated ? { stated: input.stated } : {}),
    ...(input.consent ? { researchConsent: input.consent } : {}),
  };
}

describe("research permission", () => {
  it("is granted when the founder authorised research", () => {
    const permission = researchPermission(
      candidate({ stated: packet([{ lane: "goals", statement: "Grow commercial work" }], true) }),
    );
    expect(permission.state).toBe("granted");
    expect(permission.canResearch).toBe(true);
  });

  it("is withheld when the founder declined", () => {
    const permission = researchPermission(candidate({ stated: packet([], false) }));
    expect(permission.state).toBe("withheld");
    expect(permission.canResearch).toBe(false);
  });

  it("fails closed when the intake never asked", () => {
    const permission = researchPermission(candidate({ stated: packet([], null) }));
    expect(permission.state).toBe("unknown");
    expect(permission.canResearch).toBe(false);
  });

  it("honours a person's own decision when the intake never asked", () => {
    const permission = researchPermission(
      candidate({
        stated: packet([], null),
        consent: { decision: "granted", by: "u1", byLabel: "Tai", at: "2026-08-19T11:00:00.000Z" },
      }),
    );
    expect(permission.state).toBe("granted");
    expect(permission.canResearch).toBe(true);
    expect(permission.resolvedBy?.byLabel).toBe("Tai");
  });

  it("does not apply to companies that never came through the website", () => {
    const permission = researchPermission(candidate({}));
    expect(permission.state).toBe("not_required");
    expect(permission.canResearch).toBe(true);
  });
});

describe("coverage", () => {
  it("reports unchecked areas rather than inventing findings", () => {
    const observed = [signal("s1", "Contact form present on the contact page")];
    const coverage = evidenceCoverage(candidate({}), observed);
    expect(coverage.checkedCount).toBeLessThan(coverage.total);
    expect(coverage.areas.find((a) => a.key === "conversion")?.checked).toBe(true);
    expect(coverage.areas.find((a) => a.key === "gbp")?.checked).toBe(false);
  });
});

describe("research state", () => {
  it("stays not started when nothing may be researched", () => {
    expect(
      researchState({ observedCount: 0, canResearch: false, contradictions: 0, checkedCount: 0 }),
    ).toBe("not_started");
  });

  it("is ready once permission allows and nothing has been read", () => {
    expect(
      researchState({ observedCount: 0, canResearch: true, contradictions: 0, checkedCount: 0 }),
    ).toBe("ready");
  });

  it("needs review when a mismatch exists", () => {
    expect(
      researchState({ observedCount: 5, canResearch: true, contradictions: 1, checkedCount: 6 }),
    ).toBe("needs_review");
  });

  it("is complete with broad coverage and no mismatch", () => {
    expect(
      researchState({ observedCount: 5, canResearch: true, contradictions: 0, checkedCount: 5 }),
    ).toBe("complete");
  });
});

describe("four lanes", () => {
  it("keeps stated and observed apart and never invents an inference", () => {
    const stated = packet(
      [{ lane: "pains", statement: "Enquiries from the website never get followed up" }],
      true,
    );
    const observed = [
      signal("s1", "The website has no contact form and no enquiry capture", "https://northwind.com"),
    ];
    const review = reviewStatedEvidence(candidate({ stated, signals: observed }));
    const themes = evidenceThemes(candidate({ stated, signals: observed }), review);
    const pains = themes.find((theme) => theme.key === "pains");
    expect(pains?.stated).toHaveLength(1);
    expect(pains?.inferred).toHaveLength(0);
    expect(pains?.suggested.length).toBeGreaterThan(0);
  });
});

describe("contradictions", () => {
  it("raises a mismatch from a real stated claim and real observed evidence", () => {
    const stated = packet(
      [
        {
          lane: "pains",
          statement: "We want automated follow up for every enquiry we receive",
        },
      ],
      true,
    );
    const observed = [
      signal("s1", "The public site has no contact form and no lead capture anywhere"),
    ];
    const review = reviewStatedEvidence(candidate({ stated, signals: observed }));
    const conflicts = contradictions(review);
    expect(conflicts.map((c) => c.key)).toContain("capture");
  });

  it("stays silent on weak evidence", () => {
    const stated = packet([{ lane: "pains", statement: "leads" }], true);
    const review = reviewStatedEvidence(candidate({ stated, signals: [signal("s1", "no cta")] }));
    expect(contradictions(review)).toHaveLength(0);
  });
});

describe("scout read", () => {
  it("never claims verification and flags unresolved permission", () => {
    const stated = packet([{ lane: "goals", statement: "Win larger commercial clients" }], null);
    const subject = candidate({ stated });
    const review = reviewStatedEvidence(subject);
    const coverage = evidenceCoverage(subject, review.observed);
    const read = scoutRead({
      review,
      coverage,
      conflicts: [],
      permissionState: "unknown",
    });
    expect(read.appearsTrue).toHaveLength(0);
    expect(read.deservesAttention.join(" ")).toContain("Research permission was never asked");
    expect(read.doNotAssume.join(" ")).toContain("testimony");
  });
});
