import { describe, expect, it } from "vitest";

import { buildClientBook, deliveryLineFor, type ClientBookSources } from "./book-projection";
import type { ClientCommercialRecord, ProposalRecord } from "@/data/supabase/commercial-service";
import type { ExecutionProject } from "@/domain/projects";

const NOW = new Date("2026-09-03T12:00:00.000Z");
const CHICAGO = "America/Chicago";

function clientRecord(overrides: Partial<ClientCommercialRecord> = {}): ClientCommercialRecord {
  return {
    id: "client-1",
    name: "Northlight Systems",
    status: "active",
    websiteUrl: null,
    logoUrl: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    createdManually: false,
    tier: "run",
    mrrCents: 350_000,
    renewalAt: null,
    nextReviewAt: null,
    tierChangedAt: null,
    commercialUpdatedBy: null,
    commercialUpdatedAt: null,
    commercialProvenance: null,
    ...overrides,
  };
}

function project(overrides: Partial<ExecutionProject> = {}): ExecutionProject {
  return {
    id: "project-1",
    organizationId: "org-1",
    name: "Checkout rebuild",
    state: "in_flight",
    clientId: "client-1",
    pointA: "Manual checkout",
    pointB: "Automated checkout",
    evidence: [],
    dependencies: [],
    origin: { kind: "manual" } as ExecutionProject["origin"],
    lastMovedAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function proposal(overrides: Partial<ProposalRecord> = {}): ProposalRecord {
  return {
    id: "roadmap-1",
    title: "Ridgeway Foods",
    clientId: "client-2",
    prospectId: null,
    relationshipId: null,
    proposalSentAt: "2026-09-01T00:00:00.000Z",
    proposalAmountCents: 1_200_000,
    proposalOutcome: "open",
    proposalOutcomeAt: null,
    proposalUpdatedBy: null,
    ...overrides,
  };
}

const BASE: ClientBookSources = { clients: [clientRecord()], proposals: [], projects: [] };

describe("the book assembles from sources that already own their truth", () => {
  it("gives blocked delivery the line, over newer moving work", () => {
    const line = deliveryLineFor([
      project({ id: "a", name: "Website", lastMovedAt: "2026-09-02T00:00:00.000Z" }),
      project({
        id: "b",
        name: "Checkout rebuild",
        state: "blocked",
        blockedBecause: "waiting on API keys",
      }),
    ]);
    expect(line).toEqual({
      line: "Checkout rebuild is blocked: waiting on API keys",
      blocked: true,
    });
  });

  it("puts an open proposal on a company with no tier below the active clients", () => {
    const cards = buildClientBook(
      {
        ...BASE,
        clients: [clientRecord(), clientRecord({ id: "client-2", name: "Ridgeway Foods", tier: null, mrrCents: null })],
        proposals: [proposal()],
      },
      NOW,
      CHICAGO,
    );
    expect(cards.map((card) => card.kind)).toEqual(["active", "proposed"]);
    expect(cards[1]?.commercialLine).toBe("Proposed · $12,000");
  });

  it("ignores a proposal that has already been answered", () => {
    const cards = buildClientBook(
      {
        ...BASE,
        clients: [clientRecord({ tier: null, mrrCents: null })],
        proposals: [proposal({ clientId: "client-1", proposalOutcome: "declined" })],
      },
      NOW,
      CHICAGO,
    );
    expect(cards[0]?.kind).toBe("active");
  });

  it("carries the recorded logo and website onto the card, never a guessed one", () => {
    const cards = buildClientBook(
      {
        ...BASE,
        clients: [
          clientRecord({ logoUrl: "https://cdn.example.com/n.png", websiteUrl: "https://northlight.example" }),
        ],
      },
      NOW,
      CHICAGO,
    );
    expect(cards[0]?.logoUrl).toBe("https://cdn.example.com/n.png");
    expect(cards[0]?.websiteUrl).toBe("https://northlight.example");
    expect(buildClientBook(BASE, NOW, CHICAGO)[0]?.logoUrl).toBeNull();
  });
});

describe("a source that could not be read is never a healthy zero", () => {
  it("says delivery could not be read rather than showing nothing in flight", () => {
    const cards = buildClientBook({ ...BASE, projects: null }, NOW, CHICAGO);
    expect(cards[0]?.deliveryLine).toBe("Delivery could not be read just now.");
    expect(cards[0]?.warnings).toEqual([]);
  });

  it("shows no delivery line at all when delivery genuinely has nothing", () => {
    const cards = buildClientBook(BASE, NOW, CHICAGO);
    expect(cards[0]?.deliveryLine).toBeNull();
  });

  it("treats an unreadable proposal lineage as unknown, not as no proposals", () => {
    const cards = buildClientBook(
      { ...BASE, clients: [clientRecord({ tier: null, mrrCents: null })], proposals: null },
      NOW,
      CHICAGO,
    );
    // With no lineage to read, the company cannot be called proposed; it stays
    // an active record with no tier, and the page says the lineage was unread.
    expect(cards[0]?.kind).toBe("active");
    expect(cards[0]?.commercialLine).toBe("No tier · value not recorded");
  });
});
