/**
 * The communication-judgment contract, pinned.
 *
 * These tests guard the failures seen in production: a comma-formatted name
 * must never leak into a salutation, a judgment must round-trip through a
 * draft's rationale without disturbing the staged send extras, the thread a
 * draft reasons over must name what is actually owed, and drafting below the
 * grounding bar must fail honestly rather than invent a reason.
 */

import { describe, expect, it } from "vitest";

import {
  assessDraftGrounding,
  judgmentSummaryLines,
  parseCommunicationJudgment,
  readCommunicationJudgment,
  readDraftGrounding,
  salutationName,
  summarizeDraftGrounding,
  threadContextForJudgment,
  unearnedAskInBody,
  writeCommunicationJudgment,
  writeDraftGrounding,
  type CommunicationJudgment,
} from "./comms-judgment";
import { readOutgoingExtras, writeOutgoingExtras } from "./comms-outgoing";

describe("salutationName", () => {
  it("resolves surname-first exports to the given name", () => {
    expect(salutationName("Vinyard, Larry")).toBe("Larry");
    expect(salutationName("Vinyard,Larry")).toBe("Larry");
    expect(salutationName("  Smith,  Jane  ")).toBe("Jane");
    expect(salutationName("de la Cruz, Maria")).toBe("Maria");
  });

  it("uses the first token of a natural-order name", () => {
    expect(salutationName("Larry Vinyard")).toBe("Larry");
    expect(salutationName("Madonna")).toBe("Madonna");
  });

  it("never leaves a trailing comma or punctuation on the token", () => {
    expect(salutationName("Vinyard,")).toBe("Vinyard");
    expect(salutationName("Larry,")).toBe("Larry");
    expect(salutationName("O'Brien, Siobhán")).toBe("Siobhán");
  });

  it("returns empty when there is nothing safe to say", () => {
    expect(salutationName("")).toBe("");
    expect(salutationName("   ")).toBe("");
    expect(salutationName(",")).toBe("");
  });
});

const JUDGMENT: CommunicationJudgment = {
  whyNow: "They asked about timing; a straight answer and a next step are owed.",
  latestHumanSignal: "They mentioned almost in passing that their team just shipped phase one.",
  whatThisSaysAboutThem: "They are proud of the team's momentum and want a partner who keeps pace.",
  whatDeservesAcknowledgment: "The phase one ship, name it before answering the timing question.",
  threadToBuildOn: "Their momentum: what phase two looks like now that phase one is live.",
  intendedEffect: "That they feel heard and unhurried, with a clear way forward.",
  responseObligation: "They asked whether the proposal covers phase two.",
  askDecision: {
    shouldAsk: true,
    whyNatural: "They asked a question that genuinely needs a short live discussion.",
    what: "Offer two concrete times for a short call.",
  },
  factsAllowed: ["They asked about phase two (observed, latest inbound)."],
  factsAvoid: ["Do not claim we already scoped phase two."],
  voiceEvidenceUsed: ["Short declarative sentences", "Close with Trust, Tai"],
  learnedExamplesUsed: [],
};

