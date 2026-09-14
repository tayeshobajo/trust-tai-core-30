/**
 * Adversarial tests for answer checking.
 *
 * Each case here is one way a review could claim an obligation is handled
 * when it is not. The rule being proved throughout: uncertain stays
 * uncertain, and only a quote that really exists in the draft and really
 * answers the ask may clear it.
 */

import { describe, expect, it } from "vitest";

import {
  isRestatement,
  lexicalHint,
  locateQuote,
  obligationsFromSource,
  summarizeObligations,
  verifyObligationVerdicts,
  type Obligation,
} from "./comms-obligations";

function obligation(id: string, excerpt: string): Obligation {
  return {
    id,
    kind: "question",
    excerpt,
    anchor: { sourceId: "src-1", start: 0, end: excerpt.length, quote: excerpt },
  };
}

describe("obligation extraction", () => {
  it("finds a question that only appears late in a long source", () => {
    const padding = "Thanks for the update on the build. ".repeat(40);
    const text = `${padding}Can you confirm the launch date?`;
    const found = obligationsFromSource({ sourceId: "src-1", text });
    const late = found.at(-1);
    expect(late?.excerpt).toContain("confirm the launch date");
    expect(late?.anchor.start).toBeGreaterThan(900);
    expect(text.slice(late!.anchor.start, late!.anchor.end)).toContain("launch date");
  });

  it("treats several asks in one sentence as the obligations they are", () => {
    const text = "Could you send the invoice and confirm whether the training is included?";
    const found = obligationsFromSource({ sourceId: "src-1", text });
    expect(found.length).toBeGreaterThanOrEqual(1);
    // Whatever the sentence split, the ask text carries both requests.
    expect(found.map((item) => item.excerpt).join(" ")).toContain("invoice");
    expect(found.map((item) => item.excerpt).join(" ")).toContain("training");
  });

  it("finds nothing in a source with no ask in it", () => {
    const found = obligationsFromSource({
      sourceId: "src-1",
      text: "Just wanted to say the session was genuinely useful. No reply needed.",
    });
    expect(found).toHaveLength(0);
  });
});

describe("quote anchoring", () => {
  it("honours a correct claimed offset and repairs a wrong one", () => {
    const draft = "Hello Megan.\n\nThe invoice goes out on Tuesday.";
    const at = draft.indexOf("The invoice");
    expect(locateQuote(draft, "The invoice goes out on Tuesday.", at)?.start).toBe(at);
    expect(locateQuote(draft, "The invoice goes out on Tuesday.", 0)?.start).toBe(at);
  });

  it("tolerates reflowed whitespace in a quote", () => {
    const draft = "The invoice goes out\non Tuesday.";
    const located = locateQuote(draft, "The invoice goes out on Tuesday.");
    expect(located).not.toBeNull();
    expect(draft.slice(located!.start, located!.end)).toContain("Tuesday");
  });

  it("refuses a quote that is not in the text", () => {
    expect(locateQuote("The invoice goes out on Tuesday.", "We will refund you.")).toBeNull();
  });
});

