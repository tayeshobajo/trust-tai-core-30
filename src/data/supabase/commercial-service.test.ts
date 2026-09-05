/**
 * Integration tests for the commercial truth persistence layer.
 *
 * The real service, the real domain law and the real activity writer run
 * against an in-memory Supabase stand-in, so what is checked is the behaviour
 * the production schema actually supports: state on the client, proposals on
 * the roadmap lineage, dated events for one-off revenue, and a scoreboard that
 * is derived at read time and never written down.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeSupabase } from "./fake-supabase";

const db = createFakeSupabase();

vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: {
    from: (table: string) => db.from(table),
  },
}));

const service = await import("./commercial-service");

const CONTEXT = { organizationId: "org-1", userId: "user-1", userLabel: "Tai" };

/** A Thursday, so the week runs Mon 2026-08-31 to Mon 2026-09-07. */
const NOW = "2026-09-03T12:00:00.000Z";

function seedClient(overrides: Record<string, unknown> = {}) {
  db.tables["clients"] = [
    {
      id: "client-1",
      organization_id: "org-1",
      name: "Northbeam Studio",
      status: "active",
      tier: null,
      mrr_cents: null,
      renewal_at: null,
      next_review_at: null,
      tier_changed_at: null,
      commercial_updated_by: null,
      commercial_updated_at: null,
      commercial_provenance: null,
      ...overrides,
    },
  ];
}

function seedRoadmap(overrides: Record<string, unknown> = {}) {
  db.tables["roadmaps"] = [
    {
      id: "roadmap-1",
      organization_id: "org-1",
      title: "Northbeam Studio",
      client_id: "client-1",
      prospect_id: "prospect-1",
      relationship_id: null,
      proposal_sent_at: null,
      proposal_amount_cents: null,
      proposal_outcome: null,
      proposal_outcome_at: null,
      proposal_updated_by: null,
      ...overrides,
    },
  ];
}

beforeEach(() => {
  for (const key of Object.keys(db.tables)) db.tables[key] = [];
});

describe("client commercial state", () => {
  it("writes only the facts it was given, and stamps provenance", async () => {
    seedClient();
    const after = await service.setClientCommercialState(
      { clientId: "client-1", mrrCents: 400_000, because: "Signed the Run agreement." },
      CONTEXT,
    );

    expect(after.mrrCents).toBe(400_000);
    expect(after.tier).toBeNull();
    expect(after.commercialUpdatedBy).toBe("user-1");
    expect(after.commercialProvenance?.["because"]).toBe("Signed the Run agreement.");
    // No tier change, so no event.
    expect(db.tables["activities"] ?? []).toHaveLength(0);
  });

  it("emits client.tier_changed once, carrying the human-entered Build amount", async () => {
    seedClient();
    await service.setClientCommercialState(
      { clientId: "client-1", tier: "build", buildPhaseAmountCents: 1_200_000 },
      CONTEXT,
    );

    const events = db.tables["activities"] ?? [];
    expect(events).toHaveLength(1);
    const payload = events[0]?.["payload"] as Record<string, unknown>;
    expect(events[0]?.["event_type"]).toBe("client.tier_changed");
    expect(payload["tier"]).toBe("build");
    expect(payload["phase_amount_cents"]).toBe(1_200_000);
  });

  it("does not re-emit when the tier is written again unchanged", async () => {
    seedClient({ tier: "run" });
    await service.setClientCommercialState({ clientId: "client-1", tier: "run" }, CONTEXT);
    expect(db.tables["activities"] ?? []).toHaveLength(0);
  });

  it("never carries a phase amount into a tier that is not Build", async () => {
    seedClient();
    await service.setClientCommercialState(
      { clientId: "client-1", tier: "run", buildPhaseAmountCents: 999_999 },
      CONTEXT,
    );
    const payload = (db.tables["activities"] ?? [])[0]?.["payload"] as Record<string, unknown>;
    expect(payload["phase_amount_cents"]).toBeUndefined();
  });
});