describe("communication judgment on the rationale", () => {
  it("round-trips whole through write and read", () => {
    const rationale = writeCommunicationJudgment({ violations: [] }, JUDGMENT);
    expect(readCommunicationJudgment(rationale)).toEqual(JUDGMENT);
    // Existing rationale keys are preserved, not replaced.
    expect(rationale["violations"]).toEqual([]);
  });

  it("does not disturb staged send extras sharing the rationale", () => {
    const withExtras = writeOutgoingExtras({}, { cc: ["a@example.com"], bcc: [] });
    const withJudgment = writeCommunicationJudgment(withExtras, JUDGMENT);
    expect(readOutgoingExtras(withJudgment)).toEqual({ cc: ["a@example.com"], bcc: [] });
    expect(readCommunicationJudgment(withJudgment)).toEqual(JUDGMENT);
    // And writing extras later must not destroy the judgment either.
    const rewritten = writeOutgoingExtras(withJudgment, { cc: [], bcc: ["b@example.com"] });
    expect(readCommunicationJudgment(rewritten)).toEqual(JUDGMENT);
    expect(readOutgoingExtras(rewritten)).toEqual({ cc: [], bcc: ["b@example.com"] });
  });

  it("reads null when no judgment is on record", () => {
    expect(readCommunicationJudgment(null)).toBeNull();
    expect(readCommunicationJudgment({})).toBeNull();
    expect(readCommunicationJudgment({ communication_judgment: "noise" })).toBeNull();
  });

  it("refuses a judgment without its core read", () => {
    expect(parseCommunicationJudgment({})).toBeNull();
    expect(parseCommunicationJudgment({ whyNow: "Only a reason." })).toBeNull();
    expect(parseCommunicationJudgment({ latestHumanSignal: "Only a signal." })).toBeNull();
    expect(parseCommunicationJudgment("not an object")).toBeNull();
  });

  it("reads judgments persisted before the conversation-first rename", () => {
    const legacy = parseCommunicationJudgment({
      communicationJob: "Answer their timing question.",
      relationshipRead: "Warm and active.",
      toneAndPosture: "Direct and brief.",
      nextMove: "Offer two times.",
      factsAllowed: ["They asked about phase two."],
      voiceEvidenceUsed: ["Short declarative sentences"],
    });
    expect(legacy).not.toBeNull();
    expect(legacy?.whyNow).toBe("Answer their timing question.");
    expect(legacy?.latestHumanSignal).toBe("Warm and active.");
    expect(legacy?.intendedEffect).toBe("Direct and brief.");
    expect(legacy?.askDecision).toEqual({
      shouldAsk: true,
      whyNatural: "",
      what: "Offer two times.",
    });
    expect(legacy?.learnedExamplesUsed).toEqual([]);
  });

  it("reads the pre-rename nextMove shape into the ask decision", () => {
    const legacy = parseCommunicationJudgment({
      whyNow: "Reply owed.",
      whatNoticed: "They are deciding.",
      nextMove: { ask: true, what: "" },
    });
    expect(legacy?.askDecision).toEqual({ shouldAsk: false, whyNatural: "", what: "" });
  });

  it("drops an ask with no content and keeps whyNatural when no ask belongs", () => {
    const parsed = parseCommunicationJudgment({
      ...JUDGMENT,
      askDecision: { shouldAsk: true, whyNatural: "Momentum.", what: "" },
    });
    expect(parsed?.askDecision.shouldAsk).toBe(false);
    const noAsk = parseCommunicationJudgment({
      ...JUDGMENT,
      askDecision: {
        shouldAsk: false,
        whyNatural: "She gave warmth; the conversation has not earned an ask.",
        what: "",
      },
    });
    expect(noAsk?.askDecision).toEqual({
      shouldAsk: false,
      whyNatural: "She gave warmth; the conversation has not earned an ask.",
      what: "",
    });
  });
});

describe("judgmentSummaryLines", () => {
  it("reads as why now, noticed, what it says, what to build on, and the ask", () => {
    const lines = judgmentSummaryLines(JUDGMENT);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe(`Why now: ${JUDGMENT.whyNow}`);
    expect(lines[1]).toBe(`What I noticed: ${JUDGMENT.latestHumanSignal}`);
    expect(lines[2]).toBe(`What it says about them: ${JUDGMENT.whatThisSaysAboutThem}`);
    expect(lines[3]).toBe(`What to build on: ${JUDGMENT.threadToBuildOn}`);
    expect(lines[4]).toBe(`Ask: ${JUDGMENT.askDecision.what} (${JUDGMENT.askDecision.whyNatural})`);
  });

  it("says plainly when there is no ask, with the reason when one was judged", () => {
    const noReason = judgmentSummaryLines({
      ...JUDGMENT,
      askDecision: { shouldAsk: false, whyNatural: "", what: "" },
    });
    expect(noReason.at(-1)).toBe("No ask needed.");

    const withReason = judgmentSummaryLines({
      ...JUDGMENT,
      askDecision: {
        shouldAsk: false,
        whyNatural: "A warm note deserves acknowledgment, not a request for time.",
        what: "",
      },
    });
    expect(withReason.at(-1)).toBe(
      "No ask: A warm note deserves acknowledgment, not a request for time.",
    );
  });
});

