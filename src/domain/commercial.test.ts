import { describe, expect, it } from "vitest";

import {
  readClientCommercialState,
  readMeetingKind,
  readProposalCommercialState,
} from "./commercial";
import { DEFAULT_WEEKLY_TARGETS, readWeeklyTargets } from "./weekly-targets";

describe("readClientCommercialState", () => {
  it("reads a fully entered client row", () => {
    const state = readClientCommercialState({
      tier: "run",
      mrr_cents: 400_000,
      renewal_at: "2027-01-01T00:00:00.000Z",
      next_review_at: "2026-10-01T00:00:00.000Z",
      tier_changed_at: "2026-09-01T00:00:00.000Z",
      commercial_updated_by: "user-1",
      commercial_updated_at: "2026-09-01T00:00:00.000Z",
      commercial_provenance: { actor: "Tai", source: "human" },
    });
    expect(state.tier).toBe("run");
    expect(state.mrrCents).toBe(400_000);
    expect(state.commercialProvenance).toEqual({ actor: "Tai", source: "human" });
  });

  it("reads an untouched client as unknown rather than guessing", () => {
    const state = readClientCommercialState({ name: "Acme" });
    expect(state).toEqual({
      tier: null,
      mrrCents: null,
      renewalAt: null,
      nextReviewAt: null,
      tierChangedAt: null,
      commercialUpdatedBy: null,
      commercialUpdatedAt: null,
      commercialProvenance: null,
    });
  });

  it("refuses a tier the database would not accept", () => {
    expect(readClientCommercialState({ tier: "enterprise" }).tier).toBeNull();
  });
});

describe("readProposalCommercialState", () => {
  it("reads the lineage row", () => {
    const proposal = readProposalCommercialState({
      proposal_sent_at: "2026-09-01T00:00:00.000Z",
      proposal_amount_cents: 250_000,
      proposal_outcome: "signed",
      proposal_outcome_at: "2026-09-03T00:00:00.000Z",
      proposal_updated_by: "user-1",
    });
    expect(proposal.proposalOutcome).toBe("signed");
    expect(proposal.proposalAmountCents).toBe(250_000);
  });

  it("refuses an outcome outside the vocabulary", () => {
    expect(readProposalCommercialState({ proposal_outcome: "won" }).proposalOutcome).toBeNull();
  });
});

describe("readMeetingKind", () => {
  it("accepts only the four human-set kinds", () => {
    expect(readMeetingKind("discovery")).toBe("discovery");
    expect(readMeetingKind("roadmap_review")).toBe("roadmap_review");
    expect(readMeetingKind("intro call")).toBeNull();
    expect(readMeetingKind(null)).toBeNull();
  });
});

describe("readWeeklyTargets", () => {
  it("falls back to the locked definitions when nothing is configured", () => {
    expect(readWeeklyTargets(null)).toEqual(DEFAULT_WEEKLY_TARGETS);
  });

  it("reads a configured row", () => {
    const targets = readWeeklyTargets({
      first_touch_target_low: 8,
      first_touch_target_high: 14,
      discovery_target_low: 3,
      discovery_target_high: 4,
      diagnose_proposals_target_low: 2,
      diagnose_proposals_target_high: 3,
      run_clients_target: 25,
      revenue_target_cents: 1_000_000,
    });
    expect(targets.firstTouchTargetLow).toBe(8);
    expect(targets.runClientsTarget).toBe(25);
    expect(targets.revenueTargetCents).toBe(1_000_000);
  });

  it("keeps a missing revenue target absent rather than zero", () => {
    expect(readWeeklyTargets({}).revenueTargetCents).toBeNull();
  });
});
