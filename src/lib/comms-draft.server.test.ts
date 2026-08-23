/**
 * The Comms drafting failure contract, pinned.
 *
 * The production failure these tests guard: every post-grounding failure used
 * to collapse into one generic message, so "no provider configured" looked
 * identical to "the provider refused" and "the reply was unreadable". The
 * boundary now throws typed DraftFailure codes — the person keeps the calm
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

/* The Brooke Siler production case at contract level: a known identity and a
   real inbound thread pass the grounding gate (pinned in
   comms-judgment.test.ts); here the same case must succeed end to end when a
   configured provider returns a valid judgment and draft. */
const VALID_JUDGMENT = JSON.stringify({
  whyNow: "Brooke wrote in today; a straight answer is owed while the thread is warm.",
  whatNoticed: "She is deciding whether to move forward and wants a clear next step.",
  intendedEffect: "That she feels heard and has one easy thing to say yes to.",
  responseObligation: "She asked whether we can start next month.",
  nextMove: { ask: true, what: "Offer a short call with two concrete times." },
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