describe("the Brooke regression at judgment level", () => {
  /* Brooke thanked Tai for kind words, said it was lovely to meet him,
     enjoyed his perspective in the Mastermind, and offered to be a resource.
     The judgment the model returns for that thread must read as generosity
     recognized, and no ask, because nothing in her note earns one. This
     pins the contract shape that judgment takes once parsed. */
  const BROOKE_JUDGMENT_RAW = {
    whyNow:
      "Brooke replied warmly to Tai's note after the Mastermind; a reply is owed while the thread is warm.",
    latestHumanSignal:
      "She offered to be a resource, meeting someone once and already thinking about how she might be useful to them.",
    whatThisSaysAboutThem:
      "A generous, help-first orientation; consistent with her daily work guiding business owners.",
    whatDeservesAcknowledgment:
      "The offer to be a resource itself, and the generosity underneath it.",
    threadToBuildOn:
      "Her instinct to be useful, and the work with business owners it likely comes from.",
    intendedEffect:
      "That she feels specifically seen, and glad the Mastermind put them in the same room.",
    responseObligation:
      "Her thanks and her kind words about the Mastermind deserve acknowledgment.",
    askDecision: {
      shouldAsk: false,
      whyNatural:
        "She gave warmth and an open door; nothing in her note suggests talking soon, so a call would feel like a funnel move, not a reply.",
      what: "",
    },
    factsAllowed: [
      "She thanked Tai for his kind words (latest inbound).",
      "She said it was lovely to meet him and enjoyed his perspective in the Mastermind (latest inbound).",
      "She offered to be a resource (latest inbound).",
    ],
    factsAvoid: ["Do not claim a shared history beyond the Mastermind meeting."],
    voiceEvidenceUsed: ["Make them feel specifically seen", "No forced call to action"],
    learnedExamplesUsed: [],
  };

  it("parses a generosity-first, no-ask judgment whole", () => {
    const judgment = parseCommunicationJudgment(BROOKE_JUDGMENT_RAW);
    expect(judgment).not.toBeNull();
    expect(judgment?.latestHumanSignal).toContain("resource");
    expect(judgment?.whatDeservesAcknowledgment).toContain("generosity");
    expect(judgment?.threadToBuildOn).toContain("business owners");
    expect(judgment?.askDecision.shouldAsk).toBe(false);
    expect(judgment?.askDecision.whyNatural).toContain("nothing in her note");
  });

  it("summarizes the Brooke judgment as noticed, understood, build-on, no ask", () => {
    const judgment = parseCommunicationJudgment(BROOKE_JUDGMENT_RAW);
    const lines = judgmentSummaryLines(judgment!);
    expect(lines.some((line) => line.startsWith("What I noticed:"))).toBe(true);
    expect(lines.some((line) => line.startsWith("What it says about them:"))).toBe(true);
    expect(lines.some((line) => line.startsWith("What to build on:"))).toBe(true);
    expect(lines.at(-1)).toMatch(/^No ask: /);
  });

  it("the good class of Brooke reply passes the ask gate untouched", () => {
    const body =
      "Brooke,\n\nI appreciated your note. What stayed with me was your offer to be a resource.\n\n" +
      "There's something generous about meeting someone once and already thinking about how you might be useful to them. " +
      "Given the work you do with business owners every day, I imagine that instinct comes pretty naturally to you.\n\n" +
      "I'm glad the Mastermind put us in the same room. I have a feeling our paths will cross again.\n\nTrust,\nTai";
    expect(unearnedAskInBody(body)).toBeNull();
  });
});

