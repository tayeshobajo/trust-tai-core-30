/**
 * Website → Core → Scout → Pulse → Conductor, end to end and read only.
 *
 * A production-shaped intake payload is signed exactly as TrustTai.com signs
 * it, turned into the rows the receiver would write, and then carried through
 * the intelligence layer. Nothing downstream is created: the test asserts that
 * too.
 */

import { describe, expect, it } from "vitest";

import { emptySnapshot, contextBlocks, deriveSignals } from "@/data/intelligence/derive";
import { toPulseSignals } from "@/data/pulse/projection";
import { classifyQuestion } from "@/data/intelligence/conductor/answer";
import { inboundBrief, websiteSignals } from "@/data/website/intel";
import {
  IntakeBody,
  signIntake,
  verifyIntakeSignature,
  websiteEventPayload,
  normalizeStructured,
} from "@/lib/website-intake.server";
import { packetFromSubmission } from "@/domain/stated";
import type { WebsiteSubmission } from "@/domain/website";
import type { ProspectCandidate } from "@/domain/scout";

const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-08-20T12:00:00.000Z";
const SECRET = "acceptance-secret";

const PAYLOAD = {
  source_app: "website",
  source_channel: "website",
  source_type: "roadmap_intake",
  submission_id: "sub_accept_1",
  submitted_at: "2026-08-19T15:20:00.000Z",
  started_at: "2026-08-19T15:04:00.000Z",
  attribution: {
    landing_path: "/roadmap",
    session_id: "sess_9",
    utm: { source: "linkedin", campaign: "founder-stories" },
  },
  person: { name: "Dana Reyes", email: "dana@elevate-ortho.com", role: "Founder" },
  company: { name: "Elevate Orthodontics", website: "https://elevate-ortho.com" },
  verbatim: [
    {
      question_id: "q_future",
      question_text: "What do you want to be true a year from now?",
      answer_text: "Three clinics running on one system, with no evening admin.",
      modality: "voice",
    },
  ],
  structured: {
    desired_future: ["Three clinics running on one system"],
    pains: ["Scheduling is manual and it eats evenings"],
  },
  signals: { frame: "growth", completeness: 0.82, authorizes_research: true },
  consent: { marketing_opt_in: true },
};

function submissionFrom(prospectId: string | null): WebsiteSubmission {
  const body = IntakeBody.parse(PAYLOAD);
  return {
    id: "row_1",
    organizationId: ORG,
    submissionId: body.submission_id,
    sourceApp: body.source_app,
    sourceChannel: body.source_channel,
    sourceType: body.source_type,
    submittedAt: body.submitted_at,
    startedAt: body.started_at ?? null,
    receivedAt: "2026-08-19T15:20:04.000Z",
    attribution: {
      landingPath: body.attribution.landing_path ?? null,
      sessionId: body.attribution.session_id ?? null,
      utm: { source: "linkedin", campaign: "founder-stories" },
    },
    person: {
      name: body.person.name ?? null,
      email: body.person.email ?? null,
      role: body.person.role ?? null,
    },
    company: { name: body.company.name ?? null, website: body.company.website ?? null },
    verbatim: body.verbatim.map((answer) => ({
      questionId: answer.question_id,
      questionText: answer.question_text,
      answerText: answer.answer_text,
      modality: answer.modality,
    })),
    structured: normalizeStructured(body.structured),
    signals: {
      frame: body.signals.frame ?? null,
      completeness: body.signals.completeness ?? null,
      authorizesResearch: body.signals.authorizes_research ?? null,
    },
    consent: { marketingOptIn: body.consent.marketing_opt_in ?? null },
    scoutProspectId: prospectId,
    linkState: prospectId ? "linked" : "unlinked",
    linkReason: prospectId
      ? "Matched on the company website the founder gave."
      : "No company name or website was given, so identity was not clear enough to place.",
    scoutStatus: prospectId ? "discovered" : null,
  };
}

function candidateFor(submission: WebsiteSubmission, prospectId: string): ProspectCandidate {
  return {
    prospect: {
      id: prospectId,
      organizationId: ORG,
      name: "Elevate Orthodontics",
      status: "discovered",
      createdAt: submission.submittedAt,
      updatedAt: submission.submittedAt,
    },
    signals: [],
    fit: { level: "unknown", reasons: [] },
    source: { kind: "inbound", label: "Website" },
    evaluation: {
      scoreable: false,
      score: 0,
      light: "grey",
      explanation: "Nothing has been verified yet.",
      evidenceCount: 0,
      evaluatorVersion: "v1",
      evaluatedAt: submission.submittedAt,
    },
    lastCheckedAt: submission.submittedAt,
    stated: packetFromSubmission(
      {
        submissionId: submission.submissionId,
        submittedAt: submission.submittedAt,
        structured: submission.structured,
        verbatim: submission.verbatim,
        signals: submission.signals,
        attribution: submission.attribution,
      },
      submission.id,
    ),
  } as unknown as ProspectCandidate;
}

