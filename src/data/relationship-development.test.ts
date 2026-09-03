/**
 * Locked doctrine, proved in tests:
 *
 *  1. Worth Knowing's actionable queue is people, never anonymous companies:
 *     60%+ fit AND a traceable founder/decision maker. Strong fit with no
 *     person is "needs a person", never "ready".
 *  2. 60% fit triggers deeper research, never outreach. Preparation is
 *     bounded: newly eligible, moved evidence, staleness, or a person's
 *     explicit refresh, never every render.
 *  3. Roadmap is recognized only from needs THEY revealed. Our own copy, *     outbound mail, our notes, even our words quoted back inside their
 *     reply, can never manufacture a signal.
 *  4. Text is a protected channel. Meeting someone, an introduction, or a
 *     found phone number never opens it; only explicit text-route evidence
 *     does.
 */

import { describe, expect, it } from "vitest";

import type { Touch } from "@/domain/comms";
import type { StoredMailboxMessage } from "@/domain/comms-integrations";
import type { RelationshipResearchMarker } from "@/domain/relationship-development";
import type { ProspectCandidate } from "@/domain/scout";
import { EMPTY_INTEL, type ScoutIntel } from "@/domain/scout-intel";

import {
  counterpartyEvidence,
  detectRoadmapOpportunity,
  planRelationshipPreparation,
  recommendChannel,
  worthKnowingMembership,
  type OpportunityPerson,
} from "./relationship-development";

/* ------------------------------------------------------------------ fixtures */

const person = (over: Record<string, unknown> = {}): OpportunityPerson => {
  const base: Record<string, unknown> = {
    fullName: "Jordan Meyer",
    roleTitle: "Founder",
    email: "jordan@example.com",
    decisionMaker: true,
    confirmed: true,
    emailVerified: true,
  };
  for (const [key, value] of Object.entries(over)) {
    if (value === undefined) delete base[key];
    else base[key] = value;
  }
  return base as unknown as OpportunityPerson;
};

const candidate = (over: {
  score?: number;
  scoreable?: boolean;
  status?: string;
  intel?: ScoutIntel;
  development?: ProspectCandidate["development"];
  lastCheckedAt?: string;
}): ProspectCandidate =>
  ({
    prospect: { id: "p1", name: "Acme Studio", status: over.status ?? "discovered" },
    evaluation: {
      scoreable: over.scoreable ?? true,
      score: over.score ?? 80,
    },
    intel: over.intel ?? EMPTY_INTEL,
    ...(over.development ? { development: over.development } : {}),
    lastCheckedAt: over.lastCheckedAt ?? "2026-08-01T00:00:00.000Z",
  }) as unknown as ProspectCandidate;

const intelWithPerson: ScoutIntel = {
  ...EMPTY_INTEL,
  people: [
    {
      fullName: "Jordan Meyer",
      roleTitle: "Founder",
      email: "jordan@example.com",
      decisionMakerLikelihood: "high",
      sourceUrl: "https://acme.example/about",
    },
  ],
} as unknown as ScoutIntel;

const inboundEmail = (bodyText: string, over: Record<string, unknown> = {}) =>
  ({ direction: "inbound", subject: "", bodyText, ...over }) as unknown as Pick<
    StoredMailboxMessage,
    "direction" | "subject" | "snippet" | "bodyText" | "bodyHtml"
  >;

const outboundEmail = (bodyText: string) =>
  ({ direction: "outbound", subject: "", bodyText }) as unknown as Pick<
    StoredMailboxMessage,
    "direction" | "subject" | "snippet" | "bodyText" | "bodyHtml"
  >;

const touch = (
  direction: "inbound" | "outbound",
  summary: string,
  provenance?: Record<string, unknown>,
) =>
  ({
    direction,
    summary,
    body: undefined,
    ...(provenance ? { provenance } : {}),
  }) as unknown as Pick<Touch, "direction" | "summary" | "body" | "provenance">;

/* --------------------------- issue 1, the actionable queue is people */

