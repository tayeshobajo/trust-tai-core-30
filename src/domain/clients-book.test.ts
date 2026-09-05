import { describe, expect, it } from "vitest";

import {
  clientsHeadline,
  deriveClientCard,
  filterClientCards,
  formatDay,
  initialsOfCompany,
  proposedCards,
  sortClientCards,
  validateNewClient,
  viewCounts,
  type ClientBookInput,
} from "./clients-book";

/* Noon UTC on 3 September 2026 is 07:00 in Chicago, the same calendar day. */
const NOW = new Date("2026-09-03T12:00:00.000Z");
const CHICAGO = "America/Chicago";

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
    const card = deriveClientCard(
      client({ nextReviewAt: "2026-09-19T05:00:00.000Z" }),
      NOW,
      CHICAGO,
    );
    expect(card.commercialLine).toBe("Run · $3,500/mo");
    expect(card.reviewLine).toBe("Next review Sep 19");
    expect(card.warnings).toEqual([]);
    expect(card.needsAttention).toBe(false);
  });

  it("never invents a value that was not recorded", () => {
    const card = deriveClientCard(client({ tier: "diagnose", mrrCents: null }), NOW, CHICAGO);
    expect(card.commercialLine).toBe("Diagnose · value not recorded");
    expect(card.reviewLine).toBe("No review scheduled");
  });

  it("carries the delivery line Projects owns, and warns when it is blocked", () => {
    const card = deriveClientCard(
      client({
        delivery: { line: "Checkout rebuild is blocked: waiting on API keys", blocked: true },
      }),
      NOW,
      CHICAGO,
    );
    expect(card.deliveryLine).toBe("Checkout rebuild is blocked: waiting on API keys");
    expect(card.warnings).toContain("Delivery blocked");
  });

  it("keeps the real logo and website when a person recorded them", () => {
    const card = deriveClientCard(
      client({
        logoUrl: " https://cdn.example.com/n.png ",
        websiteUrl: "https://northlight.example",
      }),
      NOW,
      CHICAGO,
    );
    expect(card.logoUrl).toBe("https://cdn.example.com/n.png");
    expect(card.websiteUrl).toBe("https://northlight.example");
    expect(deriveClientCard(client(), NOW, CHICAGO).logoUrl).toBeNull();
  });
});

describe("every day is a day in the organization's timezone", () => {
  it("shows the calendar day Chicago sees, not the UTC one", () => {
    // 04:00 UTC on the 20th is still the evening of the 19th in Chicago.
    expect(formatDay("2026-09-20T04:00:00.000Z", CHICAGO)).toBe("Sep 19");
    expect(formatDay("2026-09-20T04:00:00.000Z", "UTC")).toBe("Sep 20");
  });

  it("does not call a review overdue on the day it is due", () => {
    // Stored as Chicago midnight on the 3rd; now is 07:00 Chicago on the 3rd.
    const card = deriveClientCard(
      client({ nextReviewAt: "2026-09-03T05:00:00.000Z" }),
      NOW,
      CHICAGO,
    );
    expect(card.reviewLine).toBe("Next review Sep 3");
    expect(card.warnings).toEqual([]);
  });

  it("counts renewal days as sleeps, not as 24-hour blocks", () => {
    // Renewal stored as Chicago midnight on the 20th. 07:00 on the 3rd to the
    // 20th is 17 calendar days, even though it is 16.7 days of hours.
    const card = deriveClientCard(client({ renewalAt: "2026-09-20T05:00:00.000Z" }), NOW, CHICAGO);
    expect(card.warnings).toEqual(["Renews in 17 days with no review booked"]);
  });
});

describe("warnings are exceptions, not decoration", () => {
  it("flags an overdue review", () => {
    const card = deriveClientCard(
      client({ nextReviewAt: "2026-08-20T05:00:00.000Z" }),
      NOW,
      CHICAGO,
    );
    expect(card.warnings).toEqual(["Review overdue since Aug 20"]);
    expect(card.needsAttention).toBe(true);
  });

  it("stays quiet when the renewal already has a review in front of it", () => {
    const card = deriveClientCard(
      client({ renewalAt: "2026-09-20T05:00:00.000Z", nextReviewAt: "2026-09-10T05:00:00.000Z" }),
      NOW,
      CHICAGO,
    );
    expect(card.warnings).toEqual([]);
  });

  it("says so plainly when the renewal is today", () => {
    const card = deriveClientCard(client({ renewalAt: "2026-09-03T05:00:00.000Z" }), NOW, CHICAGO);
    expect(card.warnings).toEqual(["Renews today with no review booked"]);
  });
});

