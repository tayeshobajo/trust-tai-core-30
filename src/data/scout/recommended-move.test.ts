/**
 * The recommended next move, proved state by state:
 *
 *  1. 82% fit with no person is "Find the person first" — never a message.
 *  2. A person with a missing or stale brief is "Understand them first" —
 *     drafting never skips the governed research step.
 *  3. A ready brief with no dated signal is "Worth knowing — no urgency".
 *     Urgency is never manufactured.
 *  4. A ready brief with a real dated signal is "Worth knowing now", and the
 *     signal is cited.
 *  5. A company already in Comms is "Open in Comms" — Scout stops behaving
 *     like outbound and offers no first-message CTA.
 *  6. Text is protected: no text-route evidence, no text recommendation.
 *  7. Watching is a reversible pacing state that preserves the move.
 *  8. Exactly one primary action per state; drafting exists only where earned.
 */

import { describe, expect, it } from "vitest";

import type { Person } from "@/domain/people";
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

const preparedMarker = (over: Record<string, unknown> = {}): RelationshipResearchMarker =>
  ({
    state: "prepared",
    because: "Fit and a traceable person line up.",
    version: 1,
    preparedAt: "2026-08-21T00:00:00.000Z",
    evidenceAt: "2026-08-19T00:00:00.000Z",
    brief: preparedBrief,
    ...over,
  }) as RelationshipResearchMarker;

const candidate = (over: {
  score?: number;
  scoreable?: boolean;
  light?: string;
  status?: string;
  intel?: ScoutIntel;
  development?: ProspectCandidate["development"];
}): ProspectCandidate =>
  ({
    prospect: {
      id: "p1",
      name: "Acme Studio",
      status: over.status ?? "discovered",
      websiteUrl: "https://acme.example",
      domain: "acme.example",
    },
    evaluation: {
      scoreable: over.scoreable ?? true,
      score: over.score ?? 86,
      light: over.light ?? "green",
    },
    intel: over.intel ?? EMPTY_INTEL,
    signals: [],
    fit: { whyItFits: "A strong ICP match." },
    ...(over.development ? { development: over.development } : {}),
    lastCheckedAt: "2026-08-19T00:00:00.000Z",
  }) as unknown as ProspectCandidate;

const readyCandidate = () =>
  candidate({
    score: 86,
    intel: intelWithPerson,
    development: { watch: null, research: preparedMarker() },
  });

/* ------------------------------------- 1 · strong fit, no person on record */

describe("find the person first", () => {
  it("fit 82 with no traceable person never offers a first message", () => {
    const move = buildRecommendedNextMove({ candidate: candidate({ score: 82 }), now: NOW });
    expect(move.state).toBe("find_person");
    expect(move.label).toBe("Find the founder");
    expect(move.primary.kind).toBe("find_person");
    expect(move.primary.label).toBe("Find the founder");
    expect(move.primary.kind).not.toBe("prepare_first_message");
  });
});

/* ----------------------------- 2 · person, but the brief is missing/stale */

describe("understand them first", () => {
  it("fit 81 with a person but no prepared brief gates drafting behind research", () => {
    const move = buildRecommendedNextMove({
      candidate: candidate({ score: 81, intel: intelWithPerson }),
      now: NOW,
    });
    expect(move.state).toBe("research_first");
    expect(move.label).toBe("Understand them first");
    expect(move.primary.kind).toBe("prepare_research");
    expect(move.primary.label).toBe("Prepare research");
  });

  it("a stale brief sends the page back to research, not drafting", () => {
    const stale = preparedMarker({ preparedAt: "2026-07-01T00:00:00.000Z" });
    const move = buildRecommendedNextMove({
      candidate: candidate({
        score: 81,
        intel: intelWithPerson,
        development: { watch: null, research: stale },
      }),
      now: NOW,
    });
    expect(move.state).toBe("research_first");
    expect(move.primary.kind).toBe("prepare_research");
  });

  it("an ungrounded brief fails closed into a forced fresh read", () => {
    const ungrounded = preparedMarker({ brief: { ...preparedBrief, grounded: false } });
    const move = buildRecommendedNextMove({
      candidate: candidate({
        score: 86,
        intel: intelWithPerson,
        development: { watch: null, research: ungrounded },
      }),
      now: NOW,
    });
    expect(move.state).toBe("research_first");
    expect(move.primary.kind).toBe("prepare_research");
    expect(move.prepareForce).toBe(true);
  });
});