describe("worth-knowing membership", () => {
  it("admits 60%+ fit with a traceable founder/decision maker", () => {
    expect(worthKnowingMembership(candidate({ score: 80, intel: intelWithPerson }))).toBe(
      "actionable",
    );
  });

  it("keeps a strong-fit company with no person as needs a person, never actionable", () => {
    expect(worthKnowingMembership(candidate({ score: 92 }))).toBe("needs_person");
  });

  it("keeps an unconfirmed lookalike out of the actionable queue", () => {
    const intel: ScoutIntel = {
      ...EMPTY_INTEL,
      people: [
        {
          fullName: "Maybe Person",
          decisionMakerLikelihood: "low",
        },
      ],
    } as unknown as ScoutIntel;
    expect(worthKnowingMembership(candidate({ score: 88, intel }))).toBe("needs_person");
  });

  it("excludes fit below the line, unscored companies, and passed prospects", () => {
    expect(worthKnowingMembership(candidate({ score: 59, intel: intelWithPerson }))).toBe(
      "outside",
    );
    expect(
      worthKnowingMembership(candidate({ score: 0, scoreable: false, intel: intelWithPerson })),
    ).toBe("outside");
    expect(
      worthKnowingMembership(candidate({ score: 90, status: "passed", intel: intelWithPerson })),
    ).toBe("outside");
  });
});

/* --------------------------- issue 2, bounded governed preparation */

describe("relationship preparation planning", () => {
  const prepared: RelationshipResearchMarker = {
    state: "prepared",
    because: "Eligible.",
    version: 1,
    preparedAt: new Date().toISOString(),
    evidenceAt: "2026-08-01T00:00:00.000Z",
    brief: { grounded: true } as never,
  };

  it("prepares once when eligibility is newly reached, research only", () => {
    const plan = planRelationshipPreparation({
      candidate: candidate({ score: 80, intel: intelWithPerson }),
    });
    expect(plan.action).toBe("prepare");
    expect(plan.eligible).toBe(true);
  });

  it("does nothing for a company with no traceable person, and never prepares", () => {
    const plan = planRelationshipPreparation({ candidate: candidate({ score: 95 }) });
    expect(plan.action).toBe("none");
    expect(plan.eligible).toBe(false);
    expect(plan.because).toMatch(/no founder or decision maker/i);
  });

  it("marks a stored brief ineligible when the person is gone", () => {
    const plan = planRelationshipPreparation({
      candidate: candidate({ score: 95, development: { watch: null, research: prepared } }),
    });
    expect(plan.action).toBe("mark_ineligible");
  });

  it("leaves a current prepared brief alone, never re-runs every render", () => {
    const plan = planRelationshipPreparation({
      candidate: candidate({
        score: 80,
        intel: intelWithPerson,
        development: { watch: null, research: prepared },
      }),
    });
    expect(plan.action).toBe("none");
  });

  it("refreshes when the underlying evidence moved", () => {
    const plan = planRelationshipPreparation({
      candidate: candidate({
        score: 80,
        intel: intelWithPerson,
        development: { watch: null, research: prepared },
        lastCheckedAt: "2026-08-10T00:00:00.000Z",
      }),
    });
    expect(plan.action).toBe("refresh");
    expect(plan.because).toMatch(/evidence moved/i);
  });

  it("refreshes a stale brief", () => {
    const stale: RelationshipResearchMarker = {
      ...prepared,
      preparedAt: new Date(Date.now() - 45 * 86_400_000).toISOString(),
    };
    const plan = planRelationshipPreparation({
      candidate: candidate({
        score: 80,
        intel: intelWithPerson,
        development: { watch: null, research: stale },
      }),
      now: new Date(),
    });
    expect(plan.action).toBe("refresh");
    expect(plan.because).toMatch(/days old/i);
  });

  it("honours a person's explicit refresh even when current", () => {
    const plan = planRelationshipPreparation({
      candidate: candidate({
        score: 80,
        intel: intelWithPerson,
        development: { watch: null, research: prepared },
      }),
      force: true,
    });
    expect(plan.action).toBe("refresh");
  });
});

/* --------------------------- issue 3, roadmap from THEIR words only */

