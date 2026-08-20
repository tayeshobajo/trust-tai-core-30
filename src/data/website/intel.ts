/**
 * Website → intelligence layer.
 *
 * Pure functions only. The Website room owns the conversation and the intake
 * record; Scout owns qualification. Nothing here writes, copies or rewrites
 * either. It turns what already exists into context blocks Pulse and Conductor
 * can read, with the four kinds of truth kept apart:
 *
 *   stated    the founder told us
 *   observed  Scout or the receiver verified it
 *   inferred  an interpretation over those two
 *   decided   a person committed to it
 *
 * A signal is only raised when a person could act on it today. Arrival alone
 * is history, not attention.
 */

import type { EvidenceRef } from "@/domain/confidence";
import type { EntityRef, ID } from "@/domain/entities";
import type { ProspectCandidate } from "@/domain/scout";
import type { ContextBlock, Signal } from "@/domain/signals";
import { claimsInLane, type FounderSignalPacket } from "@/domain/stated";
import type { WebsiteSubmission } from "@/domain/website";

const DAY = 86_400_000;

/** Beyond this, an inbound submission is history rather than attention. */
export const INBOUND_ATTENTION_DAYS = 30;

/** Scout statuses that mean nobody has made the call yet. */
const UNDECIDED = new Set(["discovered", "reviewing", "researching"]);

/** Scout statuses that mean a person already decided. */
const DECIDED = new Set(["qualified", "ready_for_comms", "converted", "passed", "archived"]);

export function submissionRoute(submission: WebsiteSubmission): string {
  return `/modules/website/submissions/${submission.id}`;
}

export function prospectRoute(prospectId: ID): string {
  return `/modules/scout/prospects/${prospectId}`;
}

function daysOld(at: string, now: string): number {
  const a = new Date(at).getTime();
  const b = new Date(now).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.floor((b - a) / DAY));
}

/** The name a person would use for an inbound company. Never invented. */
export function inboundLabel(submission: WebsiteSubmission): string {
  const company = submission.company.name?.trim();
  if (company) return company;
  const site = submission.company.website?.trim();
  if (site) return site.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  const email = submission.person.email?.trim();
  if (email && email.includes("@")) return email.split("@")[1] ?? email;
  return "An inbound founder";
}

function sourceLine(submission: WebsiteSubmission): string {
  const source = submission.attribution.utm?.source?.trim();
  const campaign = submission.attribution.utm?.campaign?.trim();
  if (source && campaign) return `${source}, ${campaign}`;
  if (source) return source;
  const path = submission.attribution.landingPath?.trim();
  return path ? `landed on ${path}` : "direct";
}

function submissionEvidence(submission: WebsiteSubmission): EvidenceRef {
  return { label: "Roadmap intake on TrustTai.com", kind: "page", url: submissionRoute(submission) };
}

export interface WebsiteIntelInput {
  organizationId: ID;
  now: string;
  submissions: WebsiteSubmission[];
  candidates: ProspectCandidate[];
}

function recent(input: WebsiteIntelInput): WebsiteSubmission[] {
  return input.submissions.filter(
    (submission) => daysOld(submission.submittedAt, input.now) <= INBOUND_ATTENTION_DAYS,
  );
}

function candidateOf(
  input: WebsiteIntelInput,
  submission: WebsiteSubmission,
): ProspectCandidate | undefined {
  if (!submission.scoutProspectId) return undefined;
  return input.candidates.find(
    (candidate) => candidate.prospect.id === submission.scoutProspectId,
  );
}

/* ---------------------------------------------------------- context blocks */

function block(
  input: Omit<ContextBlock, "stalenessDays"> & { now: string },
): ContextBlock {
  const { now, ...rest } = input;
  return { ...rest, stalenessDays: daysOld(rest.at, now) };
}

/**
 * What the intelligence layer may read about inbound intake.
 *
 * References only. The verbatim conversation stays in the Website room and is
 * reached through the evidence link, never duplicated here.
 */