/* --------------------------------- 3 · ready, with no dated reason to act */

describe("worth knowing — no urgency", () => {
  it("fit 86 with a ready brief and no dated signal allows the first message", () => {
    const move = buildRecommendedNextMove({ candidate: readyCandidate(), now: NOW });
    expect(move.state).toBe("no_urgency");
    expect(move.label).toBe("Worth knowing — no urgency");
    expect(move.headline).toBe("Start with email to Claire Meneely");
    expect(move.primary.kind).toBe("prepare_first_message");
    expect(move.primary.label).toBe("Prepare first message");
    expect(move.whyNow).toBeNull();
    expect(move.reason).toContain("Nothing is time-sensitive");
  });
});

/* ------------------------------------------------ 4 · a real timely signal */

describe("worth knowing now", () => {
  it("a dated signal is cited as the reason to act", () => {
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
      candidate: candidate({
        score: 86,
        intel,
        development: { watch: null, research: preparedMarker() },
      }),
      now: NOW,
    });
    expect(move.state).toBe("act_now");
    expect(move.label).toBe("Worth knowing now");
    expect(move.primary.kind).toBe("prepare_first_message");
    expect(move.whyNow).toBe("They opened a second location in Franklin");
    expect(move.reason).toContain("They opened a second location in Franklin");
  });
});

/* --------------------------------------------------- 5 · already in Comms */

describe("relationship developing in Comms", () => {
  it("Scout stops behaving like outbound once the company is handed over", () => {
    const move = buildRecommendedNextMove({
      candidate: candidate({
        score: 90,
        status: "ready_for_comms",
        intel: intelWithPerson,
        development: { watch: null, research: preparedMarker() },
      }),
      now: NOW,
    });
    expect(move.state).toBe("in_comms");
    expect(move.label).toBe("Relationship developing in Comms");
    expect(move.primary.kind).toBe("open_in_comms");
    expect(move.primary.label).toBe("Open in Comms");
    expect(move.primary.kind).not.toBe("prepare_first_message");
  });
});

/* ------------------------------------------------------- 6 · protected text */

describe("text is a protected channel", () => {
  it("never recommends text without explicit text-route evidence", () => {
    const withLinkedIn: ScoutIntel = {
      ...intelWithPerson,
      people: [{ ...claire, email: undefined, linkedinUrl: "https://linkedin.com/in/claire" }],
    } as unknown as ScoutIntel;
    const moves = [
      buildRecommendedNextMove({ candidate: readyCandidate(), now: NOW }),
      buildRecommendedNextMove({
        candidate: candidate({
          score: 86,
          intel: withLinkedIn,
          development: { watch: null, research: preparedMarker() },
        }),
        now: NOW,
      }),
    ];
    for (const move of moves) {
      expect(move.channel?.channel).not.toBe("text");
    }
    expect(moves[0]!.channel?.channel).toBe("email");
    expect(moves[1]!.channel?.channel).toBe("linkedin");
    expect(moves[1]!.headline).toBe("Start on LinkedIn with Claire Meneely");
  });
});

/* ------------------------------------------------------- 7 · watching state */

describe("watching is reversible pacing, not a dead end", () => {
  it("watching persists in the read and the recommended move stays available", () => {
    const move = buildRecommendedNextMove({
      candidate: candidate({
        score: 86,
        intel: intelWithPerson,
        development: { watch: "watching", research: preparedMarker() },
      }),
      now: NOW,
    });
    expect(move.watch).toBe("watching");
    expect(move.state).toBe("no_urgency");
    expect(move.primary.kind).toBe("prepare_first_message");
  });

  it("not-now is surfaced as a pacing decision, not a deletion", () => {
    const move = buildRecommendedNextMove({
      candidate: candidate({
        score: 86,
        intel: intelWithPerson,
        development: { watch: "not_now", research: preparedMarker() },
      }),
      now: NOW,
    });
    expect(move.watch).toBe("not_now");
    expect(move.state).toBe("no_urgency");
  });
});

