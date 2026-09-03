/**
 * Readiness-aware recommendations, proved both ways:
 *
 *  1. A gated first message never reads as outreach: the headline names the
 *     gate, the one action is resolving the blockers, and the reason says
 *     exactly what stands in the way.
 *  2. A clear handoff reads as outreach: "Start with email to …" with
 *     "Prepare first message".
 *  3. The gate is named honestly for non-email channels too, without ever
 *     inventing a channel.
 *  4. The evidence list carries concise facts, not a second interpretation.
 */

import { describe, expect, it } from "vitest";

import type {
  RelationshipDevelopmentBrief,
  RelationshipResearchMarker,
} from "@/domain/relationship-development";
import type { ProspectCandidate } from "@/domain/scout";
import { EMPTY_INTEL, type ScoutIntel } from "@/domain/scout-intel";

import { buildRecommendedNextMove } from "./recommended-move";

const NOW = new Date("2026-08-24T00:00:00.000Z");

const claire = {
  fullName: "Claire Meneely",
  roleTitle: "Founder",
  email: "claire@example.com",
  decisionMakerLikelihood: "high",
  sourceUrl: "https://acme.example/about",
};

const intelWithPerson: ScoutIntel = {
  ...EMPTY_INTEL,
  collectedAt: "2026-08-19T00:00:00.000Z",
  people: [claire],
} as unknown as ScoutIntel;

const preparedBrief: RelationshipDevelopmentBrief = {
  whyNow: null,
  humanSignal: "Their catering and wholesale path converts well",
  whatIsInteresting: "A neighborhood bakery growing into wholesale",
  whatTaiCanNotice: "Their catering and wholesale path converts well",
  risksOrAssumptions: [],
  bestChannel: "email",
  channelReason: "A legitimate business email is on record for Claire Meneely.",
  bridgeIdeas: [],
  firstMovePosture: "Step into Claire Meneely's world.",
  shouldActNow: false,
  evidenceUsed: [{ label: "ICP fit 86% (deterministic evaluator)", kind: "computed" }],
  grounded: true,
  generatedAt: "2026-08-21T00:00:00.000Z",
};

const preparedMarker = (): RelationshipResearchMarker =>
  ({
    state: "prepared",
    because: "Fit and a traceable person line up.",
    version: 1,
    preparedAt: "2026-08-21T00:00:00.000Z",
    evidenceAt: "2026-08-19T00:00:00.000Z",
    brief: preparedBrief,
  }) as RelationshipResearchMarker;

const candidate = (over: { intel?: ScoutIntel; status?: string }): ProspectCandidate =>
  ({
    prospect: {
      id: "p1",
      name: "Acme Studio",
      status: over.status ?? "discovered",
      websiteUrl: "https://acme.example",
      domain: "acme.example",
    },
    evaluation: { scoreable: true, score: 86, light: "green" },
    intel: over.intel ?? intelWithPerson,
    signals: [],
    fit: { whyItFits: "A strong ICP match." },
    development: { watch: null, research: preparedMarker() },
    lastCheckedAt: "2026-08-19T00:00:00.000Z",
  }) as unknown as ProspectCandidate;

const UNVERIFIED = "claire@example.com is unverified, so it cannot be treated as reachable.";
const THIN = "Research coverage is thin, so the brief rests on partial reading.";

/* ------------------------------- 1 · gated means gated, never "start" ---- */

describe("a gated first message names the gate", () => {
  it("blocked email outreach never instructs Tai to start", () => {
    const move = buildRecommendedNextMove({
      candidate: candidate({}),
      firstMessage: { ready: false, blockers: [UNVERIFIED, THIN] },
      now: NOW,
    });
    expect(move.state).toBe("no_urgency");
    expect(move.blocked).toBe(true);
    expect(move.headline).toBe("Email looks like the right way in, verify it first");
    expect(move.headline).not.toMatch(/^Start with email/);
    expect(move.primary.kind).toBe("resolve_blockers");
    expect(move.primary.label).toBe("Resolve 2 blockers");
    // The reason carries the worth-knowing read and the exact things in the way.
    expect(move.reason).toContain("credible person");
    expect(move.reason).toContain(UNVERIFIED);
    expect(move.reason).toContain(THIN);
    expect(move.reason).toContain("Clear both");
  });

  it("a single blocker reads in the singular", () => {
    const move = buildRecommendedNextMove({
      candidate: candidate({}),
      firstMessage: { ready: false, blockers: [UNVERIFIED] },
      now: NOW,
    });
    expect(move.primary.label).toBe("Resolve 1 blocker");
    expect(move.reason).toContain("Clear it");
  });

  it("urgency does not override the gate: the signal is cited, the gate is named", () => {
    const intel: ScoutIntel = {
      ...intelWithPerson,
      buyingSignals: [
        {
          statement: "They opened a second location in Franklin",
          observedAt: "2026-08-20T00:00:00.000Z",
        },
      ],
    } as unknown as ScoutIntel;
    const move = buildRecommendedNextMove({
      candidate: candidate({ intel }),
      firstMessage: { ready: false, blockers: [UNVERIFIED] },
      now: NOW,
    });
    expect(move.state).toBe("act_now");
    expect(move.whyNow).toBe("They opened a second location in Franklin");
    expect(move.blocked).toBe(true);
    expect(move.headline).toBe("Email looks like the right way in, verify it first");
    expect(move.primary.kind).toBe("resolve_blockers");
    expect(move.reason).toContain(UNVERIFIED);
  });
});

