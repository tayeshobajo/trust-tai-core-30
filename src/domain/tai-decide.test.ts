import { describe, expect, it } from "vitest";

import {
  decideAction,
  decideVerdictForStorage,
  historyFromTouches,
  isWriteAction,
  shouldDraft,
  WRITE_ACTIONS,
  type DecideHistoryFacts,
  type DecideInput,
} from "./tai-decide";
import type { WorldCard } from "./world-card";

function card(overrides: Partial<WorldCard> = {}): WorldCard {
  return {
    building: ["Runs a growing dental practice across two cities"],
    caresAbout: ["Patient reviews front and center"],
    recentChanges: ["Announced a second clinic location"],
    visionOutgrewSystem: ["Booking is a phone-only fallback form"],
    whyTrustTai: [
      "The business is moving (second clinic announced) while the digital side has fallen behind (phone-only booking).",
    ],
    unknowns: ["Owner's role in technology decisions"],
    evidence: [
      { statement: "Announced a second clinic location", source: "https://example.com/news" },
    ],
    composedAt: "2026-09-24T00:00:00.000Z",
    evaluatorVersion: "trust-tai-icp-v4",
    intelCollectedAt: null,
    ...overrides,
  };
}

function history(overrides: Partial<DecideHistoryFacts> = {}): DecideHistoryFacts {
  return {
    stage: "ready_to_reach",
    priorOutboundCount: 0,
    priorInboundCount: 0,
    daysSinceLastOutbound: null,
    daysSinceLastInbound: null,
    hasUnansweredOutbound: false,
    hasOpenInbound: false,
    ...overrides,
  };
}

function input(overrides: Partial<DecideInput> = {}): DecideInput {
  return {
    worldCard: card(),
    fit: { light: "green", score: 82, scoreable: true },
    gap: "high",
    contact: { verifiedOwnerEmail: true, anyEmailRoute: true },
    history: history(),
    ...overrides,
  };
}

describe("decideAction, table-driven", () => {
  const cases: {
    name: string;
    given: DecideInput;
    action: string;
    outcome: string;
    writeIntended: boolean;
  }[] = [
    {
      name: "green fit, high gap, verified owner email, no prior contact begins a conversation",
      given: input(),
      action: "begin_conversation",
      outcome: "write_intended",
      writeIntended: true,
    },
    {
      name: "an inbound reply always escalates to Tai in Phase A",
      given: input({ history: history({ hasOpenInbound: true, priorInboundCount: 1 }) }),
      action: "escalate_to_tai",
      outcome: "escalated",
      writeIntended: false,
    },
    {
      name: "an unanswered outbound is never chased: wait, counted as a success",
      given: input({
        history: history({
          hasUnansweredOutbound: true,
          priorOutboundCount: 1,
          daysSinceLastOutbound: 9,
        }),
      }),
      action: "wait",
      outcome: "success_no_action",
      writeIntended: false,
    },
    {
      name: "a live human-led stage escalates rather than acts",
      given: input({ history: history({ stage: "in_conversation" }) }),
      action: "escalate_to_tai",
      outcome: "escalated",
      writeIntended: false,
    },
    {
      name: "red fit does nothing, and doing nothing is a success",
      given: input({ fit: { light: "red", score: 18, scoreable: true } }),
      action: "do_nothing",
      outcome: "success_no_action",
      writeIntended: false,
    },
    {
      name: "an unresearched record observes rather than guesses",
      given: input({
        worldCard: card({
          building: [],
          caresAbout: [],
          recentChanges: [],
          visionOutgrewSystem: [],
          whyTrustTai: [],
          evidence: [],
          unknowns: ["Nothing has been read yet"],
        }),
        fit: { light: "neutral", score: 0, scoreable: false },
        gap: "unknown",
      }),
      action: "observe",
      outcome: "success_no_action",
      writeIntended: false,
    },
    {
      name: "strong fit with dominant unknowns researches deeper before writing",
      given: input({
        worldCard: card({
          caresAbout: [],
          recentChanges: [],
          visionOutgrewSystem: [],
          whyTrustTai: [],
          unknowns: ["Who owns decisions", "Whether the site is theirs", "Budget reality"],
        }),
      }),
      action: "research_deeper",
      outcome: "success_no_action",
      writeIntended: false,
    },
    {
      name: "green fit and a real gap but no verified route researches the route",
      given: input({ contact: { verifiedOwnerEmail: false, anyEmailRoute: false } }),
      action: "research_deeper",
      outcome: "success_no_action",
      writeIntended: false,
    },
    {
      name: "no change and no gap evidence means do_nothing, a correct outcome",
      given: input({
        worldCard: card({ recentChanges: [], whyTrustTai: [] }),
        fit: { light: "yellow", score: 45, scoreable: true },
        gap: "unknown",
        contact: { verifiedOwnerEmail: false, anyEmailRoute: false },
      }),
      action: "do_nothing",
      outcome: "success_no_action",
      writeIntended: false,
    },
    {
      name: "a recent change on an open two-way thread congratulates",
      given: input({
        fit: { light: "yellow", score: 55, scoreable: true },
        gap: "medium",
        history: history({
          stage: "reached_out",
          priorOutboundCount: 2,
          priorInboundCount: 1,
          hasUnansweredOutbound: false,
          hasOpenInbound: false,
        }),
      }),
      action: "congratulate",
      outcome: "write_intended",
      writeIntended: true,
    },
  ];

  for (const entry of cases) {
    it(entry.name, () => {
      const verdict = decideAction(entry.given);
      expect(verdict.action).toBe(entry.action);
      expect(verdict.outcome).toBe(entry.outcome);
      expect(verdict.writeIntended).toBe(entry.writeIntended);
      expect(verdict.rationale.length).toBeGreaterThan(0);
      expect(verdict.confidence).toBeGreaterThanOrEqual(0);
      expect(verdict.confidence).toBeLessThanOrEqual(1);
    });
  }

  it("no_action verdicts are typed as successes, never failures", () => {
    const wait = decideAction(
      input({ history: history({ hasUnansweredOutbound: true, priorOutboundCount: 1 }) }),
    );
    const nothing = decideAction(input({ fit: { light: "red", score: 10, scoreable: true } }));
    expect(wait.outcome).toBe("success_no_action");
    expect(nothing.outcome).toBe("success_no_action");
  });

  it("escalates a would-be write when ambiguity crosses the threshold", () => {
    // A green, high-gap, verified, never-contacted prospect whose card is
    // mostly unknowns but not majority-unknown enough to hit rule 6 does not
    // exist by construction (rule 6 fires first), so drive ambiguity through
    // the congratulate path instead: many unknowns on an open thread.
    const verdict = decideAction(
      input({
        worldCard: card({
          building: [],
          caresAbout: [],
          visionOutgrewSystem: [],
          whyTrustTai: [],
          unknowns: ["a", "b", "c", "d", "e"],
        }),
        fit: { light: "neutral", score: 40, scoreable: true },
        gap: "medium",
        history: history({ priorOutboundCount: 1, priorInboundCount: 1 }),
      }),
    );
    expect(verdict.action).toBe("escalate_to_tai");
    expect(verdict.outcome).toBe("escalated");
    expect(verdict.rationale.join(" ")).toContain("Escalated");
  });

  it("write actions and helpers agree", () => {
    for (const action of WRITE_ACTIONS) expect(isWriteAction(action)).toBe(true);
    expect(isWriteAction("do_nothing")).toBe(false);
    expect(isWriteAction("wait")).toBe(false);
    expect(isWriteAction("escalate_to_tai")).toBe(false);
  });

  it("serializes for storage in snake_case", () => {
    const stored = decideVerdictForStorage(decideAction(input()));
    expect(stored["write_intended"]).toBe(true);
    expect(stored["action"]).toBe("begin_conversation");
  });
});