describe("proposals on the roadmap lineage", () => {
  it("records a sent proposal as open, with its human-entered amount", async () => {
    seedRoadmap();
    const proposal = await service.recordProposalSent(
      { roadmapId: "roadmap-1", amountCents: 250_000, sentAt: "2026-09-01T09:00:00.000Z" },
      CONTEXT,
    );

    expect(proposal.proposalOutcome).toBe("open");
    expect(proposal.proposalAmountCents).toBe(250_000);
    expect(proposal.proposalOutcomeAt).toBeNull();
    expect((db.tables["activities"] ?? [])[0]?.["event_type"]).toBe("proposal.sent");
  });

  it("dates the outcome so recognition has a week to land in", async () => {
    seedRoadmap({ proposal_sent_at: "2026-09-01T09:00:00.000Z", proposal_amount_cents: 250_000 });
    const proposal = await service.recordProposalOutcome(
      { roadmapId: "roadmap-1", outcome: "signed", at: "2026-09-02T10:00:00.000Z" },
      CONTEXT,
    );

    expect(proposal.proposalOutcome).toBe("signed");
    expect(proposal.proposalOutcomeAt).toBe("2026-09-02T10:00:00.000Z");
    expect((db.tables["activities"] ?? [])[0]?.["event_type"]).toBe("proposal.signed");
  });

  it("recognises nothing when a proposal is declined", async () => {
    seedRoadmap({ proposal_sent_at: "2026-09-01T09:00:00.000Z", proposal_amount_cents: 250_000 });
    await service.recordProposalOutcome(
      { roadmapId: "roadmap-1", outcome: "declined", at: "2026-09-02T10:00:00.000Z" },
      CONTEXT,
    );
    const board = await service.readWeeklyScoreboard("org-1", NOW);
    expect(board.revenue.diagnoseCents).toBe(0);
  });
});

describe("weekly targets", () => {
  it("falls back to the locked defaults when an organization has no row", async () => {
    const targets = await service.readOrganizationWeeklyTargets("org-1");
    expect(targets.runClientsTarget).toBe(20);
    expect(targets.revenueTargetCents).toBeNull();
  });

  it("inserts once, then updates in place", async () => {
    const first = await service.saveOrganizationWeeklyTargets(
      {
        firstTouchTargetLow: 10,
        firstTouchTargetHigh: 12,
        discoveryTargetLow: 2,
        discoveryTargetHigh: 3,
        diagnoseProposalsTargetLow: 1,
        diagnoseProposalsTargetHigh: 2,
        runClientsTarget: 20,
        revenueTargetCents: 2_100_000,
      },
      CONTEXT,
    );
    expect(first.revenueTargetCents).toBe(2_100_000);
    expect(db.tables["organization_weekly_targets"]).toHaveLength(1);

    const second = await service.saveOrganizationWeeklyTargets(
      { ...first, runClientsTarget: 24 },
      CONTEXT,
    );
    expect(second.runClientsTarget).toBe(24);
    expect(db.tables["organization_weekly_targets"]).toHaveLength(1);
  });
});

