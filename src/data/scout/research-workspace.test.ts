import { describe, expect, it } from "vitest";

import {
  decisionTrail,
  isObservedSignal,
  researchConfidence,
  reviewStatedEvidence,
  scoutConductorAsk,
  taiDecisionState,
} from "./research-workspace";
import type { ActivityEvent } from "@/domain/activity";
import type { ProspectCandidate } from "@/domain/scout";
import type { FounderSignalPacket } from "@/domain/stated";

const AT = "2026-02-01T00:00:00.000Z";

function packet(overrides: Partial<FounderSignalPacket> = {}): FounderSignalPacket {
  return {
    submissionId: "sub_1",
    submissionRowId: "row_1",
    statedAt: AT,
    claims: [
      { lane: "current_state", statement: "Our scheduling dashboard is manual spreadsheets." },
      { lane: "pains", statement: "We lose two days a week to invoice reconciliation." },
    ],
    transcript: [],
    understanding: { authorizesResearch: true },
    attribution: { landingPath: "/build-my-roadmap", utmSource: "google" },
    ...overrides,
  };
}

function candidate(overrides: Partial<ProspectCandidate> = {}): ProspectCandidate {
  return {
    prospect: {
      id: "p1",
      organizationId: "org",
      name: "Northwind",
      domain: "northwind.com",
      websiteUrl: "https://northwind.com",
      status: "discovered",
      createdAt: AT,
      updatedAt: AT,
    },
    signals: [],
    fit: { whyItFits: "", recommendation: "" },
    source: { kind: "website_intake", label: "Inbound · TrustTai.com" },
    evaluation: { light: "yellow", score: 62, scoreable: true, reasons: [], strongestSignal: "" },
    lastCheckedAt: AT,
    stated: packet(),
    ...overrides,
  } as ProspectCandidate;
}

const observedSignal = {
  id: "obs_1",
  statement: "Their careers page advertises a manual scheduling dashboard rebuild.",
  provenance: {
    appId: "scout",
    actor: { type: "system" as const, id: "scout.research" },
    observedAt: AT,
    confidence: "observed" as const,
  },
  sourceUrl: "https://northwind.com/careers",
};

describe("evidence review", () => {
  it("treats website-echoed signals as testimony, never as observation", () => {
    expect(isObservedSignal(observedSignal)).toBe(true);
    expect(
      isObservedSignal({
        id: "stated_sub_1_0",
        statement: "anything",
        provenance: {
          appId: "website",
          actor: { type: "system", id: "website.intake" },
          observedAt: AT,
          confidence: "inferred",
        },
      }),
    ).toBe(false);
  });

  it("corroborates a claim only when an observed signal speaks to it", () => {
    const review = reviewStatedEvidence(candidate({ signals: [observedSignal] }));
    expect(review.totalClaims).toBe(2);
    expect(review.corroboratedClaims).toBe(1);
    expect(review.claims[0]?.standing).toBe("corroborated");
    expect(review.claims[1]?.standing).toBe("unverified");
    expect(review.coverage).toBeCloseTo(0.5);
  });

  it("says nothing is established when nothing was read", () => {
    const review = reviewStatedEvidence(candidate());
    expect(review.observed).toHaveLength(0);
    expect(researchConfidence(review).level).toBe("unknown");
  });
});

describe("Tai decision state", () => {
  const events: ActivityEvent[] = [
    {
      id: "e1",
      organizationId: "org",
      name: "website.intake_linked",
      subject: { type: "prospect", id: "p1", label: "Northwind" },
      summary: "Intake linked to Northwind on domain evidence.",
      provenance: {
        appId: "website",
        actor: { type: "system", id: "website.intake" },
        observedAt: AT,
      },
      occurredAt: AT,
    },
  ];

  it("asks a person to read the testimony before anything else", () => {
    const c = candidate();
    const decision = taiDecisionState({
      candidate: c,
      review: reviewStatedEvidence(c),
      peopleCount: 0,
      events,
    });
    expect(decision.state).toBe("read_them_first");
    expect(decision.actions.find((a) => a.key === "route_to_comms")?.ready).toBe(false);
  });

  it("blocks research when consent was not given", () => {
    const c = candidate({ stated: packet({ understanding: { authorizesResearch: false } }) });
    const decision = taiDecisionState({
      candidate: c,
      review: reviewStatedEvidence(c),
      peopleCount: 1,
      events,
    });
    const research = decision.actions.find((a) => a.key === "run_research");
    expect(research?.ready).toBe(false);
    expect(research?.blockedBecause).toMatch(/consent/i);
  });

  it("becomes routable once a person acted and evidence exists", () => {
    const personEvent: ActivityEvent = {
      ...events[0]!,
      id: "e2",
      name: "prospect.commented",
      summary: "Read the intake.",
      provenance: {
        appId: "scout",
        actor: { type: "user", id: "u1", label: "Tai" },
        observedAt: AT,
      },
    };
    const c = candidate({
      signals: [
        observedSignal,
        {
          ...observedSignal,
          id: "obs_2",
          statement: "They publish invoice reconciliation guides.",
        },
        {
          ...observedSignal,
          id: "obs_3",
          statement: "Their pricing page lists a scheduling tier.",
        },
        { ...observedSignal, id: "obs_4", statement: "They lose time on manual invoice work." },
      ],
    });
    const review = reviewStatedEvidence(c);
    const decision = taiDecisionState({
      candidate: c,
      review,
      peopleCount: 2,
      events: [...events, personEvent],
    });
    expect(decision.state).toBe("ready_to_route");
    expect(decision.actions.find((a) => a.key === "route_to_comms")?.ready).toBe(true);
    expect(decision.confidence).toBe("high");
  });

  it("keeps a decision trail of what already happened, newest first", () => {
    const trail = decisionTrail([
      events[0]!,
      { ...events[0]!, id: "e3", occurredAt: "2026-02-05T00:00:00.000Z", summary: "Passed" },
    ]);
    expect(trail).toHaveLength(2);
    expect(trail[0]?.label).toBe("Passed");
  });

  it("hands the Conductor a pointer and a question, never state", () => {
    const c = candidate();
    const ask = scoutConductorAsk(
      c,
      taiDecisionState({ candidate: c, review: reviewStatedEvidence(c), peopleCount: 0, events }),
    );
    expect(ask.app).toBe("scout");
    expect(ask.signal).toContain("p1");
    expect(ask.ask).toMatch(/TrustTai\.com/);
  });
});