export function websiteContextBlocks(input: WebsiteIntelInput): ContextBlock[] {
  const blocks: ContextBlock[] = [];

  for (const submission of recent(input)) {
    const label = inboundLabel(submission);
    const candidate = candidateOf(input, submission);
    const entity: EntityRef = submission.scoutProspectId
      ? { type: "prospect", id: submission.scoutProspectId, label: candidate?.prospect.name ?? label }
      : { type: "activity", id: submission.id, label };
    const evidence = [submissionEvidence(submission)];

    blocks.push(
      block({
        now: input.now,
        id: `website:intake:${submission.submissionId}`,
        appId: "website",
        entity,
        fact: `${label} completed the roadmap intake on TrustTai.com (${sourceLine(submission)}).`,
        tier: "observed",
        evidence,
        at: submission.submittedAt,
        confidence: "high",
      }),
    );

    const said = firstStatement(candidate?.stated ?? null, submission);
    if (said) {
      blocks.push(
        block({
          now: input.now,
          id: `website:said:${submission.submissionId}`,
          appId: "website",
          entity,
          fact: `In their own words: ${said}`,
          tier: "stated",
          evidence,
          at: submission.submittedAt,
          confidence: "moderate",
        }),
      );
    }

    blocks.push(
      block({
        now: input.now,
        id: `website:link:${submission.submissionId}`,
        appId: "website",
        entity,
        fact:
          submission.linkState === "linked"
            ? `This intake reached Scout as a company record. ${submission.linkReason}`.trim()
            : `This intake is resting as an unlinked signal. ${submission.linkReason}`.trim(),
        tier: "observed",
        evidence,
        at: submission.receivedAt,
        confidence: "high",
      }),
    );

    if (typeof submission.signals.authorizesResearch === "boolean") {
      blocks.push(
        block({
          now: input.now,
          id: `website:research:${submission.submissionId}`,
          appId: "website",
          entity,
          fact: submission.signals.authorizesResearch
            ? `${label} gave permission for us to research them.`
            : `${label} did not give permission for us to research them.`,
          tier: "stated",
          evidence,
          at: submission.submittedAt,
          confidence: "high",
        }),
      );
    }
  }

  return blocks;
}

function firstStatement(
  packet: FounderSignalPacket | null,
  submission: WebsiteSubmission,
): string | null {
  if (packet) {
    const future = claimsInLane(packet, "desired_future")[0];
    const pain = claimsInLane(packet, "pains")[0];
    const any = packet.claims[0]?.statement;
    const chosen = future ?? pain ?? any;
    if (chosen) return chosen;
  }
  const fallback =
    submission.structured.desiredFuture[0] ??
    submission.structured.pains[0] ??
    submission.structured.currentState[0];
  return fallback ?? null;
}

/* ----------------------------------------------------------------- signals */

/**
 * The only inbound states worth a person's attention.
 *
 * Every other lifecycle fact stays as history in the activity record, so the
 * room does not become a feed of things that need nothing.
 */
export function websiteSignals(input: WebsiteIntelInput): Signal[] {
  const signals: Signal[] = [];

  for (const submission of recent(input)) {
    const label = inboundLabel(submission);
    const evidence = [submissionEvidence(submission)];
    const age = daysOld(submission.submittedAt, input.now);
    const candidate = candidateOf(input, submission);

    /* Held: identity was ambiguous, so only a person can resolve it. */
    if (submission.linkState !== "linked" || !submission.scoutProspectId) {
      signals.push({
        id: `website:held:${submission.submissionId}`,
        category: "pipeline",
        title: `${label} came in through the website and is waiting for a person`,
        why: submission.linkReason || "Identity was not clear enough to place this with a company.",
        subject: { type: "activity", id: submission.id, label },
        evidence,
        contextRefs: [`website:link:${submission.submissionId}`],
        confidence: "high",
        recommendedNextMove: "Open the submission and place it with the right company, or leave it as a signal.",
        destination: {
          appId: "website",
          label: "Open the submission",
          route: submissionRoute(submission),
        },
        status: "new",
        urgency: age >= 2 ? 82 : 70,
        at: submission.receivedAt,
      });
      continue;
    }

    const prospectId = submission.scoutProspectId;
    const status = (candidate?.prospect.status ?? "").toLowerCase();
    const name = candidate?.prospect.name ?? label;

    /* Linked and undecided: a founder is waiting on a human call. */
    if (!DECIDED.has(status)) {
      signals.push({
        id: `website:awaiting:${prospectId}`,
        category: "pipeline",
        title: `${name} reached out and has not been reviewed`,
        why: "A company that came to us is warmer than one we found, and the answer is still open.",
        subject: { type: "prospect", id: prospectId, label: name },
        evidence,
        contextRefs: [`website:intake:${submission.submissionId}`],
        confidence: "high",
        recommendedNextMove: "Read what they said and make the call in Scout.",
        destination: { appId: "scout", label: "Open in Scout", route: prospectRoute(prospectId) },
        status: "new",
        urgency: age >= 3 ? 88 : 76,
        at: submission.submittedAt,
      });
    }

    /* Permission given, nothing read yet. Quieter: it is preparation, not a promise. */
    const researched = (candidate?.signals.length ?? 0) > 0;
    if (
      submission.signals.authorizesResearch === true &&
      !researched &&
      UNDECIDED.has(status)
    ) {
      signals.push({
        id: `website:research-ready:${prospectId}`,
        category: "growth",
        title: `${name} said yes to research and nothing has been read yet`,
        why: "Permission is on record, so Scout can look before anyone makes a judgment.",
        subject: { type: "prospect", id: prospectId, label: name },
        evidence,
        contextRefs: [`website:research:${submission.submissionId}`],
        confidence: "high",
        recommendedNextMove: "Run the research in Scout so the decision rests on more than testimony.",
        destination: { appId: "scout", label: "Open in Scout", route: prospectRoute(prospectId) },
        status: "new",
        urgency: 48,
        at: submission.submittedAt,
      });
    }
  }

  return signals;
}

