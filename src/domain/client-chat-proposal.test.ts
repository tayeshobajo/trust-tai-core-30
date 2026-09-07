import { describe, expect, it } from "vitest";

import {
  CLIENT_CHAT_ACTIONS,
  clientProposalAlreadyApplied,
  clientProposalReceipt,
  clientProposalStale,
  prepareClientProposal,
  type ClientCommercialNow,
} from "./client-chat-proposal";

const now: ClientCommercialNow = {
  mrrCents: 350000,
  renewalAt: "2026-08-01",
  nextReviewAt: "2026-09-15",
};

describe("prepareClientProposal", () => {
  it("bounds itself to three account-owned commercial fields", () => {
    expect(CLIENT_CHAT_ACTIONS).toEqual(["mrr", "renewal_date", "next_review_date"]);
  });

  it("prepares a monthly amount without writing anything", () => {
    const result = prepareClientProposal(
      now,
      { action: "mrr", value: "4000", reason: "Signed the uplift today" },
      "put them on 4000 a month",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.store).toBe("clients.mrr_cents");
    expect(result.proposal.currentValue).toBe("$3,500/mo");
    expect(result.proposal.proposedValue).toBe("$4,000/mo");
    expect(result.proposal.patch).toEqual({
      mrrCents: 400000,
      because: "Signed the uplift today",
    });
  });

  it("refuses a change with no reason, so provenance is never empty", () => {
    const result = prepareClientProposal(now, { action: "mrr", value: "4000" }, "4000");
    expect(result.ok).toBe(false);
  });

  it("refuses an unsupported action", () => {
    const result = prepareClientProposal(
      now,
      { action: "tier" as never, value: "build", reason: "moving them up" },
      "move to build",
    );
    expect(result.ok).toBe(false);
  });

  it("refuses a value the record already says", () => {
    const result = prepareClientProposal(
      now,
      { action: "renewal_date", value: "2026-08-01", reason: "confirming" },
      "renewal is 1 August",
    );
    expect(result.ok).toBe(false);
  });

  it("refuses a date that is not a real day", () => {
    const result = prepareClientProposal(
      now,
      { action: "next_review_date", value: "next tuesday", reason: "booked it" },
      "review next tuesday",
    );
    expect(result.ok).toBe(false);
  });
});

describe("clientProposalStale", () => {
  const prepared = prepareClientProposal(
    now,
    { action: "mrr", value: "4000", reason: "Signed the uplift" },
    "4000 a month",
  );
  const proposal = prepared.ok ? prepared.proposal : null;

  it("holds while the record still says what it said", () => {
    expect(clientProposalStale(proposal!, now)).toBeNull();
  });

  it("refuses once the record has moved underneath it", () => {
    expect(clientProposalStale(proposal!, { ...now, mrrCents: 500000 })).toContain(
      "nothing was written",
    );
  });

  it("says nothing is written twice when it already says the proposed value", () => {
    expect(clientProposalAlreadyApplied(proposal!, { ...now, mrrCents: 400000 })).toBe(true);
    expect(clientProposalReceipt(proposal!)).toContain("$4,000/mo");
  });
});