describe("weekly scoreboard", () => {
  it("derives Run from tier state and recognises one-offs in their own week", async () => {
    db.tables["clients"] = [
      {
        id: "client-1",
        organization_id: "org-1",
        name: "Northbeam Studio",
        status: "active",
        tier: "run",
        mrr_cents: 520_000,
      },
      {
        id: "client-2",
        organization_id: "org-1",
        name: "Mull IT",
        status: "active",
        tier: "diagnose",
        mrr_cents: 999_999,
      },
    ];
    db.tables["roadmaps"] = [
      {
        id: "roadmap-1",
        organization_id: "org-1",
        title: "Northbeam Studio",
        proposal_sent_at: "2026-09-01T09:00:00.000Z",
        proposal_amount_cents: 300_000,
        proposal_outcome: "signed",
        proposal_outcome_at: "2026-09-01T10:00:00.000Z",
      },
    ];
    db.tables["activities"] = [
      {
        id: "activity-1",
        organization_id: "org-1",
        event_type: "client.tier_changed",
        occurred_at: "2026-09-02T10:00:00.000Z",
        payload: { tier: "build", phase_amount_cents: 100_000 },
      },
    ];

    const board = await service.readWeeklyScoreboard("org-1", NOW);
    expect(board.runClients).toBe(1);
    expect(board.revenue.runCents).toBeCloseTo((520_000 * 12) / 52, 10);
    expect(board.revenue.diagnoseCents).toBe(300_000);
    expect(board.revenue.buildCents).toBe(100_000);
    expect(board.proposalsSent).toBe(1);
    // Nothing derived is written back.
    expect(db.tables["clients"]?.[0]?.["mrr_cents"]).toBe(520_000);
  });

  it("counts a discovery call only when a person said it was one and it happened", async () => {
    db.tables["comms_touches"] = [
      {
        id: "touch-1",
        organization_id: "org-1",
        relationship_id: "rel-1",
        occurred_at: "2026-09-01T10:00:00.000Z",
        channel: "meeting",
        direction: "inbound",
        logged_by: "user-1",
        meeting_kind: "discovery",
        provenance: {},
      },
      {
        id: "touch-2",
        organization_id: "org-1",
        relationship_id: "rel-2",
        occurred_at: "2026-09-05T10:00:00.000Z",
        channel: "meeting",
        direction: "inbound",
        logged_by: "user-1",
        meeting_kind: "discovery",
        provenance: {},
      },
      {
        id: "touch-3",
        organization_id: "org-1",
        relationship_id: "rel-3",
        occurred_at: "2026-09-02T10:00:00.000Z",
        channel: "meeting",
        direction: "inbound",
        logged_by: "user-1",
        meeting_kind: "roadmap_review",
        provenance: {},
      },
      {
        id: "touch-4",
        organization_id: "org-1",
        relationship_id: "rel-4",
        occurred_at: "2026-09-02T11:00:00.000Z",
        channel: "email",
        direction: "outbound",
        logged_by: "user-1",
        meeting_kind: null,
        provenance: {},
      },
    ];

    const board = await service.readWeeklyScoreboard("org-1", NOW);
    // touch-2 is still in the future relative to NOW, so it is a plan.
    expect(board.discoveryCalls).toBe(1);
    expect(board.roadmapReviews).toBe(1);
  });

  it("counts a first touch only for a relationship never touched before", async () => {
    db.tables["comms_touches"] = [
      {
        id: "touch-1",
        organization_id: "org-1",
        relationship_id: "rel-new",
        occurred_at: "2026-09-01T10:00:00.000Z",
        channel: "email",
        direction: "outbound",
        logged_by: "user-1",
        provenance: {},
      },
      {
        id: "touch-2",
        organization_id: "org-1",
        relationship_id: "rel-old",
        occurred_at: "2026-09-01T11:00:00.000Z",
        channel: "email",
        direction: "outbound",
        logged_by: "user-1",
        provenance: {},
      },
      {
        id: "touch-0",
        organization_id: "org-1",
        relationship_id: "rel-old",
        occurred_at: "2026-08-20T11:00:00.000Z",
        channel: "email",
        direction: "outbound",
        logged_by: "user-1",
        provenance: {},
      },
    ];

    const board = await service.readWeeklyScoreboard("org-1", NOW);
    expect(board.firstTouches).toBe(1);
  });

  it("ignores a withdrawn meeting record", async () => {
    db.tables["comms_touches"] = [
      {
        id: "touch-1",
        organization_id: "org-1",
        relationship_id: "rel-1",
        occurred_at: "2026-09-01T10:00:00.000Z",
        channel: "meeting",
        direction: "inbound",
        logged_by: "user-1",
        meeting_kind: "discovery",
        provenance: { retracted_at: "2026-09-02T10:00:00.000Z" },
      },
    ];
    const board = await service.readWeeklyScoreboard("org-1", NOW);
    expect(board.discoveryCalls).toBe(0);
  });
});

describe("meeting kind", () => {
  it("is human set, and records who said so", async () => {
    db.tables["comms_touches"] = [
      {
        id: "touch-1",
        organization_id: "org-1",
        relationship_id: "rel-1",
        occurred_at: "2026-09-01T10:00:00.000Z",
        channel: "meeting",
        direction: "inbound",
        logged_by: "user-1",
        meeting_kind: null,
        provenance: { app_key: "comms" },
      },
    ];
    await service.setMeetingKind({ touchId: "touch-1", meetingKind: "discovery" }, CONTEXT);

    const row = db.tables["comms_touches"]?.[0] as Record<string, unknown>;
    expect(row["meeting_kind"]).toBe("discovery");
    const provenance = row["provenance"] as Record<string, unknown>;
    expect(provenance["meeting_kind_set_by"]).toBe("user-1");
    expect(provenance["app_key"]).toBe("comms");
  });
});