describe("unearnedAskInBody", () => {
  it("catches a snuck-in call, coffee, or meeting ask", () => {
    expect(unearnedAskInBody("Would you be open to a quick call next week?")).toBeTruthy();
    expect(unearnedAskInBody("I would love to grab coffee sometime.")).toBeTruthy();
    expect(unearnedAskInBody("Let me know if you want to hop on a call.")).toBeTruthy();
    expect(unearnedAskInBody("Do you have 15 minutes to talk?")).toBeTruthy();
    expect(unearnedAskInBody("Happy to set up a short meeting.")).toBeTruthy();
    expect(unearnedAskInBody("We could find time to connect in September.")).toBeTruthy();
    expect(unearnedAskInBody("Would a 15-20 minute call help?")).toBeTruthy();
  });

  it("does not flag acknowledgment, reflection, or an already-agreed plan", () => {
    expect(
      unearnedAskInBody(
        "I appreciated your note. What stayed with me was your offer to be a resource.\n\nTrust,\nTai",
      ),
    ).toBeNull();
    expect(unearnedAskInBody("See you Tuesday at ten, then.")).toBeNull();
    expect(
      unearnedAskInBody("I have a feeling our paths will cross again.\n\nTrust,\nTai"),
    ).toBeNull();
    expect(unearnedAskInBody("")).toBeNull();
  });
});

describe("assessDraftGrounding", () => {
  it("grounds a reply on a real thread plus a known identity, however sparse", () => {
    const decision = assessDraftGrounding({
      hasIdentity: true,
      threadHasInbound: true,
      priorInteractionCount: 1,
      hasReason: false,
    });
    expect(decision.grounded).toBe(true);
    expect(decision.kind).toBe("reply");
    expect(decision.missing).toEqual([]);
  });

  it("regression: Brooke's case, known identity plus a real inbound thread passes grounding", () => {
    /* Production: Brooke Siler has a real inbound Gmail thread and a known
       identity (full name and email on the relationship). The gate must
       pass; the failure lived after grounding, at the provider boundary. */
    const decision = assessDraftGrounding({
      hasIdentity: true,
      threadHasInbound: true,
      priorInteractionCount: 1,
      hasReason: true,
    });
    expect(decision).toEqual({ grounded: true, kind: "reply", missing: [] });
  });

  it("grounds a proactive note on identity, one real prior interaction, and a reason", () => {
    const decision = assessDraftGrounding({
      hasIdentity: true,
      threadHasInbound: false,
      priorInteractionCount: 1,
      hasReason: true,
    });
    expect(decision).toEqual({ grounded: true, kind: "proactive", missing: [] });
  });

  it("fails closed on a no-context proactive email and names both gaps", () => {
    const decision = assessDraftGrounding({
      hasIdentity: true,
      threadHasInbound: false,
      priorInteractionCount: 0,
      hasReason: false,
    });
    expect(decision.grounded).toBe(false);
    expect(decision.kind).toBeNull();
    expect(decision.missing).toEqual(["a real prior interaction", "a reason to write now"]);
  });

  it("never drafts for a stranger: no identity means no draft", () => {
    const decision = assessDraftGrounding({
      hasIdentity: false,
      threadHasInbound: true,
      priorInteractionCount: 5,
      hasReason: true,
    });
    expect(decision.grounded).toBe(false);
    expect(decision.missing[0]).toContain("who this person is");
  });

  it("blocks fabricated personalization: interaction without a reason is not enough", () => {
    const noReason = assessDraftGrounding({
      hasIdentity: true,
      threadHasInbound: false,
      priorInteractionCount: 3,
      hasReason: false,
    });
    expect(noReason.grounded).toBe(false);
    expect(noReason.missing).toEqual(["a reason to write now"]);

    const noHistory = assessDraftGrounding({
      hasIdentity: true,
      threadHasInbound: false,
      priorInteractionCount: 0,
      hasReason: true,
    });
    expect(noHistory.grounded).toBe(false);
    expect(noHistory.missing).toEqual(["a real prior interaction"]);
  });
});