/* ------------------------- 8b · handoff readiness gates the recommendation */

describe("the canonical handoff readiness governs the move", () => {
  const BLOCKERS = [
    "claire@example.com is unverified, so it cannot be treated as reachable.",
    "Research coverage is thin, so the brief rests on partial reading.",
  ];

  it("ready=false with 2 blockers yields the blocked headline and Resolve 2 blockers", () => {
    const move = buildRecommendedNextMove({
      candidate: readyCandidate(),
      now: NOW,
      firstMessage: { ready: false, blockers: BLOCKERS },
    });
    expect(move.blocked).toBe(true);
    expect(move.headline).toBe("Email looks like the right way in — verify it first");
    expect(move.primary.kind).toBe("resolve_blockers");
    expect(move.primary.label).toBe("Resolve 2 blockers");
    expect(move.primary.kind).not.toBe("prepare_first_message");
    expect(move.reason).toContain(BLOCKERS[0]);
    expect(move.reason).toContain(BLOCKERS[1]);
  });

  it("a single blocker is named in the singular", () => {
    const move = buildRecommendedNextMove({
      candidate: readyCandidate(),
      now: NOW,
      firstMessage: { ready: false, blockers: [BLOCKERS[0]!] },
    });
    expect(move.primary.kind).toBe("resolve_blockers");
    expect(move.primary.label).toBe("Resolve 1 blocker");
  });

  it("ready=true yields the normal channel headline and Prepare first message", () => {
    const move = buildRecommendedNextMove({
      candidate: readyCandidate(),
      now: NOW,
      firstMessage: { ready: true, blockers: [] },
    });
    expect(move.blocked).toBe(false);
    expect(move.headline).toBe("Start with email to Claire Meneely");
    expect(move.primary.kind).toBe("prepare_first_message");
    expect(move.primary.label).toBe("Prepare first message");
  });

  it("a blocked non-email route speaks about the person, never instructs outreach", () => {
    const withLinkedIn: ScoutIntel = {
      ...intelWithPerson,
      people: [{ ...claire, email: undefined, linkedinUrl: "https://linkedin.com/in/claire" }],
    } as unknown as ScoutIntel;
    const move = buildRecommendedNextMove({
      candidate: candidate({
        score: 86,
        intel: withLinkedIn,
        development: { watch: null, research: preparedMarker() },
      }),
      now: NOW,
      firstMessage: { ready: false, blockers: BLOCKERS },
    });
    expect(move.blocked).toBe(true);
    expect(move.headline).toBe("Claire is worth knowing — verify the way in first");
    expect(move.primary.kind).toBe("resolve_blockers");
  });
});

/* ------------------------------------ 8 · one canonical path, no duplicates */

describe("one canonical decision surface", () => {
  it("prepare-first-message exists only where it is earned", () => {
    const states = [
      buildRecommendedNextMove({ candidate: candidate({ score: 82 }), now: NOW }),
      buildRecommendedNextMove({
        candidate: candidate({ score: 81, intel: intelWithPerson }),
        now: NOW,
      }),
      buildRecommendedNextMove({
        candidate: candidate({ score: 90, status: "ready_for_comms", intel: intelWithPerson }),
        now: NOW,
      }),
      buildRecommendedNextMove({ candidate: candidate({ score: 40 }), now: NOW }),
      buildRecommendedNextMove({
        candidate: candidate({ scoreable: false, score: 0 }),
        now: NOW,
      }),
    ];
    for (const move of states) {
      expect(move.primary.kind).not.toBe("prepare_first_message");
    }
    expect(states[3]!.primary.kind).toBe("none");
    expect(states[4]!.primary.kind).toBe("research_company");
  });

  it("a passed company offers no relationship move at all", () => {
    const move = buildRecommendedNextMove({
      candidate: candidate({ score: 90, status: "passed", intel: intelWithPerson }),
      now: NOW,
    });
    expect(move.state).toBe("not_ready");
    expect(move.primary.kind).toBe("none");
  });
});

