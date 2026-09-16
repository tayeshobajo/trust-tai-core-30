import { describe, expect, it } from "vitest";
import {
  acceptCommitment,
  assembleBrief,
  eligibleSources,
  replyOwed,
  type BriefSource,
  type Commitment,
} from "./conversation-brief";
import type { Obligation } from "./comms-obligations";

const ORG = "org-fixture-0000-0000-0000-000000000001";
const CLIENT = "fixture-client-northwind";

function source(overrides: Partial<BriefSource> = {}): BriefSource {
  return {
    sourceId: "fixture-thread-1",
    kind: "email_thread",
    clientRef: CLIENT,
    label: "Northwind Fixture Ltd (synthetic) thread",
    occurredAt: "2026-02-01T09:00:00.000Z",
    rawText: "We want the reporting live before the audit.",
    ...overrides,
  };
}

function commitment(overrides: Partial<Commitment> = {}): Commitment {
  return {
    id: "c1",
    statement: "Send the reporting outline for review.",
    state: "proposed",
    ownerLabel: null,
    groundedIn: ["fixture-thread-1"],
    ...overrides,
  };
}

describe("eligible sources", () => {
  it("reads only this client's own material", () => {
    const { eligible, rejected } = eligibleSources(CLIENT, [
      source(),
      source({ sourceId: "other", clientRef: "fixture-client-other", label: "Other client thread" }),
    ]);
    expect(eligible).toHaveLength(1);
    expect(rejected[0]).toContain("belongs to another client");
  });

  it("names an empty source rather than reading it", () => {
    const { eligible, rejected } = eligibleSources(CLIENT, [source({ rawText: "   " })]);
    expect(eligible).toHaveLength(0);
    expect(rejected[0]).toContain("nothing recorded");
  });
});

describe("assembling a brief", () => {
  const base = {
    organizationId: ORG,
    clientRef: CLIENT,
    sources: [source()],
    preparedAt: "2026-02-01T10:00:00.000Z",
  };

  it("keeps goal, facts, questions and next move that are grounded", () => {
    const brief = assembleBrief({
      ...base,
      goal: { tier: "fact", statement: "Reporting live before the audit.", groundedIn: ["fixture-thread-1"] },
      knownFacts: [{ tier: "fact", statement: "Audit is in March.", groundedIn: ["fixture-thread-1"] }],
      openQuestions: [
        { tier: "open_question", statement: "Who signs off the report format?", groundedIn: ["fixture-thread-1"] },
      ],
      nextMove: { tier: "inference", statement: "Offer a short outline call.", groundedIn: ["fixture-thread-1"] },
    });
    expect(brief.goal?.statement).toContain("Reporting live");
    expect(brief.knownFacts).toHaveLength(1);
    expect(brief.openQuestions).toHaveLength(1);
    expect(brief.nextMove).not.toBeNull();
    expect(brief.droppedBecause).toHaveLength(0);
  });

  it("drops an ungrounded line and says so", () => {
    const brief = assembleBrief({
      ...base,
      knownFacts: [{ tier: "fact", statement: "They have budget approved.", groundedIn: [] }],
    });
    expect(brief.knownFacts).toHaveLength(0);
    expect(brief.droppedBecause.join(" ")).toContain("not grounded");
  });

  it("refuses a line grounded in another client's material", () => {
    const brief = assembleBrief({
      ...base,
      sources: [source(), source({ sourceId: "other", clientRef: "fixture-client-other", label: "Other" })],
      knownFacts: [{ tier: "fact", statement: "Borrowed fact.", groundedIn: ["other"] }],
    });
    expect(brief.knownFacts).toHaveLength(0);
  });

  it("never accepts a commitment that arrives already confirmed", () => {
    const brief = assembleBrief({
      ...base,
      commitments: [commitment({ state: "confirmed" })],
    });
    expect(brief.commitments[0]?.state).toBe("proposed");
  });

  it("uses a stable key for the same sources in any order", () => {
    const a = assembleBrief({ ...base, sources: [source(), source({ sourceId: "b" })] });
    const b = assembleBrief({ ...base, sources: [source({ sourceId: "b" }), source()] });
    expect(a.key).toBe(b.key);
  });
});

describe("accepting proposed work", () => {
  const brief = assembleBrief({
    organizationId: ORG,
    clientRef: CLIENT,
    sources: [source()],
    commitments: [commitment()],
    preparedAt: "2026-02-01T10:00:00.000Z",
  });

  it("carries the wording and sources across without retyping", () => {
    const outcome = acceptCommitment({
      brief,
      commitmentId: "c1",
      by: { userId: "fixture-user-1", label: "Fixture Owner" },
      at: "2026-02-01T11:00:00.000Z",
    });
    expect(outcome.accepted).toBe(true);
    if (!outcome.accepted) return;
    expect(outcome.task.statement).toBe("Send the reporting outline for review.");
    expect(outcome.task.groundedIn).toEqual(["fixture-thread-1"]);
    expect(outcome.commitment.state).toBe("confirmed");
    expect(outcome.commitment.confirmedByLabel).toBe("Fixture Owner");
  });

  it("does not create the same task twice", () => {
    const first = acceptCommitment({
      brief,
      commitmentId: "c1",
      by: { userId: "fixture-user-1", label: "Fixture Owner" },
      at: "2026-02-01T11:00:00.000Z",
    });
    expect(first.accepted).toBe(true);
    if (!first.accepted) return;
    const second = acceptCommitment({
      brief,
      commitmentId: "c1",
      by: { userId: "fixture-user-1", label: "Fixture Owner" },
      at: "2026-02-01T11:05:00.000Z",
      existingKeys: [first.task.key],
    });
    expect(second.accepted).toBe(false);
  });

  it("refuses work that is not in the brief", () => {
    const outcome = acceptCommitment({
      brief,
      commitmentId: "nope",
      by: { userId: "fixture-user-1", label: "Fixture Owner" },
      at: "2026-02-01T11:00:00.000Z",
    });
    expect(outcome.accepted).toBe(false);
  });
});

describe("reply owed", () => {
  const ask: Obligation = {
    id: "fixture-thread-1:1",
    kind: "question",
    excerpt: "Can you send pricing?",
    anchor: { sourceId: "fixture-thread-1", start: 0, end: 22, quote: "Can you send pricing?" },
  };

  it("does not owe a reply just because mail arrived unread", () => {
    const read = replyOwed({
      theyWroteLast: true,
      unread: true,
      obligations: [],
      answeredObligationIds: [],
      evaluated: true,
    });
    expect(read.owed).toBe(false);
    expect(read.because).toContain("did not ask");
  });

  it("owes a reply when an ask is unanswered", () => {
    const read = replyOwed({
      theyWroteLast: true,
      unread: false,
      obligations: [ask],
      answeredObligationIds: [],
      evaluated: true,
    });
    expect(read.owed).toBe(true);
  });

  it("stays silent rather than guessing when nothing has been reviewed", () => {
    const read = replyOwed({
      theyWroteLast: true,
      unread: true,
      obligations: [ask],
      answeredObligationIds: [],
      evaluated: false,
    });
    expect(read.owed).toBe(false);
    expect(read.because).toContain("not been looked at");
  });

  it("clears once the ask is answered", () => {
    const read = replyOwed({
      theyWroteLast: false,
      unread: false,
      obligations: [ask],
      answeredObligationIds: [ask.id],
      evaluated: true,
    });
    expect(read.owed).toBe(false);
  });
});
