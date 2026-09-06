/**
 * A proposal is money a person actually put in front of a company, so the
 * form refuses everything it cannot honestly record.
 */

import { describe, expect, it } from "vitest";

import {
  answered,
  proposalOutcomeRefusal,
  readProposalOutcomeForm,
  readProposalSentForm,
  type ProposalFormCurrent,
} from "./proposal-form";

const BLANK: ProposalFormCurrent = {
  sentAt: null,
  amountCents: null,
  outcome: null,
  outcomeAt: null,
};

describe("recording that a proposal was sent", () => {
  it("keeps the day a person stated, at midday so no timezone moves it", () => {
    const result = readProposalSentForm({ amount: "3,500.50", sentOn: "2026-09-06" }, BLANK);
    expect(result).toEqual({
      ok: true,
      intent: { amountCents: 350_050, sentAt: "2026-09-06T12:00:00.000Z" },
    });
  });

  it("refuses a missing or unreadable amount rather than guessing one", () => {
    expect(readProposalSentForm({ amount: "", sentOn: "2026-09-06" }, BLANK).ok).toBe(false);
    expect(readProposalSentForm({ amount: "about 3k", sentOn: "2026-09-06" }, BLANK).ok).toBe(
      false,
    );
  });

  it("refuses a proposal for nothing", () => {
    const result = readProposalSentForm({ amount: "0", sentOn: "2026-09-06" }, BLANK);
    expect(result.ok).toBe(false);
  });

  it("refuses a missing or malformed day rather than defaulting to today", () => {
    expect(readProposalSentForm({ amount: "3500", sentOn: "" }, BLANK).ok).toBe(false);
    expect(readProposalSentForm({ amount: "3500", sentOn: "06/09/2026" }, BLANK).ok).toBe(false);
  });

  it("will not reopen a proposal that already has an answer", () => {
    const result = readProposalSentForm(
      { amount: "3500", sentOn: "2026-09-06" },
      {
        sentAt: "2026-09-01T12:00:00.000Z",
        amountCents: 300_000,
        outcome: "signed",
        outcomeAt: "2026-09-03T12:00:00.000Z",
      },
    );
    expect(result).toEqual({
      ok: false,
      because:
        "That proposal was already recorded as signed. Recording it as sent again would erase the answer.",
    });
  });

  it("lets an open proposal be corrected", () => {
    const result = readProposalSentForm(
      { amount: "4000", sentOn: "2026-09-06" },
      {
        sentAt: "2026-09-01T12:00:00.000Z",
        amountCents: 300_000,
        outcome: "open",
        outcomeAt: null,
      },
    );
    expect(result.ok).toBe(true);
  });
});

describe("recording the answer", () => {
  it("refuses an answer to a proposal that was never sent", () => {
    expect(proposalOutcomeRefusal(BLANK, "signed")).toBe(
      "A proposal has to have been sent before it can be answered.",
    );
  });

  it("allows the first answer on an open proposal", () => {
    const open: ProposalFormCurrent = {
      sentAt: "2026-09-01T12:00:00.000Z",
      amountCents: 300_000,
      outcome: "open",
      outcomeAt: null,
    };
    expect(proposalOutcomeRefusal(open, "signed")).toBeNull();
    expect(proposalOutcomeRefusal(open, "declined")).toBeNull();
  });

  it("refuses to change an answer that is already recorded", () => {
    const signed: ProposalFormCurrent = {
      sentAt: "2026-09-01T12:00:00.000Z",
      amountCents: 300_000,
      outcome: "signed",
      outcomeAt: "2026-09-03T12:00:00.000Z",
    };
    expect(proposalOutcomeRefusal(signed, "declined")).toContain("already recorded as signed");
    expect(proposalOutcomeRefusal(signed, "signed")).toBeNull();
    expect(answered(signed)).toBe(true);
  });
});

describe("recording the day the answer happened", () => {
  const OPEN: ProposalFormCurrent = {
    sentAt: "2026-08-01T12:00:00.000Z",
    amountCents: 350_000,
    outcome: "open",
    outcomeAt: null,
  };

  it("keeps the day a person stated, at midday so no timezone moves it", () => {
    expect(readProposalOutcomeForm({ answeredOn: "2026-08-14" }, OPEN, "signed")).toEqual({
      ok: true,
      intent: { outcome: "signed", at: "2026-08-14T12:00:00.000Z" },
    });
  });

  it("refuses a missing day rather than defaulting to today", () => {
    expect(readProposalOutcomeForm({ answeredOn: "" }, OPEN, "signed")).toEqual({
      ok: false,
      because: "Say the day this proposal was actually answered.",
    });
  });

  it("refuses a malformed day", () => {
    expect(readProposalOutcomeForm({ answeredOn: "14/08/2026" }, OPEN, "declined").ok).toBe(false);
    expect(readProposalOutcomeForm({ answeredOn: "2026-13-45" }, OPEN, "declined").ok).toBe(false);
  });

  it("still refuses an answer to a proposal that was never sent", () => {
    const result = readProposalOutcomeForm({ answeredOn: "2026-08-14" }, BLANK, "signed");
    expect(result).toEqual({
      ok: false,
      because: "A proposal has to have been sent before it can be answered.",
    });
  });

  it("will not change an answer that is already recorded", () => {
    const signed: ProposalFormCurrent = {
      ...OPEN,
      outcome: "signed",
      outcomeAt: "2026-08-14T12:00:00.000Z",
    };
    expect(readProposalOutcomeForm({ answeredOn: "2026-08-20" }, signed, "declined").ok).toBe(
      false,
    );
  });
});
