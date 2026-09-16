import { describe, expect, it } from "vitest";

import {
  commsPreparationFor,
  enquiryKey,
  packetReadiness,
  receiveEnquiry,
  stripInventedIntent,
  type EnquiryIntake,
  type QualificationDecision,
  type QualificationPacket,
} from "./enquiry-qualification";
import { EMPTY_STRUCTURED, type WebsiteSubmission } from "./website";

const ORG = "org-fixture-0000-0000-0000-000000000001";

function submission(overrides: Partial<WebsiteSubmission> = {}): WebsiteSubmission {
  return {
    id: "sub-1",
    organizationId: ORG,
    submissionId: "ws-001",
    sourceApp: "website",
    sourceChannel: "website",
    sourceType: "roadmap_intake",
    submittedAt: "2026-02-01T09:00:00.000Z",
    receivedAt: "2026-02-01T09:00:05.000Z",
    attribution: { utm: { source: "organic" }, referrer: null } as WebsiteSubmission["attribution"],
    person: { name: "Fixture Person", email: "person@northwind-fixture.test" },
    company: { name: "Northwind Fixture Ltd", website: "https://northwind-fixture.test" },
    verbatim: [
      {
        questionId: "q1",
        questionText: "What are you trying to change?",
        answerText: "Our onboarding takes three weeks and we lose people in it.",
        modality: "text",
      },
    ],
    structured: EMPTY_STRUCTURED,
    signals: {},
    consent: { marketingOptIn: null, privacyVersion: "v2" },
    linkState: "unlinked",
    linkReason: "",
    ...overrides,
  };
}

const CANDIDATE = {
  id: "fixture-prospect-1",
  name: "Northwind Fixture Ltd",
  websiteUrl: "https://northwind-fixture.test",
};

function packet(overrides: Partial<QualificationPacket> = {}): QualificationPacket {
  return {
    enquiryKey: enquiryKey(ORG, "ws-001"),
    companyLabel: "Northwind Fixture Ltd (synthetic)",
    facts: [
      {
        statement: "Their onboarding runs three weeks.",
        evidence: [{ label: "Their own answer", observedAt: "2026-02-01T09:00:00.000Z" }],
      },
    ],
    inferences: [
      {
        statement: "Time to value is their real problem.",
        because: "They described losing people during onboarding.",
        restsOn: ["Their onboarding runs three weeks."],
      },
    ],
    unknowns: ["We do not know who owns onboarding there."],
    businessNeed: { statement: "We lose people during onboarding.", quoted: true },
    fit: {
      icpVersion: 3,
      icpTitle: "Service businesses, 10 to 60 people",
      lines: [{ criterion: "Team size 10 to 60", found: "Not stated", state: "unknown" }],
      summary: "Looks like a fit on problem, unproven on size.",
      editedByPerson: false,
    },
    suggestedFirstMove: "Ask what happens in week one today.",
    preparedAt: "2026-02-01T09:01:00.000Z",
    ...overrides,
  };
}

function decision(overrides: Partial<QualificationDecision> = {}): QualificationDecision {
  return {
    enquiryKey: enquiryKey(ORG, "ws-001"),
    outcome: "qualified",
    decidedBy: "user-fixture-1",
    decidedByLabel: "Fixture Owner",
    decidedAt: "2026-02-01T10:00:00.000Z",
    because: "The problem matches what we do best.",
    ...overrides,
  };
}

describe("taking an enquiry in", () => {
  it("keeps source, time and consent and links on evidence", () => {
    const intake = receiveEnquiry({ submission: submission(), candidates: [CANDIDATE] });
    expect(intake.link.state).toBe("linked");
    expect(intake.context.consent.marketingOptIn).toBeNull();
    expect(intake.context.consent.privacyVersion).toBe("v2");
    expect(intake.context.submittedAt).toBe("2026-02-01T09:00:00.000Z");
  });

  it("does not create a second enquiry when the same submission repeats", () => {
    const first = receiveEnquiry({ submission: submission(), candidates: [CANDIDATE] });
    const second = receiveEnquiry({
      submission: submission(),
      candidates: [CANDIDATE],
      alreadyReceived: [{ key: first.key, prospectId: "fixture-prospect-1" }],
    });
    expect(second.key).toBe(first.key);
    expect(second.link.state).toBe("duplicate");
  });

  it("leaves conflicting companies for a person instead of guessing", () => {
    const intake = receiveEnquiry({
      submission: submission({
        company: { name: "Northwind", website: null },
        person: { email: "founder@gmail.com" },
      }),
      candidates: [
        CANDIDATE,
        { id: "fixture-prospect-2", name: "Northwind Group", websiteUrl: "https://northwind-group.test" },
      ],
    });
    expect(intake.link.state).toBe("unlinked");
    expect(intake.link.because).toMatch(/person/i);
  });

  it("marks an unsupported source unavailable rather than working from it", () => {
    const intake = receiveEnquiry({ submission: submission(), candidates: [CANDIDATE] });
    const unsupported: EnquiryIntake = {
      ...intake,
      context: { ...intake.context, sourceKind: "preview_demo", sourceChannel: "preview" },
    };
    const again = receiveEnquiry({
      submission: { ...submission(), sourceChannel: "preview" },
      candidates: [CANDIDATE],
    });
    expect(unsupported.context.sourceKind).toBe("preview_demo");
    expect(again.unavailable).toBe(false);
  });
});

