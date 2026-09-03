/**
 * The Comms drafting failure contract, pinned.
 *
 * The production failure these tests guard: every post-grounding failure used
 * to collapse into one generic message, so "no provider configured" looked
 * identical to "the provider refused" and "the reply was unreadable". The
 * boundary now throws typed DraftFailure codes, the person keeps the calm
 * sentence, the operator keeps the cause, and no draft is ever fabricated.
 */

import { describe, expect, it } from "vitest";

import {
  classifyDraftAccessError,
  DraftFailure,
  DRAFT_PREPARATION_FAILED,
  executeDraftPasses,
  type DraftPassInput,
} from "./comms-draft.server";
import {
  ProviderCallFailedError,
  ProviderNotConfiguredError,
  type RuntimeModelCaller,
} from "./intelligence-runtime.server";
import { unearnedAskInBody } from "@/domain/comms-judgment";

/* The Brooke Siler production case at contract level: a known identity and a
   real inbound thread pass the grounding gate (pinned in
   comms-judgment.test.ts); here the same case must succeed end to end when a
   configured provider returns a valid judgment and draft. */
const VALID_JUDGMENT = JSON.stringify({
  whyNow: "Brooke wrote in today; a straight answer is owed while the thread is warm.",
  latestHumanSignal: "She is deciding whether to move forward and asked directly about timing.",
  whatThisSaysAboutThem: "She is ready to act and values a clear, unhurried answer.",
  whatDeservesAcknowledgment: "Her direct question deserves a direct answer first.",
  threadToBuildOn: "What starting next month would need to be true.",
  intendedEffect: "That she feels heard and has one easy thing to say yes to.",
  responseObligation: "She asked whether we can start next month.",
  askDecision: {
    shouldAsk: true,
    whyNatural: "Her timing question genuinely requires a short live discussion.",
    what: "Offer a short call with two concrete times.",
  },
  factsAllowed: ["She asked about starting next month (latest inbound)."],
  factsAvoid: ["Do not promise a start date we have not agreed."],
  voiceEvidenceUsed: ["Short declarative sentences"],
  learnedExamplesUsed: [],
});

const VALID_DRAFT = JSON.stringify({
  subject: "Re: Starting next month",
  body: "Hi Brooke,\n\nThanks for the note. Next month works, and I would like to get the details right before we commit.\n\nWould Tuesday or Thursday morning suit you for a short call?\n\nTrust,\nTai",
});

const BROOKE_INPUT: DraftPassInput = {
  evidencePacket: {
    draftKind: "reply",
    relationshipEvidence: {
      recipient: { name: "Brooke Siler", salutationName: "Brooke" },
      thread: [{ direction: "inbound", text: "Can we start next month?" }],
    },
  },
  salutation: "Brooke",
  register: "follow_up",
  usedEvidence: [],
  groundingSummary: {
    kind: "reply",
    level: "strong",
    basis: ["A real thread, with the latest word from Brooke"],
    wouldStrengthen: [],
  },
};

/* The conversation-first Brooke case: she replied warmly, thanked Tai for his
   words about the Mastermind, said it was lovely to meet him, and offered to
   be a resource. The right judgment recognizes the generosity and asks for
   nothing, a call pushed here would be a funnel move, not a reply. */
const BROOKE_WARM_JUDGMENT = JSON.stringify({
  whyNow: "Brooke replied warmly after the Mastermind; a reply is owed while the thread is warm.",
  latestHumanSignal:
    "She offered to be a resource, meeting someone once and already thinking about how she might be useful.",
  whatThisSaysAboutThem:
    "A generous, help-first orientation, consistent with her work guiding business owners.",
  whatDeservesAcknowledgment: "The offer to be a resource, and the generosity underneath it.",
  threadToBuildOn: "Her instinct to be useful and the work it comes from.",
  intendedEffect:
    "That she feels specifically seen and glad the Mastermind put them in the same room.",
  responseObligation: "Her thanks and kind words deserve acknowledgment.",
  askDecision: {
    shouldAsk: false,
    whyNatural:
      "She gave warmth and an open door; nothing in her note suggests talking soon, so an ask would feel like a funnel move.",
    what: "",
  },
  factsAllowed: ["She offered to be a resource (latest inbound)."],
  factsAvoid: ["Do not claim a shared history beyond the Mastermind."],
  voiceEvidenceUsed: ["Make them feel specifically seen", "No forced call to action"],
  learnedExamplesUsed: [],
});

const BROOKE_WARM_DRAFT = JSON.stringify({
  subject: "Re: The Mastermind",
  body: "Brooke,\n\nI appreciated your note. What stayed with me was your offer to be a resource.\n\nThere's something generous about meeting someone once and already thinking about how you might be useful to them. Given the work you do with business owners every day, I imagine that instinct comes pretty naturally to you.\n\nI'm glad the Mastermind put us in the same room. I have a feeling our paths will cross again.\n\nTrust,\nTai",
});

