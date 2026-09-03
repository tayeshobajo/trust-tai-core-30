/**
 * End-to-end contract: TrustTai.com intake → Scout → Steward/Pulse/Conductor.
 *
 * These tests hold the boundary, not an implementation. A submission must
 * survive the whole chain as `stated` truth: never scored, never promoted to
 * observed, always attributed to the Website room.
 */

import { describe, expect, it } from "vitest";

import { auditIntelligenceFreshness } from "./intelligence/freshness";
import { bundleFor, contextBlocks, deriveSignals, emptySnapshot } from "./intelligence/derive";
import { canOpenInConductor, conductorHandoff } from "./pulse/handoff";
import { toPulseSignals } from "./pulse/projection";
import {
  inboundOrigin,
  isInbound,
  withInboundOrigin,
  WEBSITE_INTAKE_ROW_SOURCE,
} from "./scout/inbound";
import { reviewStatedEvidence, taiDecisionState } from "./scout/research-workspace";
import type { ActivityEvent } from "@/domain/activity";
import type { ProspectCandidate } from "@/domain/scout";
import { STATED_METADATA_KEY, packetFromSubmission } from "@/domain/stated";

const AT = "2026-02-01T00:00:00.000Z";
const NOW = "2026-02-03T00:00:00.000Z";

const submission = {
  submissionId: "sub_live_1",
  submittedAt: AT,
  structured: {
    currentState: ["We run delivery scheduling on spreadsheets."],
    desiredFuture: ["One dashboard the leadership team trusts."],
    pains: ["Two days a week lost to reconciliation."],
    goals: [],
    constraints: [],
    existingAssets: [],
    ideas: [],
    openQuestions: [],
  },
  verbatim: [
    {
      questionText: "Where are you today?",
      answerText: "Spreadsheets everywhere.",
      modality: "text" as const,
      skipped: false,
    },
  ],
  signals: {
    frame: "operations",
    frameConfidence: 0.7,
    objectiveCoverage: 0.8,
    completeness: 0.9,
    authorizesResearch: true,
  },
  attribution: { landingPath: "/build-my-roadmap", utm: { source: "google", campaign: "spring" } },
};

function storedProspect(): ProspectCandidate {
  const packet = packetFromSubmission(submission as never, "row_live_1");
  const base: ProspectCandidate = {
    prospect: {
      id: "p_live",
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
    source: { kind: "live_website", label: "Public website" },
    evaluation: { light: "yellow", score: 55, scoreable: true, reasons: [], strongestSignal: "" },
    lastCheckedAt: AT,
  } as unknown as ProspectCandidate;

  const origin = inboundOrigin({
    source: WEBSITE_INTAKE_ROW_SOURCE,
    metadata: { [STATED_METADATA_KEY]: packet },
  })!;
  return withInboundOrigin(base, origin);
}

describe("website intake reaches Scout intact", () => {
  it("recognises an inbound row from its source or its packet", () => {
    expect(isInbound({ source: WEBSITE_INTAKE_ROW_SOURCE })).toBe(true);
    expect(isInbound({ source: "manual", metadata: {} })).toBe(false);
  });

  it("carries stated claims and attribution onto the candidate", () => {
    const candidate = storedProspect();
    expect(candidate.source.kind).toBe("website_intake");
    expect(candidate.stated?.submissionId).toBe("sub_live_1");
    expect(candidate.stated?.claims.map((claim) => claim.lane)).toContain("desired_future");
    expect(candidate.stated?.attribution.utmCampaign).toBe("spring");
  });

  it("never lets testimony count as observed evidence", () => {
    const review = reviewStatedEvidence(storedProspect());
    expect(review.observed).toHaveLength(0);
    expect(review.coverage).toBe(0);
    expect(review.stated.every((signal) => signal.provenance.appId === "website")).toBe(true);
    expect(review.stated.every((signal) => signal.provenance.confidence === "inferred")).toBe(true);
  });

  it("does not change the fit score on the strength of an intake", () => {
    expect(storedProspect().evaluation.score).toBe(55);
  });
});

describe("intake propagates to intelligence consumers", () => {
  function snapshot() {
    const events: ActivityEvent[] = [
      {
        id: "e1",
        organizationId: "org",
        name: "website.intake_linked",
        subject: { type: "prospect", id: "p_live", label: "Northwind" },
        summary: "Roadmap intake linked to Northwind on domain evidence.",
        provenance: {
          appId: "website",
          actor: { type: "system", id: "website.intake" },
          observedAt: AT,
        },
        occurredAt: AT,
      },
    ];
    return {
      ...emptySnapshot("org", NOW),
      candidates: [storedProspect()],
      events,
    };
  }

  it("assembles a stated context block owned by the Website room", () => {
    const blocks = contextBlocks(snapshot());
    const stated = blocks.find((block) => block.id === "website:stated:p_live");
    expect(stated?.appId).toBe("website");
    expect(stated?.tier).toBe("stated");
    expect(stated?.fact).toMatch(/TrustTai\.com/);
    expect(stated?.at).toBe(AT);
  });

  it("names Website as a contributing app in the bundle", () => {
    const bundle = bundleFor(snapshot(), {});
    expect(bundle.contributingApps).toContain("website");
  });

  it("derives signals without inventing anything from testimony", () => {
    const signals = deriveSignals(snapshot());
    const pulse = toPulseSignals({ signals, now: NOW, feedback: [] } as never);
    for (const signal of pulse) {
      expect(signal.title.length).toBeGreaterThan(0);
      if (canOpenInConductor(signal)) {
        expect(conductorHandoff(signal).ask.length).toBeGreaterThan(0);
      }
    }
  });

  it("audits Website as CURRENT once an intake has landed", () => {
    const snap = snapshot();
    const audit = auditIntelligenceFreshness({
      blocks: contextBlocks(snap),
      events: snap.events,
      now: NOW,
    });
    const website = audit.apps.find((app) => app.appId === "website");
    expect(website?.status).toBe("current");
    expect(website?.latestEventName).toBe("website.intake_linked");

    const comms = audit.apps.find((app) => app.appId === "comms");
    expect(comms?.status).toBe("missing");
  });

  it("keeps the Scout decision state honest about unchecked testimony", () => {
    const candidate = storedProspect();
    const decision = taiDecisionState({
      candidate,
      review: reviewStatedEvidence(candidate),
      peopleCount: 0,
      events: snapshot().events,
    });
    expect(decision.state).toBe("read_them_first");
    expect(decision.confidence).toBe("unknown");
    expect(decision.actions.find((a) => a.key === "route_to_comms")?.ready).toBe(false);
  });
});