describe("historyFromTouches", () => {
  const now = new Date("2026-09-24T00:00:00.000Z");

  it("reads an unanswered outbound from the newest touch", () => {
    const facts = historyFromTouches(
      "reached_out",
      [
        { direction: "outbound", occurredAt: "2026-09-10T00:00:00.000Z" },
        { direction: "outbound", occurredAt: "2026-09-01T00:00:00.000Z" },
      ],
      now,
    );
    expect(facts.hasUnansweredOutbound).toBe(true);
    expect(facts.hasOpenInbound).toBe(false);
    expect(facts.priorOutboundCount).toBe(2);
    expect(facts.daysSinceLastOutbound).toBe(14);
  });

  it("reads an open inbound when they spoke last", () => {
    const facts = historyFromTouches(
      "reached_out",
      [
        { direction: "inbound", occurredAt: "2026-09-20T00:00:00.000Z" },
        { direction: "outbound", occurredAt: "2026-09-10T00:00:00.000Z" },
      ],
      now,
    );
    expect(facts.hasOpenInbound).toBe(true);
    expect(facts.hasUnansweredOutbound).toBe(false);
    expect(facts.priorInboundCount).toBe(1);
  });

  it("is empty-safe", () => {
    const facts = historyFromTouches(null, [], now);
    expect(facts.hasOpenInbound).toBe(false);
    expect(facts.hasUnansweredOutbound).toBe(false);
    expect(facts.daysSinceLastOutbound).toBeNull();
  });
});

describe("shouldDraft: the draft path gate", () => {
  it("refuses every non-writing verdict", () => {
    const nonWrite = [
      decideAction(input({ history: history({ hasOpenInbound: true }) })),
      decideAction(input({ history: history({ hasUnansweredOutbound: true, priorOutboundCount: 1 }) })),
      decideAction(input({ fit: { light: "red", score: 10, scoreable: true } })),
      decideAction(
        input({
          worldCard: card({
            building: [],
            caresAbout: [],
            recentChanges: [],
            visionOutgrewSystem: [],
            whyTrustTai: [],
            evidence: [],
            unknowns: [],
          }),
          fit: { light: "neutral", score: 0, scoreable: false },
          gap: "unknown",
        }),
      ),
    ];
    for (const verdict of nonWrite) expect(shouldDraft(verdict)).toBe(false);
  });

  it("allows a genuine writing verdict through", () => {
    expect(shouldDraft(decideAction(input()))).toBe(true);
  });
});