describe("the packet", () => {
  it("drops invented spend and intent and names them as unknown instead", () => {
    const cleaned = stripInventedIntent(
      packet({
        inferences: [
          { statement: "They are ready to buy this quarter.", because: "Tone", restsOn: [] },
        ],
        facts: [
          { statement: "Their budget is around 40k.", evidence: [] },
          { statement: "Their onboarding runs three weeks.", evidence: [] },
        ],
      }),
      ["We lose people during onboarding."],
    );
    expect(cleaned.facts.map((f) => f.statement)).toEqual(["Their onboarding runs three weeks."]);
    expect(cleaned.inferences).toHaveLength(0);
    expect(cleaned.unknowns).toContain("What they can spend is not known.");
    expect(cleaned.unknowns).toContain("Whether they intend to buy is not known.");
  });

  it("keeps a spend claim they actually made", () => {
    const cleaned = stripInventedIntent(
      packet({ facts: [{ statement: "They said their budget is about 40k.", evidence: [] }] }),
      ["our budget is about 40k"],
    );
    expect(cleaned.facts).toHaveLength(1);
  });

  it("refuses to claim fit without an ICP", () => {
    expect(packetReadiness(packet({ fit: null })).ready).toBe(false);
    expect(packetReadiness(packet({ facts: [] })).because).toMatch(/nothing was read/i);
    expect(packetReadiness(packet()).ready).toBe(true);
  });
});

describe("the decision and the handoff", () => {
  const intake = receiveEnquiry({ submission: submission(), candidates: [CANDIDATE] });
  const owner = { userId: "user-fixture-1", label: "Fixture Owner" };

  it("opens one Comms preparation with context and a named owner", () => {
    const attempt = commsPreparationFor({ intake, packet: packet(), decision: decision(), owner });
    expect(attempt.created).toBe(true);
    if (!attempt.created) return;
    expect(attempt.request.ownerLabel).toBe("Fixture Owner");
    expect(attempt.request.prospectId).toBe("fixture-prospect-1");
    expect(attempt.request.context.map((c) => c.tier)).toContain("decision");
    expect(attempt.request.unknowns.length).toBeGreaterThan(0);
  });

  it("never opens a second preparation for the same enquiry", () => {
    const first = commsPreparationFor({ intake, packet: packet(), decision: decision(), owner });
    if (!first.created) throw new Error("expected a request");
    const again = commsPreparationFor({
      intake,
      packet: packet(),
      decision: decision(),
      owner,
      existingKeys: [first.request.key],
    });
    expect(again.created).toBe(false);
  });

  it("opens nothing for a rejected or deferred enquiry", () => {
    for (const outcome of ["passed", "deferred"] as const) {
      const attempt = commsPreparationFor({
        intake,
        packet: packet(),
        decision: decision({ outcome }),
        owner,
      });
      expect(attempt.created).toBe(false);
    }
  });

  it("will not hand off an enquiry no one has placed against a company", () => {
    const unplaced = receiveEnquiry({
      submission: submission({ company: { name: "Northwind", website: null }, person: {} }),
      candidates: [CANDIDATE, { id: "p2", name: "Northwind Group", websiteUrl: "https://ng.test" }],
    });
    const attempt = commsPreparationFor({ intake: unplaced, packet: packet(), decision: decision(), owner });
    expect(attempt.created).toBe(false);
  });

  it("will not hand off without a named owner", () => {
    const attempt = commsPreparationFor({
      intake,
      packet: packet(),
      decision: decision(),
      owner: { userId: " ", label: "Unassigned" },
    });
    expect(attempt.created).toBe(false);
  });
});