describe("summarizeDraftGrounding", () => {
  it("never calls a reply on a real thread thin, even with nothing else", () => {
    const summary = summarizeDraftGrounding({
      kind: "reply",
      threadCount: 1,
      recordedFactCount: 0,
      openCommitmentCount: 0,
      voiceExampleCount: 0,
      hasPurpose: false,
    });
    expect(summary.level).toBe("grounded");
    expect(summary.basis[0]).toBe("Their latest message is in the thread");
    expect(summary.basis).toHaveLength(2);
    expect(summary.wouldStrengthen).toHaveLength(2);
  });

  it("marks a bare proactive note thin and names what would sharpen it", () => {
    const summary = summarizeDraftGrounding({
      kind: "proactive",
      threadCount: 0,
      recordedFactCount: 0,
      openCommitmentCount: 0,
      voiceExampleCount: 0,
      hasPurpose: true,
    });
    expect(summary.level).toBe("thin");
    expect(summary.basis).toEqual(["Your stated reason for writing"]);
    expect(summary.wouldStrengthen[0]).toContain("Record what you know about them");
  });

  it("reads strong when memory, commitments, examples, and purpose all support", () => {
    const summary = summarizeDraftGrounding({
      kind: "proactive",
      threadCount: 3,
      recordedFactCount: 2,
      openCommitmentCount: 1,
      voiceExampleCount: 2,
      hasPurpose: true,
    });
    expect(summary.level).toBe("strong");
    expect(summary.basis).toHaveLength(5);
    expect(summary.wouldStrengthen).toEqual([]);
  });

  it("round-trips through the draft rationale and refuses noise", () => {
    const summary = summarizeDraftGrounding({
      kind: "reply",
      threadCount: 4,
      recordedFactCount: 1,
      openCommitmentCount: 0,
      voiceExampleCount: 1,
      hasPurpose: false,
    });
    const rationale = writeDraftGrounding({ violations: [] }, summary);
    expect(readDraftGrounding(rationale)).toEqual(summary);
    expect(rationale["violations"]).toEqual([]);
    // A null summary leaves the rationale untouched.
    expect(writeDraftGrounding({ a: 1 }, null)).toEqual({ a: 1 });
    expect(readDraftGrounding(null)).toBeNull();
    expect(readDraftGrounding({})).toBeNull();
    expect(readDraftGrounding({ draft_grounding: { kind: "reply" } })).toBeNull();
    expect(readDraftGrounding({ draft_grounding: "noise" })).toBeNull();
  });
});

describe("threadContextForJudgment", () => {
  const message = (
    direction: "inbound" | "outbound",
    occurredAt: string,
    text: string,
    subject?: string,
  ) => ({ direction, occurredAt, bodyText: text, ...(subject ? { subject } : {}) });

  it("returns the recent slice oldest-to-newest with sides marked", () => {
    const entries = threadContextForJudgment([
      message("outbound", "2026-08-01T10:00:00Z", "First note.", "Hello"),
      message("inbound", "2026-08-02T10:00:00Z", "Their reply.", "Re: Hello"),
      message("outbound", "2026-08-03T10:00:00Z", "Our answer."),
      message("inbound", "2026-08-04T10:00:00Z", "Their latest question."),
    ]);
    expect(entries).toHaveLength(4);
    expect(entries[0]!.subject).toBe("Hello");
    expect(entries[1]!.latestForSide).toBe(false);
    expect(entries[2]!.latestForSide).toBe(true);
    expect(entries[3]!.latestForSide).toBe(true);
  });

  it("never drafts blind: an empty thread stays empty, and nothing is invented", () => {
    expect(threadContextForJudgment([])).toEqual([]);
  });

  it("bounds the window and trims long bodies without dropping short ones", () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      message(
        "inbound",
        `2026-08-${String(index + 1).padStart(2, "0")}T10:00:00Z`,
        `Note ${index}`,
      ),
    );
    const entries = threadContextForJudgment(many);
    expect(entries).toHaveLength(8);
    expect(entries[0]!.text).toBe("Note 4");

    const long = threadContextForJudgment([
      message("inbound", "2026-08-01T10:00:00Z", "x".repeat(2000)),
      message("inbound", "2026-08-02T10:00:00Z", "short"),
    ]);
    expect(long[0]!.text.length).toBeLessThanOrEqual(901);
    expect(long[0]!.text.endsWith("…")).toBe(true);
    expect(long[1]!.text).toBe("short");
  });

  it("falls back to the snippet when no full body is stored", () => {
    const entries = threadContextForJudgment([
      { direction: "inbound", occurredAt: "2026-08-01T10:00:00Z", snippet: "A snippet." },
    ]);
    expect(entries[0]!.text).toBe("A snippet.");
  });
});