describe("roadmap recognition consumes only counterparty words", () => {
  it("detects a founder bottleneck they stated in their own inbound email", () => {
    const evidence = counterpartyEvidence({
      messages: [inboundEmail("Everything still runs through me and I'm becoming the bottleneck.")],
    });
    const signal = detectRoadmapOpportunity(evidence);
    expect(signal.emerging).toBe(true);
    expect(signal.needs.map((need) => need.kind)).toContain("founder_bottleneck");
    const excerpt = signal.needs.find((need) => need.kind === "founder_bottleneck")?.evidence;
    expect(excerpt).toMatch(/bottleneck/i);
    expect(excerpt?.length).toBeLessThanOrEqual(201);
  });

  it("ignores our outbound language quoted back inside their short reply", () => {
    const evidence = counterpartyEvidence({
      messages: [
        outboundEmail("It sounds like everything runs through you and you are the bottleneck."),
        inboundEmail(
          "Thanks, Tai.\n\nOn Mon, Tai wrote:\n> It sounds like everything runs through you and you are the bottleneck.",
        ),
      ],
    });
    expect(evidence).toHaveLength(1);
    expect(detectRoadmapOpportunity(evidence).emerging).toBe(false);
  });

  it("never manufactures a signal from our own outbound copy", () => {
    const evidence = counterpartyEvidence({
      messages: [
        outboundEmail(
          "We should talk about a roadmap, your sequencing and the founder bottleneck are solvable.",
        ),
      ],
      touches: [touch("outbound", "Followed up on roadmap and sequencing next steps.")],
    });
    expect(evidence).toHaveLength(0);
    expect(detectRoadmapOpportunity(evidence).emerging).toBe(false);
  });

  it("ignores our own logged hypothesis unless a person marked it as their words", () => {
    const hypothesis = touch(
      "outbound",
      "My read: everything runs through the founder and she is the bottleneck.",
      { app_key: "comms", actor: "u1" },
    );
    expect(detectRoadmapOpportunity(counterpartyEvidence({ touches: [hypothesis] })).emerging).toBe(
      false,
    );

    const quoted = touch(
      "outbound",
      "She said on the call: everything runs through me and I am the bottleneck.",
      { app_key: "comms", actor: "u1", their_words: true },
    );
    const signal = detectRoadmapOpportunity(counterpartyEvidence({ touches: [quoted] }));
    expect(signal.emerging).toBe(true);
    expect(signal.needs[0]?.source).toMatch(/recorded by a person/i);
  });

  it("surfaces an explicit sequencing problem with their exact excerpt", () => {
    const evidence = counterpartyEvidence({
      messages: [
        inboundEmail(
          "Honestly, we don't know what to do first, the site, the hiring, or the product. Everything else is fine.",
        ),
      ],
    });
    const signal = detectRoadmapOpportunity(evidence);
    expect(signal.emerging).toBe(true);
    expect(signal.needs.map((need) => need.kind)).toContain("unclear_sequencing");
    expect(signal.needs[0]?.evidence).toMatch(/don't know what to do first/i);
    expect(signal.needs[0]?.evidence).not.toMatch(/Everything else is fine/i);
  });

  it("generic warmth and sales vocabulary never trigger", () => {
    const evidence = counterpartyEvidence({
      messages: [inboundEmail("Great to stay connected, excited about our growth and next steps!")],
    });
    expect(detectRoadmapOpportunity(evidence).emerging).toBe(false);
  });
});

/* --------------------------- issue 4, text is a protected channel */

describe("channel recommendation protects text", () => {
  it("met in person with a business email but no text evidence recommends email, not text", () => {
    const read = recommendChannel({ person: person() });
    expect(read?.channel).toBe("email");
  });

  it("a LinkedIn-native opening with a profile recommends LinkedIn", () => {
    const read = recommendChannel({
      person: person({ email: undefined, linkedinUrl: "https://linkedin.com/in/jordan" }),
      signalOrigin: "linkedin",
    });
    expect(read?.channel).toBe("linkedin");
  });

  it("an unverified email is the likely route, not a safely reachable one", () => {
    const read = recommendChannel({ person: person({ emailVerified: false }) });
    expect(read?.channel).toBe("email");
    expect(read?.reason).toContain("not verified yet");
    expect(read?.reason).toContain("not safely reachable");
  });

  it("explicit prior SMS conversation may open text", () => {
    const read = recommendChannel({
      person: person(),
      textEvidence: "prior_sms_conversation",
    });
    expect(read?.channel).toBe("text");
  });

  it("an exchanged direct number may open text", () => {
    const read = recommendChannel({
      person: person(),
      textEvidence: "exchanged_direct_number",
    });
    expect(read?.channel).toBe("text");
  });

  it("a found phone number alone never opens text", () => {
    const read = recommendChannel({ person: person() });
    expect(read?.channel).not.toBe("text");
    const noRoute = recommendChannel({ person: person({ email: undefined }) });
    expect(noRoute?.channel).not.toBe("text");
  });
});