const BROOKE_WARM_INPUT: DraftPassInput = {
  evidencePacket: {
    draftKind: "reply",
    relationshipEvidence: {
      recipient: { name: "Brooke Siler", salutationName: "Brooke" },
      thread: [
        {
          direction: "inbound",
          text: "Tai, thank you for your kind words. It was lovely to meet you, and I enjoyed your perspective in the Mastermind. Please consider me a resource.",
        },
      ],
    },
  },
  salutation: "Brooke",
  register: "follow_up",
  usedEvidence: [],
  groundingSummary: {
    kind: "reply",
    level: "grounded",
    basis: ["A real thread, with the latest word from Brooke"],
    wouldStrengthen: [],
  },
};

/** A configured fake provider answering each pass in order. */
function callerReturning(...raws: string[]): RuntimeModelCaller {
  let index = 0;
  return async () => ({
    raw: raws[Math.min(index++, raws.length - 1)] ?? "",
    provider: "test",
    model: "test-model",
  });
}

function callerThrowing(error: Error): RuntimeModelCaller {
  return async () => {
    throw error;
  };
}

async function failureCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DraftFailure);
    return (error as DraftFailure).code;
  }
  throw new Error("expected the draft to fail");
}

describe("executeDraftPasses", () => {
  it("Brooke's case succeeds with a configured provider returning valid judgment and draft", async () => {
    const result = await executeDraftPasses(callerReturning(VALID_JUDGMENT, VALID_DRAFT), {
      ...BROOKE_INPUT,
    });
    expect(result.subject).toBe("Re: Starting next month");
    expect(result.body).toContain("Hi Brooke,");
    expect(result.body).toMatch(/Trust,\s*\n\s*Tai/);
    expect(result.judgment.responseObligation).toContain("start next month");
    expect(result.grounding.level).toBe("strong");
    expect(result.provider).toBe("test");
    expect(result.model).toBe("test-model");
  });

  it("pins both passes to a strict json_schema response format", async () => {
    const seen: { type?: unknown }[] = [];
    const spy: RuntimeModelCaller = async (request) => {
      seen.push({ type: (request.responseFormat as { type?: string } | undefined)?.type });
      return {
        raw: seen.length === 1 ? VALID_JUDGMENT : VALID_DRAFT,
        provider: "test",
        model: "test-model",
      };
    };
    await executeDraftPasses(spy, { ...BROOKE_INPUT });
    expect(seen).toEqual([{ type: "json_schema" }, { type: "json_schema" }]);
  });

  it("Brooke's warm reply: a no-ask judgment produces a no-ask draft without a rewrite", async () => {
    let calls = 0;
    const spy: RuntimeModelCaller = async () => {
      calls += 1;
      return {
        raw: calls === 1 ? BROOKE_WARM_JUDGMENT : BROOKE_WARM_DRAFT,
        provider: "test",
        model: "test-model",
      };
    };
    const result = await executeDraftPasses(spy, { ...BROOKE_WARM_INPUT });
    expect(calls).toBe(2);
    expect(result.judgment.askDecision.shouldAsk).toBe(false);
    expect(result.judgment.askDecision.whyNatural).toContain("nothing in her note");
    expect(result.judgment.whatDeservesAcknowledgment).toContain("resource");
    expect(result.body).toContain("offer to be a resource");
    expect(unearnedAskInBody(result.body)).toBeNull();
    expect(result.body).toMatch(/Trust,\s*\n\s*Tai/);
  });

  it("earned CTA: an explicit 'let's find time to talk' passes with the ask intact", async () => {
    const earnedJudgment = JSON.stringify({
      ...JSON.parse(BROOKE_WARM_JUDGMENT),
      latestHumanSignal: "She said plainly: let's find time to talk.",
      askDecision: {
        shouldAsk: true,
        whyNatural: "She explicitly suggested talking.",
        what: "Offer two concrete times for a call.",
      },
    });
    const earnedDraft = JSON.stringify({
      subject: "Re: Finding time",
      body: "Hi Brooke,\n\nI'd like that too. Would Tuesday or Thursday morning suit you for a short call?\n\nTrust,\nTai",
    });
    let calls = 0;
    const spy: RuntimeModelCaller = async () => {
      calls += 1;
      return {
        raw: calls === 1 ? earnedJudgment : earnedDraft,
        provider: "test",
        model: "test-model",
      };
    };
    const result = await executeDraftPasses(spy, { ...BROOKE_WARM_INPUT });
    expect(calls).toBe(2); // no rewrite: the ask is earned
    expect(result.judgment.askDecision.shouldAsk).toBe(true);
    expect(result.body).toContain("short call");
  });

  it("earned CTA: a question requiring discussion earns an ask", async () => {
    const questionJudgment = JSON.stringify({
      ...JSON.parse(BROOKE_WARM_JUDGMENT),
      responseObligation: "She asked how the engagement would work for her team.",
      askDecision: {
        shouldAsk: true,
        whyNatural: "Her question about how it would work genuinely needs discussion.",
        what: "Offer a short call to walk through it.",
      },
    });
    const questionDraft = JSON.stringify({
      subject: "Re: How it would work",
      body: "Hi Brooke,\n\nGood question, and it deserves a real answer rather than a paragraph. Would one of Tuesday or Thursday morning work for a short call?\n\nTrust,\nTai",
    });
    let calls = 0;
    const spy: RuntimeModelCaller = async () => {
      calls += 1;
      return {
        raw: calls === 1 ? questionJudgment : questionDraft,
        provider: "test",
        model: "test-model",
      };
    };
    const result = await executeDraftPasses(spy, { ...BROOKE_WARM_INPUT });
    expect(calls).toBe(2);
    expect(result.judgment.askDecision.shouldAsk).toBe(true);
  });

  it("rewrites once when the writing pass sneaks an ask into a no-ask judgment", async () => {
    const sneakyDraft = JSON.stringify({
      subject: "Re: The Mastermind",
      body: "Brooke,\n\nI appreciated your note. Would you be open to a quick call next week to stay connected?\n\nTrust,\nTai",
    });
    const seen: string[] = [];
    const spy: RuntimeModelCaller = async (request) => {
      seen.push(request.instructions);
      return {
        raw:
          seen.length === 1
            ? BROOKE_WARM_JUDGMENT
            : seen.length === 2
              ? sneakyDraft
              : BROOKE_WARM_DRAFT,
        provider: "test",
        model: "test-model",
      };
    };
    const result = await executeDraftPasses(spy, { ...BROOKE_WARM_INPUT });
    expect(seen).toHaveLength(3); // judgment, write, corrective rewrite
    expect(seen[2]).toContain("judgment decided NO ask belongs");
    expect(unearnedAskInBody(result.body)).toBeNull();
    expect(result.body).toContain("offer to be a resource");
  });

  it("types a writing pass that keeps sneaking asks as ask_gate_violated", async () => {
    const sneakyDraft = JSON.stringify({
      subject: "Re: The Mastermind",
      body: "Brooke,\n\nLovely note. Would you be open to a quick call next week?\n\nTrust,\nTai",
    });
    const code = await failureCode(
      executeDraftPasses(callerReturning(BROOKE_WARM_JUDGMENT, sneakyDraft), {
        ...BROOKE_WARM_INPUT,
      }),
    );
    expect(code).toBe("ask_gate_violated");
  });

  it("types a missing provider as provider_not_configured", async () => {
    const code = await failureCode(
      executeDraftPasses(callerThrowing(new ProviderNotConfiguredError()), {
        ...BROOKE_INPUT,
      }),
    );
    expect(code).toBe("provider_not_configured");
  });

  it("types a provider refusal as provider_call_failed", async () => {
    const code = await failureCode(
      executeDraftPasses(callerThrowing(new ProviderCallFailedError("refused", 400)), {
        ...BROOKE_INPUT,
      }),
    );
    expect(code).toBe("provider_call_failed");
  });

  it("types an unknown transport error as provider_call_failed", async () => {
    const code = await failureCode(
      executeDraftPasses(callerThrowing(new Error("socket hangup")), { ...BROOKE_INPUT }),
    );
    expect(code).toBe("provider_call_failed");
  });

  it("types an unreadable judgment as judgment_unreadable", async () => {
    const code = await failureCode(
      executeDraftPasses(callerReturning("no json here at all"), { ...BROOKE_INPUT }),
    );
    expect(code).toBe("judgment_unreadable");
  });

  it("types an unreadable written draft as writing_unreadable", async () => {
    const code = await failureCode(
      executeDraftPasses(callerReturning(VALID_JUDGMENT, "still no json"), { ...BROOKE_INPUT }),
    );
    expect(code).toBe("writing_unreadable");
  });

  it("types a blank subject or body as empty_draft", async () => {
    const code = await failureCode(
      executeDraftPasses(
        callerReturning(VALID_JUDGMENT, JSON.stringify({ subject: "", body: "  " })),
        { ...BROOKE_INPUT },
      ),
    );
    expect(code).toBe("empty_draft");
  });
});

describe("DraftFailure", () => {
  it("keeps the calm person-facing sentence by default", () => {
    const failure = new DraftFailure("provider_call_failed");
    expect(failure.message).toBe(DRAFT_PREPARATION_FAILED);
    expect(failure.code).toBe("provider_call_failed");
  });
});

describe("classifyDraftAccessError", () => {
  it("maps the runtime boundary's bare forbidden to access_denied", () => {
    const failure = classifyDraftAccessError(new Error("forbidden"));
    expect(failure).toBeInstanceOf(DraftFailure);
    expect(failure?.code).toBe("access_denied");
  });

  it("leaves every other error alone", () => {
    expect(classifyDraftAccessError(new Error("boom"))).toBeNull();
    expect(classifyDraftAccessError("forbidden")).toBeNull();
  });
});