/* ------------------------------------ 2 · a clear handoff reads as outreach */

describe("a clear handoff opens the first message", () => {
  it("ready means the outreach headline and the one action", () => {
    const move = buildRecommendedNextMove({
      candidate: candidate({}),
      firstMessage: { ready: true, blockers: [] },
      now: NOW,
    });
    expect(move.blocked).toBe(false);
    expect(move.headline).toBe("Start with email to Claire Meneely");
    expect(move.primary.kind).toBe("prepare_first_message");
    expect(move.primary.label).toBe("Prepare first message");
    expect(move.reason).not.toContain("Still in the way");
  });

  it("an unexamined handoff keeps the historical outreach read", () => {
    const move = buildRecommendedNextMove({ candidate: candidate({}), now: NOW });
    expect(move.blocked).toBe(false);
    expect(move.primary.kind).toBe("prepare_first_message");
  });
});

/* ----------------------------------- 3 · the gate is honest off email too */

describe("non-email channels", () => {
  it("a blocked LinkedIn route names the person, not a channel Scout cannot promise", () => {
    const linkedinOnly: ScoutIntel = {
      ...intelWithPerson,
      people: [{ ...claire, email: undefined, linkedinUrl: "https://linkedin.com/in/claire" }],
    } as unknown as ScoutIntel;
    const move = buildRecommendedNextMove({
      candidate: candidate({ intel: linkedinOnly }),
      firstMessage: { ready: false, blockers: [THIN] },
      now: NOW,
    });
    expect(move.channel?.channel).toBe("linkedin");
    expect(move.blocked).toBe(true);
    expect(move.headline).toBe("Claire is worth knowing, verify the way in first");
    expect(move.headline).not.toContain("LinkedIn");
  });
});

/* ------------------------------ 4 · evidence is concise facts, not prose */

describe("evidence supports, it does not re-explain", () => {
  it("carries the fit, the person, the way in, and the urgency read", () => {
    const move = buildRecommendedNextMove({
      candidate: candidate({}),
      firstMessage: { ready: false, blockers: [UNVERIFIED] },
      now: NOW,
    });
    const labels = move.evidence.map((item) => item.label);
    expect(labels).toContain("ICP fit 86%");
    expect(labels).toContain("Claire Meneely identified as Founder");
    expect(labels).toContain("Business email found but unverified");
    expect(labels).toContain("No dated signal on record");
    expect(move.evidence.length).toBeLessThanOrEqual(5);
  });

  it("a verified address reads as verified, and a dated signal replaces the no-signal note", () => {
    const intel: ScoutIntel = {
      ...intelWithPerson,
      buyingSignals: [
        {
          statement: "They opened a second location in Franklin",
          observedAt: "2026-08-20T00:00:00.000Z",
        },
      ],
    } as unknown as ScoutIntel;
    const brief = { ...preparedBrief, bestChannel: "email" as const };
    const marker = {
      ...preparedMarker(),
      brief,
    } as RelationshipResearchMarker;
    const dated = {
      ...candidate({ intel }),
      development: { watch: null, research: marker },
    } as unknown as ProspectCandidate;
    // The entry's email is treated as verified through the brief's channel read.
    const move = buildRecommendedNextMove({
      candidate: dated,
      firstMessage: { ready: true, blockers: [] },
      now: NOW,
    });
    const labels = move.evidence.map((item) => item.label);
    expect(labels).not.toContain("No dated signal on record");
    expect(move.state).toBe("act_now");
  });
});
