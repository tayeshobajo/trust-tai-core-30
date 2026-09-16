/**
 * The one synthetic client fixture used by every round of the agency journey
 * build. Entirely invented: no real company, person, mailbox, credential or
 * customer record appears here, and nothing in this file is written to any
 * database. It exists so each round can be tested against the same journey.
 */

import type {
  HandoffEvidence,
  JourneyHandoff,
  JourneyItem,
  JourneyStage,
  JourneySubject,
} from "@/domain/agency-journey";

export const FIXTURE_ORGANIZATION_ID = "org-fixture-0000-0000-0000-000000000001";
export const FIXTURE_LABEL = "Northwind Fixture Ltd (synthetic)";

/** Every id below is a fixture id and is prefixed so it can never be mistaken. */
export const FIXTURE_SUBJECT: JourneySubject = {
  organizationId: FIXTURE_ORGANIZATION_ID,
  prospectId: "fixture-prospect-0001",
  contactId: "fixture-contact-0001",
  sourceRef: "fixture:icp-sweep/2026-01",
  label: FIXTURE_LABEL,
};

export const FIXTURE_PERSON = {
  id: "fixture-contact-0001",
  fullName: "Ada Fixture",
  roleTitle: "Operations lead (synthetic)",
  email: "ada@northwind.fixture.invalid",
};

export function fixtureEvidence(label: string, tier: HandoffEvidence["tier"] = "fact"): HandoffEvidence {
  return { label, tier, ref: "fixture://evidence" };
}

/** The subject as it looks once each stage has added what it owns. */
export function fixtureSubjectAt(stage: JourneyStage): JourneySubject {
  const base = { ...FIXTURE_SUBJECT };
  if (stage === "source" || stage === "qualify") return base;
  const withRelationship = { ...base, relationshipId: "fixture-relationship-0001" };
  if (stage === "discovery" || stage === "roadmap" || stage === "proposal") {
    return withRelationship;
  }
  return { ...withRelationship, clientId: "fixture-client-0001" };
}

/** A confirmed handoff, the shape a healthy step leaves behind. */
export function fixtureHandoff(
  from: JourneyStage,
  to: JourneyStage,
  overrides: Partial<JourneyHandoff> = {},
): JourneyHandoff {
  return {
    from,
    to,
    subject: fixtureSubjectAt(to),
    owningApp: overrides.owningApp ?? "comms",
    evidence: [fixtureEvidence("Synthetic evidence recorded in the fixture")],
    state: "confirmed",
    receiptRef: "fixture://receipt/0001",
    ...overrides,
  };
}

export const FIXTURE_ITEM: JourneyItem = {
  key: "fixture-item-0001",
  stage: "discovery",
  path: "active",
  subject: fixtureSubjectAt("discovery"),
  ownerLabel: "Unassigned",
  nextAction: "Ask the synthetic contact what they actually need.",
  evidence: [fixtureEvidence("Two replies on the synthetic thread")],
};