describe("a proposed company is not a client", () => {
  const proposed = deriveClientCard(
    client({
      id: "client-2",
      name: "Ridgeway Foods",
      tier: null,
      mrrCents: null,
      proposal: {
        amountCents: 1_200_000,
        sentAt: "2026-09-01T12:00:00.000Z",
        tier: "build",
        open: true,
      },
    }),
    NOW,
    CHICAGO,
  );

  it("is marked as proposed and carries no recurring value", () => {
    expect(proposed.kind).toBe("proposed");
    expect(proposed.commercialLine).toBe("Proposed · Build · $12,000");
    expect(proposed.proposalNote).toBe("Sent 2 days ago · your decision");
  });

  it("is never counted as an active client, and never sits in an active view", () => {
    const counts = viewCounts([deriveClientCard(client(), NOW, CHICAGO), proposed]);
    expect(counts).toEqual({ all: 1, run: 1, build: 0, diagnose: 0 });
    expect(filterClientCards([proposed], "all")).toEqual([]);
    expect(filterClientCards([proposed], "run")).toEqual([]);
    expect(proposedCards([proposed])).toEqual([proposed]);
  });
});

describe("search is local, by company name, and applies to both sections", () => {
  const active = deriveClientCard(client(), NOW, CHICAGO);
  const other = deriveClientCard(client({ id: "o", name: "Orchard Labs" }), NOW, CHICAGO);
  const proposed = deriveClientCard(
    client({
      id: "p",
      name: "North Ridge Foods",
      tier: null,
      mrrCents: null,
      proposal: { amountCents: null, sentAt: null, tier: null, open: true },
    }),
    NOW,
    CHICAGO,
  );

  it("matches on the name only, ignoring case and spacing", () => {
    expect(filterClientCards([active, other], "all", "  NORTH ").map((c) => c.id)).toEqual([
      "client-1",
    ]);
    expect(filterClientCards([active, other], "all", "labs").map((c) => c.id)).toEqual(["o"]);
    expect(filterClientCards([active, other], "all", "3,500")).toEqual([]);
  });

  it("keeps the view and the search independent", () => {
    expect(filterClientCards([active, other], "build", "north")).toEqual([]);
    expect(proposedCards([active, other, proposed], "north").map((c) => c.id)).toEqual(["p"]);
    expect(proposedCards([active, other, proposed], "orchard")).toEqual([]);
  });
});

describe("the order is stable and puts exceptions first", () => {
  it("sorts attention, then the soonest obligation, then the name", () => {
    const cards = sortClientCards([
      deriveClientCard(
        client({ id: "c", name: "Calm Co", nextReviewAt: "2026-10-01T05:00:00.000Z" }),
        NOW,
        CHICAGO,
      ),
      deriveClientCard(
        client({
          id: "p",
          name: "Proposed Co",
          tier: null,
          mrrCents: null,
          proposal: { amountCents: null, sentAt: null, tier: null, open: true },
        }),
        NOW,
        CHICAGO,
      ),
      deriveClientCard(
        client({ id: "a", name: "Aging Co", nextReviewAt: "2026-08-01T05:00:00.000Z" }),
        NOW,
        CHICAGO,
      ),
      deriveClientCard(
        client({ id: "s", name: "Soon Co", nextReviewAt: "2026-09-06T05:00:00.000Z" }),
        NOW,
        CHICAGO,
      ),
    ]);
    expect(cards.map((card) => card.id)).toEqual(["a", "s", "c", "p"]);
  });
});

