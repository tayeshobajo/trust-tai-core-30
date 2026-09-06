/**
 * A proposal is money a person actually put in front of a company, so the
 * form refuses everything it cannot honestly record.
 */

import { describe, expect, it } from "vitest";

import {
  answered,
  proposalOutcomeRefusal,
  readProposalSentForm,
  type ProposalFormCurrent,
} from "./proposal-form";

const BLANK: ProposalFormCurrent = { sentAt: null, amountCents: null, outcome: null };

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
      { sentAt: "2026-09-01T12:00:00.000Z", amountCents: 300_000, outcome: "signed" },
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
      { sentAt: "2026-09-01T12:00:00.000Z", amountCents: 300_000, outcome: "open" },
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
    };
    expect(proposalOutcomeRefusal(open, "signed")).toBeNull();
    expect(proposalOutcomeRefusal(open, "declined")).toBeNull();
  });

  it("refuses to change an answer that is already recorded", () => {
    const signed: ProposalFormCurrent = {
      sentAt: "2026-09-01T12:00:00.000Z",
      amountCents: 300_000,
      outcome: "signed",
    };
    expect(proposalOutcomeRefusal(signed, "declined")).toContain("already recorded as signed");
    expect(proposalOutcomeRefusal(signed, "signed")).toBeNull();
    expect(answered(signed)).toBe(true);
  });
});