describe("verifying a semantic pass", () => {
  const draftAnswered =
    "Megan,\n\nThe migration finishes on 4 October and the invoice follows the same week.\n\nTrust,\nSam";

  it("accepts a paraphrased answer that is really in the draft", () => {
    const asks = [obligation("o1", "When will the migration be finished?")];
    const [verdict] = verifyObligationVerdicts({
      obligations: asks,
      draftText: draftAnswered,
      versionId: "v1",
      raw: [
        {
          obligationId: "o1",
          status: "answered",
          answerQuote: "The migration finishes on 4 October",
          because: "The draft gives the completion date directly.",
          confidence: "high",
        },
      ],
    });
    expect(verdict?.status).toBe("answered");
    expect(verdict?.answer?.versionId).toBe("v1");
    expect(
      draftAnswered.slice(verdict!.answer!.start, verdict!.answer!.end),
    ).toBe("The migration finishes on 4 October");
  });

  it("refuses an answer the draft does not contain", () => {
    const [verdict] = verifyObligationVerdicts({
      obligations: [obligation("o1", "When will the migration be finished?")],
      draftText: draftAnswered,
      versionId: "v1",
      raw: [
        {
          obligationId: "o1",
          status: "answered",
          answerQuote: "It will be done by the end of September.",
          because: "Claimed, but invented.",
        },
      ],
    });
    expect(verdict?.status).toBe("uncertain");
    expect(verdict?.rejected).toContain("not in this draft");
  });

  it("refuses a draft that merely repeats the question", () => {
    const draft = "Megan,\n\nYou asked when the migration will be finished. \n\nTrust,\nSam";
    const [verdict] = verifyObligationVerdicts({
      obligations: [obligation("o1", "When will the migration be finished?")],
      draftText: draft,
      versionId: "v1",
      raw: [
        {
          obligationId: "o1",
          status: "answered",
          answerQuote: "You asked when the migration will be finished.",
          because: "It mentions the migration.",
        },
      ],
    });
    expect(verdict?.status).toBe("uncertain");
    expect(verdict?.rejected).toContain("restates the ask");
  });

  it("does not let unrelated keyword overlap count as an answer", () => {
    const draft = "Megan,\n\nThe migration team enjoyed the workshop.\n\nTrust,\nSam";
    const obligations = [obligation("o1", "When will the migration be finished?")];
    // The lexical heuristic is happy here. It is a hint, and it is not consulted.
    expect(lexicalHint(obligations[0]!, draft).lexicalCandidate).toBeDefined();
    const [verdict] = verifyObligationVerdicts({
      obligations,
      draftText: draft,
      versionId: "v1",
      raw: [{ obligationId: "o1", status: "missing", because: "No date is given." }],
    });
    expect(verdict?.status).toBe("missing");
  });

  it("marks an ask the review never mentioned as uncertain, not answered", () => {
    const verdicts = verifyObligationVerdicts({
      obligations: [obligation("o1", "What is the price?"), obligation("o2", "Who owns hosting?")],
      draftText: draftAnswered,
      versionId: "v1",
      raw: [{ obligationId: "o1", status: "missing", because: "No price is stated." }],
    });
    expect(verdicts[1]?.status).toBe("uncertain");
    expect(verdicts[1]?.because).toContain("still open");
  });

  it("drops a verdict for an obligation that was never issued", () => {
    const verdicts = verifyObligationVerdicts({
      obligations: [obligation("o1", "What is the price?")],
      draftText: draftAnswered,
      versionId: "v1",
      raw: [
        { obligationId: "ghost", status: "answered", answerQuote: "The migration finishes" },
        { obligationId: "o1", status: "missing", because: "No price is stated." },
      ],
    });
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]?.status).toBe("missing");
  });

  it("keeps a pending promise on one ask from clearing another", () => {
    const draft =
      "Megan,\n\nI will confirm the launch date once the migration scope is agreed. The invoice total is 4,200.\n\nTrust,\nSam";
    const verdicts = verifyObligationVerdicts({
      obligations: [
        obligation("o1", "When is the launch date?"),
        obligation("o2", "What is the invoice total?"),
        obligation("o3", "Who signs off the content?"),
      ],
      draftText: draft,
      versionId: "v1",
      raw: [
        {
          obligationId: "o1",
          status: "pending_confirmation",
          answerQuote: "I will confirm the launch date once the migration scope is agreed.",
          because: "A dependency is named instead of a date.",
        },
        {
          obligationId: "o2",
          status: "answered",
          answerQuote: "The invoice total is 4,200.",
          because: "The total is stated.",
        },
        { obligationId: "o3", status: "missing", because: "Sign-off is not addressed." },
      ],
    });
    const summary = summarizeObligations(verdicts);
    expect(verdicts.map((v) => v.status)).toEqual([
      "pending_confirmation",
      "answered",
      "missing",
    ]);
    expect(summary.complete).toBe(false);
    expect(summary.settled).toBe(false);
    expect(summary.answered).toBe(1);
  });

  it("reports nothing settled when every ask is uncertain", () => {
    const summary = summarizeObligations(
      verifyObligationVerdicts({
        obligations: [obligation("o1", "What is the price?")],
        draftText: draftAnswered,
        versionId: "v1",
        raw: [],
      }),
    );
    expect(summary.uncertain).toBe(1);
    expect(summary.complete).toBe(false);
    expect(summary.note).toContain("stays open");
  });
});

describe("restatement detection", () => {
  it("knows an echo from a reply", () => {
    expect(isRestatement("When will the migration be finished?", "When will the migration be finished?")).toBe(true);
    expect(isRestatement("When will the migration be finished?", "The migration finishes on 4 October.")).toBe(false);
  });
});

describe("a source that asked nothing", () => {
  it("is covered by definition, and still says no ask was found", () => {
    const summary = summarizeObligations([]);
    expect(summary.complete).toBe(true);
    expect(summary.answered).toBe(0);
    expect(summary.note).toMatch(/No questions or requests were found/i);
  });
});