describe("the headline counts real things", () => {
  it("counts Run clients, reviews due and proposals awaiting a decision", () => {
    const headline = clientsHeadline(
      [
        deriveClientCard(
          client({ id: "1", nextReviewAt: "2026-09-05T05:00:00.000Z" }),
          NOW,
          CHICAGO,
        ),
        deriveClientCard(
          client({ id: "2", name: "Beta", nextReviewAt: "2026-08-01T05:00:00.000Z" }),
          NOW,
          CHICAGO,
        ),
        deriveClientCard(
          client({ id: "3", name: "Gamma", tier: "build", mrrCents: null }),
          NOW,
          CHICAGO,
        ),
        deriveClientCard(
          client({
            id: "4",
            name: "Delta",
            tier: null,
            mrrCents: null,
            proposal: {
              amountCents: 500_000,
              sentAt: "2026-09-02T12:00:00.000Z",
              tier: null,
              open: true,
            },
          }),
          NOW,
          CHICAGO,
        ),
      ],
      NOW,
      CHICAGO,
    );
    expect(headline.runClients).toBe(2);
    expect(headline.reviewsDue).toBe(2);
    expect(headline.proposalsAwaiting).toBe(1);
    expect(headline.sentence).toBe(
      "2 Run clients · 2 reviews due · 1 proposal awaiting your decision",
    );
  });

  it("never counts a renewal as a review due", () => {
    const headline = clientsHeadline(
      [
        deriveClientCard(
          client({ id: "1", renewalAt: "2026-09-05T05:00:00.000Z", nextReviewAt: null }),
          NOW,
          CHICAGO,
        ),
      ],
      NOW,
      CHICAGO,
    );
    expect(headline.reviewsDue).toBe(0);
  });

  it("carries the recorded review and renewal days on the card", () => {
    const card = deriveClientCard(
      client({ renewalAt: "2026-10-03T05:00:00.000Z", nextReviewAt: "2026-09-19T05:00:00.000Z" }),
      NOW,
      CHICAGO,
    );
    expect(card.nextReviewAt).toBe("2026-09-19T05:00:00.000Z");
    expect(card.renewalAt).toBe("2026-10-03T05:00:00.000Z");
  });

  it("names an unreadable proposal source instead of showing zero", () => {
    const headline = clientsHeadline(
      [deriveClientCard(client({ id: "1" }), NOW, CHICAGO)],
      NOW,
      CHICAGO,
      { proposalsAvailable: false },
    );
    expect(headline.proposalsAwaiting).toBeNull();
    expect(headline.sentence).toBe(
      "1 Run client · 0 reviews due · proposals could not be read just now",
    );
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
    expect(validateNewClient({ name: "  ", tier: "none" })).toContain(
      "A client needs a company name.",
    );
  });

  it("accepts a company with no tier and nothing else", () => {
    expect(validateNewClient({ name: "Acme", tier: "none" })).toEqual([]);
  });

  it("keeps recurring value to Run only", () => {
    expect(validateNewClient({ name: "Acme", tier: "diagnose", mrrCents: 100_000 })).toContain(
      "Only a Run client carries a recurring monthly value.",
    );
    expect(validateNewClient({ name: "Acme", tier: "none", mrrCents: 100_000 })).toContain(
      "Only a Run client carries a recurring monthly value.",
    );
  });

  it("requires the agreed phase amount when a client starts in Build", () => {
    expect(validateNewClient({ name: "Acme", tier: "build" })).toContain(
      "Creating a client in Build needs the phase amount that was agreed.",
    );
    expect(
      validateNewClient({ name: "Acme", tier: "build", buildPhaseAmountCents: 900_000 }),
    ).toEqual([]);
  });

  it("only accepts a real address for a website or a logo", () => {
    expect(validateNewClient({ name: "Acme", tier: "none", logoUrl: "acme.png" })).toContain(
      "The logo needs to be a full image address, starting with https://.",
    );
    expect(validateNewClient({ name: "Acme", tier: "none", websiteUrl: "acme.com" })).toContain(
      "The website needs to be a full address, starting with https://.",
    );
    expect(
      validateNewClient({
        name: "Acme",
        tier: "none",
        websiteUrl: "https://acme.com",
        logoUrl: "https://acme.com/logo.svg",
      }),
    ).toEqual([]);
  });
});