/* ------------------------------------------------------------ inbound brief */

export interface InboundCompanyRead {
  label: string;
  submissionId: string;
  submissionRoute: string;
  prospectId: ID | null;
  prospectRoute: string | null;
  submittedAt: string;
  ageDays: number;
  linkState: WebsiteSubmission["linkState"];
  linkReason: string;
  /** What the founder told us. Never scored. */
  stated: string[];
  /** What Scout verified for itself. */
  observed: string[];
  /** Scout's own reading over that evidence. */
  inferred: string[];
  /** Possible next moves. Nothing is taken without a person. */
  suggested: string[];
  researchAuthorized: boolean | null;
  scoutStatus: string | null;
  completeness: number | null;
}

export interface InboundBrief {
  total: number;
  held: number;
  awaitingReview: number;
  companies: InboundCompanyRead[];
}

/**
 * What Conductor may say about inbound intake.
 *
 * Read-only and reference-first: Conductor can describe what arrived, what was
 * said, and what Scout has decided. It never claims it can run the Website
 * room, and every next move stays with the room that owns the change.
 */
export function inboundBrief(input: WebsiteIntelInput): InboundBrief {
  const rows = recent(input);
  const companies = rows.map((submission): InboundCompanyRead => {
    const candidate = candidateOf(input, submission);
    const packet = candidate?.stated ?? null;
    const status = candidate?.prospect.status ?? submission.scoutStatus ?? null;
    return {
      label: candidate?.prospect.name ?? inboundLabel(submission),
      submissionId: submission.submissionId,
      submissionRoute: submissionRoute(submission),
      prospectId: submission.scoutProspectId ?? null,
      prospectRoute: submission.scoutProspectId ? prospectRoute(submission.scoutProspectId) : null,
      submittedAt: submission.submittedAt,
      ageDays: daysOld(submission.submittedAt, input.now),
      linkState: submission.linkState,
      linkReason: submission.linkReason,
      stated: (packet?.claims.map((claim) => claim.statement) ?? [
        ...submission.structured.desiredFuture,
        ...submission.structured.pains,
      ]).slice(0, 6),
      observed: (candidate?.signals ?? []).slice(0, 6).map((signal) => signal.statement),
      inferred: candidate?.evaluation.scoreable
        ? [`ICP fit reads ${candidate.evaluation.score}/100. ${candidate.evaluation.explanation}`]
        : [],
      suggested: candidate?.nextMove ? [candidate.nextMove.statement] : [],
      researchAuthorized: submission.signals.authorizesResearch ?? null,
      scoutStatus: status,
      completeness: submission.signals.completeness ?? null,
    };
  });

  return {
    total: companies.length,
    held: companies.filter((company) => company.linkState !== "linked").length,
    awaitingReview: companies.filter(
      (company) => company.prospectId !== null && !DECIDED.has((company.scoutStatus ?? "").toLowerCase()),
    ).length,
    companies: companies.sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1)),
  };
}