/* ------------------------- the Person stage names the real missing step */

describe("the person stage distinguishes the real missing step", () => {
  const discovered = (over: Record<string, unknown>) =>
    ({
      ...EMPTY_INTEL,
      collectedAt: "2026-08-19T00:00:00.000Z",
      people: [
        {
          fullName: "Sara Warren",
          roleTitle: "Founder",
          sourceUrl: "https://acme.example/about",
          ...over,
        },
      ],
    }) as unknown as ScoutIntel;

  it("1 · 77% fit with nobody on record is Find the founder", () => {
    const move = buildRecommendedNextMove({ candidate: candidate({ score: 77 }), now: NOW });
    expect(move.state).toBe("find_person");
    expect(move.label).toBe("Find the founder");
    expect(move.headline).toBe("Find the founder or decision maker");
    expect(move.primary.kind).toBe("find_person");
    expect(move.primary.label).toBe("Find the founder");
    expect(move.progress.find((s) => s.key === "match")?.state).toBe("complete");
    expect(move.progress.find((s) => s.key === "person")?.state).toBe("current");
  });

  it("2 · a discovered founder with no route is Find a way in, never Find the person", () => {
    const move = buildRecommendedNextMove({
      candidate: candidate({ score: 77, intel: discovered({ decisionMakerLikelihood: "high" }) }),
      now: NOW,
    });
    expect(move.state).toBe("find_route");
    expect(move.label).toBe("Find a way in");
    expect(move.headline).toBe("Find a way to reach Sara Warren");
    expect(move.primary.kind).toBe("find_contact_route");
    expect(move.primary.label).toBe("Find contact route");
  });

  it("2b · a People record never hides a discovered founder", () => {
    const people = [
      {
        id: "rec-1",
        fullName: "Jordan Ellis",
        roleTitle: "Office Manager",
        seniority: "operations",
        confidence: "asserted_by_provider",
        emailStatus: "none",
      },
    ] as unknown as Person[];
    const move = buildRecommendedNextMove({
      candidate: candidate({
        score: 77,
        intel: discovered({ decisionMakerLikelihood: "high" }),
      }),
      people,
      now: NOW,
    });
    expect(move.state).toBe("find_route");
    expect(move.headline).toBe("Find a way to reach Sara Warren");
  });

  it("3 · a named person with a route but no established decision role is Confirm who decides", () => {
    const move = buildRecommendedNextMove({
      candidate: candidate({
        score: 77,
        intel: discovered({
          decisionMakerLikelihood: "low",
          linkedinUrl: "https://linkedin.com/in/sara",
        }),
      }),
      now: NOW,
    });
    expect(move.state).toBe("confirm_decider");
    expect(move.label).toBe("Confirm who decides");
    expect(move.headline).toBe("Confirm whether Sara Warren is the right person");
    expect(move.primary.kind).toBe("confirm_decision_maker");
    expect(move.primary.label).toBe("Confirm decision maker");
  });

  it("4 · a founder with a LinkedIn route proceeds to research, never Find the person", () => {
    const move = buildRecommendedNextMove({
      candidate: candidate({
        score: 77,
        intel: discovered({
          decisionMakerLikelihood: "high",
          linkedinUrl: "https://linkedin.com/in/sara",
        }),
      }),
      now: NOW,
    });
    expect(move.state).toBe("research_first");
    expect(move.primary.kind).toBe("prepare_research");
    expect(move.headline).toBe("Understand Sara before writing");
  });

  it("5 · a founder with an unverified email is Verify the way in, with the confirmation as the one action", () => {
    const people = [
      {
        id: "rec-9",
        fullName: "Sara Warren",
        roleTitle: "Founder",
        seniority: "founder",
        email: "sara@acme.example",
        emailStatus: "found",
        confidence: "observed",
      },
    ] as unknown as Person[];
    const move = buildRecommendedNextMove({
      candidate: candidate({ score: 77 }),
      people,
      now: NOW,
      firstMessage: {
        ready: false,
        blockers: ["sara@acme.example is unverified, so it cannot be treated as reachable."],
        confirmEmailPersonId: "rec-9",
      },
    });
    expect(move.state).toBe("verify_route");
    expect(move.headline).toBe("Verify the way in");
    expect(move.primary.kind).toBe("confirm_email");
    expect(move.primary.label).toBe("Confirm this address");
    expect(move.primary.kind).not.toBe("prepare_first_message");
    expect(move.blocked).toBe(true);
  });

  it("6 · a verified route with a missing brief is Prepare research", () => {
    const people = [
      {
        id: "rec-9",
        fullName: "Sara Warren",
        roleTitle: "Founder",
        seniority: "founder",
        email: "sara@acme.example",
        emailStatus: "verified",
        confidence: "human_confirmed",
      },
    ] as unknown as Person[];
    const move = buildRecommendedNextMove({
      candidate: candidate({ score: 77 }),
      people,
      now: NOW,
      firstMessage: { ready: false, blockers: ["The brief is missing."] },
    });
    expect(move.state).toBe("research_first");
    expect(move.headline).toBe("Understand Sara before writing");
    expect(move.primary.kind).toBe("prepare_research");
    expect(move.progress.find((s) => s.key === "person")?.state).toBe("complete");
    expect(move.progress.find((s) => s.key === "research")?.state).toBe("current");
  });

  it("7 · a ready brief is Prepare first message on the First message stage", () => {
    const people = [
      {
        id: "rec-1",
        fullName: "Claire Meneely",
        roleTitle: "Founder",
        seniority: "founder",
        email: "claire@example.com",
        emailStatus: "verified",
        confidence: "human_confirmed",
      },
    ] as unknown as Person[];
    const move = buildRecommendedNextMove({
      candidate: readyCandidate(),
      people,
      now: NOW,
      firstMessage: { ready: true, blockers: [] },
    });
    expect(move.state).toBe("no_urgency");
    expect(move.primary.kind).toBe("prepare_first_message");
    expect(move.progress.find((s) => s.key === "first_message")?.state).toBe("current");
  });

  it("9 · the final blocker clearing advances the move to Prepare first message on its own", () => {
    const people = (emailStatus: string, confidence: string) =>
      [
        {
          id: "rec-9",
          fullName: "Claire Meneely",
          roleTitle: "Founder",
          seniority: "founder",
          email: "claire@example.com",
          emailStatus,
          confidence,
        },
      ] as unknown as Person[];

    // Before: the lone unverified address is the only thing in the way, and
    // the one action is the governed confirmation — never the first message.
    const before = buildRecommendedNextMove({
      candidate: readyCandidate(),
      people: people("found", "observed"),
      now: NOW,
      firstMessage: {
        ready: false,
        blockers: ["claire@example.com is unverified, so it cannot be treated as reachable."],
        confirmEmailPersonId: "rec-9",
      },
    });
    expect(before.state).toBe("verify_route");
    expect(before.primary.kind).toBe("confirm_email");
    expect(before.blocked).toBe(true);

    // After: the same inputs one confirmation later. Nothing else changed —
    // the recommendation advances on the recomputed readiness alone, with no
    // manual refresh and no rediscovery.
    const after = buildRecommendedNextMove({
      candidate: readyCandidate(),
      people: people("verified", "human_confirmed"),
      now: NOW,
      firstMessage: { ready: true, blockers: [] },
    });
    expect(after.state).toBe("no_urgency");
    expect(after.blocked).toBeFalsy();
    expect(after.headline).toBe("Start with email to Claire Meneely");
    expect(after.primary).toEqual({ kind: "prepare_first_message", label: "Prepare first message" });
    expect(after.progress.find((s) => s.key === "first_message")?.state).toBe("current");
  });

  it("8 · in Comms, every stage is complete and the move is Open in Comms", () => {
    const move = buildRecommendedNextMove({
      candidate: candidate({
        score: 90,
        status: "ready_for_comms",
        intel: intelWithPerson,
        development: { watch: null, research: preparedMarker() },
      }),
      now: NOW,
    });
    expect(move.state).toBe("in_comms");
    expect(move.primary.kind).toBe("open_in_comms");
    expect(move.progress.every((s) => s.state === "complete")).toBe(true);
  });
});