describe("website intake reaches the intelligence layer", () => {
  it("keeps the signed transport contract intact", () => {
    const raw = JSON.stringify(PAYLOAD);
    const ts = String(Math.floor(Date.parse(NOW) / 1000));
    const signature = signIntake(SECRET, ts, raw);
    expect(
      verifyIntakeSignature({
        secret: SECRET,
        signature,
        timestamp: ts,
        rawBody: raw,
        now: new Date(NOW),
      }),
    ).toEqual({ ok: true });
  });

  it("builds one provenance-rich canonical payload per lifecycle event", () => {
    const body = IntakeBody.parse(PAYLOAD);
    const payload = websiteEventPayload({
      body,
      submissionRowId: "row_1",
      prospectId: "prospect_1",
      linkState: "linked",
      linkReason: "Matched on the company website the founder gave.",
      created: true,
    });
    expect(payload["source"]).toBe("trusttai.com");
    expect(payload["submission_id"]).toBe("sub_accept_1");
    expect(payload["scout_prospect_id"]).toBe("prospect_1");
    expect(payload["link_state"]).toBe("linked");
    expect(payload["completeness"]).toBe(0.82);
    expect(payload["authorizes_research"]).toBe(true);
    /* Never the conversation itself: the submission record owns that. */
    expect(JSON.stringify(payload)).not.toContain("evening admin");
  });

  it("carries a linked intake into context, Pulse and Conductor", () => {
    const submission = submissionFrom("prospect_1");
    const candidate = candidateFor(submission, "prospect_1");
    const snapshot = {
      ...emptySnapshot(ORG, NOW),
      candidates: [candidate],
      websiteSubmissions: [submission],
    };

    const blocks = contextBlocks(snapshot);
    const tiers = new Map(blocks.map((block) => [block.id, block.tier]));
    expect(tiers.get("website:intake:sub_accept_1")).toBe("observed");
    expect(tiers.get("website:said:sub_accept_1")).toBe("stated");
    expect(tiers.get("website:research:sub_accept_1")).toBe("stated");

    const signals = deriveSignals(snapshot);
    const awaiting = signals.find((signal) => signal.id === "website:awaiting:prospect_1");
    expect(awaiting?.destination.route).toBe("/modules/scout/prospects/prospect_1");

    const pulse = toPulseSignals({ organizationId: ORG, now: NOW, signals });
    const card = pulse.find((row) => row.id === "website:awaiting:prospect_1");
    expect(card?.sourceAppLabel).toBe("Scout");
    expect(card?.severity === "act_now" || card?.severity === "evaluate").toBe(true);

    const brief = inboundBrief({
      organizationId: ORG,
      now: NOW,
      submissions: [submission],
      candidates: [candidate],
    });
    expect(brief.total).toBe(1);
    expect(brief.awaitingReview).toBe(1);
    expect(brief.companies[0]!.stated.length).toBeGreaterThan(0);
    expect(brief.companies[0]!.observed).toEqual([]);
    expect(brief.companies[0]!.inferred).toEqual([]);
    expect(brief.companies[0]!.suggested.length).toBe(1);
    expect(brief.companies[0]!.researchAuthorized).toBe(true);
    expect(brief.companies[0]!.submissionRoute).toBe("/modules/website/submissions/row_1");
  });

  it("raises a held intake against the website record, not Scout", () => {
    const submission = submissionFrom(null);
    const signals = websiteSignals({
      organizationId: ORG,
      now: NOW,
      submissions: [submission],
      candidates: [],
    });
    expect(signals).toHaveLength(1);
    expect(signals[0]!.destination.appId).toBe("website");
    expect(signals[0]!.destination.route).toBe("/modules/website/submissions/row_1");
  });

  it("stays quiet once a person has decided", () => {
    const submission = { ...submissionFrom("prospect_1"), scoutStatus: "qualified" };
    const candidate = candidateFor(submission, "prospect_1");
    const decided = {
      ...candidate,
      prospect: { ...candidate.prospect, status: "qualified" },
    } as ProspectCandidate;
    const signals = websiteSignals({
      organizationId: ORG,
      now: NOW,
      submissions: [submission],
      candidates: [decided],
    });
    expect(signals).toEqual([]);
  });

  it("ignores intake older than the attention window", () => {
    const stale = { ...submissionFrom(null), submittedAt: "2026-05-01T00:00:00.000Z" };
    expect(
      websiteSignals({ organizationId: ORG, now: NOW, submissions: [stale], candidates: [] }),
    ).toEqual([]);
  });

  it("routes a website question to the inbound topic", () => {
    expect(classifyQuestion("What came in from the website this week?")).toBe("inbound");
    expect(classifyQuestion("What did the founder say?")).toBe("inbound");
  });

  it("creates no downstream work", () => {
    const submission = submissionFrom("prospect_1");
    const candidate = candidateFor(submission, "prospect_1");
    const snapshot = {
      ...emptySnapshot(ORG, NOW),
      candidates: [candidate],
      websiteSubmissions: [submission],
    };
    expect(snapshot.roadmaps).toEqual([]);
    expect(snapshot.projects).toEqual([]);
    const signals = deriveSignals(snapshot);
    for (const signal of signals) {
      expect(["scout", "website"]).toContain(signal.destination.appId);
    }
  });
});
