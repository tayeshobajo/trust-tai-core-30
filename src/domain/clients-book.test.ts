import { describe, expect, it } from "vitest";

import {
  clientsHeadline,
  deriveClientCard,
  filterClientCards,
  initialsOfCompany,
  sortClientCards,
  validateNewClient,
  viewCounts,
  type ClientBookInput,
} from "./clients-book";

const NOW = new Date("2026-09-03T12:00:00.000Z");

function client(overrides: Partial<ClientBookInput> = {}): ClientBookInput {
  return {
    id: overrides.id ?? "client-1",
    name: overrides.name ?? "Northlight Systems",
    tier: overrides.tier ?? "run",
    mrrCents: overrides.mrrCents ?? 350_000,
    renewalAt: overrides.renewalAt ?? null,
    nextReviewAt: overrides.nextReviewAt ?? null,
    ...overrides,
  };
}

describe("a client card states tier, value, review and delivery", () => {
  it("reads a Run client as recurring monthly value", () => {
    const card = deriveClientCard(client({ nextReviewAt: "2026-09-19T00:00:00.000Z" }), NOW);
    expect(card.commercialLine).toBe("Run · $3,500/mo");
    expect(card.reviewLine).toBe("Next review Sep 19");
    expect(card.warnings).toEqual([]);
    expect(card.needsAttention).toBe(false);
  });

  it("never invents a value that was not recorded", () => {
    const card = deriveClientCard(client({ tier: "diagnose", mrrCents: null }), NOW);
    expect(card.commercialLine).toBe("Diagnose · value not recorded");
    expect(card.reviewLine).toBe("No review scheduled");
  });

  it("carries the delivery line Projects owns, and warns when it is blocked", () => {
    const card = deriveClientCard(
      client({ delivery: { line: "Checkout rebuild is blocked: waiting on API keys", blocked: true } }),
      NOW,
    );
    expect(card.deliveryLine).toBe("Checkout rebuild is blocked: waiting on API keys");
    expect(card.warnings).toContain("Delivery blocked");
  });
});

describe("warnings are exceptions, not decoration", () => {
  it("flags an overdue review", () => {
    const card = deriveClientCard(client({ nextReviewAt: "2026-08-20T00:00:00.000Z" }), NOW);
    expect(card.warnings).toEqual(["Review overdue since Aug 20"]);
    expect(card.needsAttention).toBe(true);
  });

  it("flags a near renewal with no review booked", () => {
    const card = deriveClientCard(client({ renewalAt: "2026-09-20T00:00:00.000Z" }), NOW);
    expect(card.warnings).toEqual(["Renews in 16 days with no review booked"]);
  });

  it("stays quiet when the renewal already has a review in front of it", () => {
    const card = deriveClientCard(
      client({ renewalAt: "2026-09-20T00:00:00.000Z", nextReviewAt: "2026-09-10T00:00:00.000Z" }),
      NOW,
    );
    expect(card.warnings).toEqual([]);
  });
});

describe("a proposed company is not a client", () => {
  const proposed = deriveClientCard(
    client({
      id: "client-2",
      name: "Ridgeway Foods",
      tier: null,
      mrrCents: null,
      proposal: { amountCents: 1_200_000, sentAt: "2026-09-01T00:00:00.000Z", tier: "build", open: true },
    }),
    NOW,
  );

  it("is marked as proposed and carries no recurring value", () => {
    expect(proposed.kind).toBe("proposed");
    expect(proposed.commercialLine).toBe("Proposed · Build · $12,000");
    expect(proposed.proposalNote).toBe("Sent 2 days ago · your decision");
  });

  it("is never counted as an active client", () => {
    const counts = viewCounts([deriveClientCard(client(), NOW), proposed]);
    expect(counts.all).toBe(1);
    expect(counts.run).toBe(1);
    expect(counts.proposed).toBe(1);
    expect(filterClientCards([proposed], "run")).toEqual([]);
  });
});

describe("the order is stable and puts exceptions first", () => {
  it("sorts attention, then the soonest obligation, then the name", () => {
    const cards = sortClientCards([
      deriveClientCard(client({ id: "c", name: "Calm Co", nextReviewAt: "2026-10-01T00:00:00.000Z" }), NOW),
      deriveClientCard(
        client({ id: "p", name: "Proposed Co", tier: null, mrrCents: null, proposal: { amountCents: null, sentAt: null, tier: null, open: true } }),
        NOW,
      ),
      deriveClientCard(client({ id: "a", name: "Aging Co", nextReviewAt: "2026-08-01T00:00:00.000Z" }), NOW),
      deriveClientCard(client({ id: "s", name: "Soon Co", nextReviewAt: "2026-09-06T00:00:00.000Z" }), NOW),
    ]);
    expect(cards.map((card) => card.id)).toEqual(["a", "s", "c", "p"]);
  });
});

describe("the headline counts real things", () => {
  it("counts Run clients, reviews due and proposals awaiting a decision", () => {
    const headline = clientsHeadline(
      [
        deriveClientCard(client({ id: "1", nextReviewAt: "2026-09-05T00:00:00.000Z" }), NOW),
        deriveClientCard(client({ id: "2", name: "Beta", nextReviewAt: "2026-08-01T00:00:00.000Z" }), NOW),
        deriveClientCard(client({ id: "3", name: "Gamma", tier: "build", mrrCents: null }), NOW),
        deriveClientCard(
          client({ id: "4", name: "Delta", tier: null, mrrCents: null, proposal: { amountCents: 500_000, sentAt: "2026-09-02T00:00:00.000Z", tier: null, open: true } }),
          NOW,
        ),
      ],
      NOW,
    );
    expect(headline.runClients).toBe(2);
    expect(headline.reviewsDue).toBe(2);
    expect(headline.proposalsAwaiting).toBe(1);
    expect(headline.sentence).toBe("2 Run clients · 2 reviews due · 1 proposal awaiting your decision");
  });
});

describe("initials stand in for a logo without inventing an image", () => {
  it("uses the first and last words of the company name", () => {
    expect(initialsOfCompany("Northlight Systems")).toBe("NS");
    expect(initialsOfCompany("Ridgeway")).toBe("RI");
  });
});

describe("manual creation refuses to guess money", () => {
  it("requires a name", () => {
    expect(validateNewClient({ name: "  ", tier: "run" })).toContain("A client needs a company name.");
  });

  it("keeps recurring value to Run only", () => {
    expect(validateNewClient({ name: "Acme", tier: "diagnose", mrrCents: 100_000 })).toContain(
      "Only a Run client carries a recurring monthly value.",
    );
  });

  it("requires the agreed phase amount when a client starts in Build", () => {
    expect(validateNewClient({ name: "Acme", tier: "build" })).toContain(
      "Creating a client in Build needs the phase amount that was agreed.",
    );
    expect(validateNewClient({ name: "Acme", tier: "build", buildPhaseAmountCents: 900_000 })).toEqual([]);
  });
});
