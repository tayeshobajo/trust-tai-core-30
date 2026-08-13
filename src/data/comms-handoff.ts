/**
 * Building a Comms handoff brief.
 *
 * Pure and deterministic: the same evidence always produces the same brief.
 * Every context line carries its tier and its evidence, so Comms can see what
 * was read, what Scout inferred, and what a person decided.
 */

import type { ConfidenceRead, EvidenceRef } from "@/domain/confidence";
import type {
  HandoffContact,
  HandoffContextItem,
  HandoffDraft,
  HandoffIntent,
} from "@/domain/comms-handoff";
import { isCommsReady, isDecisionMaker, type Person } from "@/domain/people";
import type { ResearchCoverage } from "@/domain/prospect-modules";
import type { ProspectCandidate } from "@/domain/scout";

import { criterionEvidence } from "./prospect-modules";

/** The person Comms should address: verified first, then most senior. */
export function chooseContact(people: Person[]): Person | null {
  const ranked = [...people].sort((a, b) => {
    const score = (person: Person) =>
      (isCommsReady(person) ? 4 : 0) +
      (person.emailStatus === "verified" ? 2 : person.email ? 1 : 0) +
      (isDecisionMaker(person) ? 2 : 0) +
      (person.confidence === "human_confirmed" ? 1 : 0);
    return score(b) - score(a);
  });
  return ranked[0] ?? null;
}

function toHandoffContact(person: Person): HandoffContact {
  return {
    personId: person.id,
    fullName: person.fullName,
    ...(person.roleTitle ? { roleTitle: person.roleTitle } : {}),
    ...(person.email ? { email: person.email } : {}),
    emailStatus: person.emailStatus,
    ...(person.emailCheckedAt ? { emailCheckedAt: person.emailCheckedAt } : {}),
    reachable: person.emailStatus === "verified",
  };
}

/** Intent follows the evidence, not enthusiasm. */
function chooseIntent(
  candidate: ProspectCandidate,
  coverage: ResearchCoverage,
): { intent: HandoffIntent; because: string } {
  const { evaluation, prospect } = candidate;
  const limiting = evaluation.criteria.find(
    (c) => c.key === "limiting_system" && (c.state === "met" || c.state === "partial"),
  );
  const milestone = evaluation.criteria.find(
    (c) => c.key === "first_milestone" && c.state === "met",
  );

  if (prospect.status === "converted") {
    return {
      intent: "reconnect",
      because: "This company has already been worked with, so the thread is being picked up.",
    };
  }
  if (limiting && milestone && evaluation.light === "green" && !coverage.thin) {
    return {
      intent: "propose",
      because:
        "A limiting system and a first milestone were both read from the public site, and fit is strong.",
    };
  }
  if (limiting) {
    return {
      intent: "diagnose",
      because: "A limiting system was observed, but the first milestone is not established.",
    };
  }
  return {
    intent: "introduce",
    because: "Fit holds, but no specific constraint has been observed to lead with.",
  };
}

function contextItem(
  label: string,
  value: string,
  tier: HandoffContextItem["tier"],
  evidence: EvidenceRef[],
): HandoffContextItem {
  return { label, value, tier, evidence };
}

export interface HandoffInput {
  candidate: ProspectCandidate;
  people: Person[];
  coverage: ResearchCoverage;
  /** Confidence in the underlying fit read, carried straight from the page. */
  fitConfidence: ConfidenceRead;
}

export function buildHandoffDraft(input: HandoffInput): HandoffDraft {
  const { candidate, people, coverage, fitConfidence } = input;
  const { prospect, evaluation } = candidate;
  const person = chooseContact(people);
  const { intent, because } = chooseIntent(candidate, coverage);

  const requiredContext: HandoffContextItem[] = [
    contextItem(
      "ICP fit",
      evaluation.scoreable
        ? `${evaluation.score}% against ICP v${evaluation.icpVersion ?? "—"} (${evaluation.light}).`
        : "Never scored against live evidence.",
      "fact",
      [{ label: "Deterministic evaluator", kind: "computed" }],
    ),
    contextItem("Why this fits", candidate.fit.whyItFits, "inference", [
      { label: "Scout's read of the observed facts", kind: "computed" },
    ]),
  ];

  for (const key of ["limiting_system", "first_milestone", "roadmap_depth"]) {
    const criterion = evaluation.criteria.find((c) => c.key === key);
    if (!criterion || criterion.state === "missing") continue;
    requiredContext.push(
      contextItem(criterion.label, criterion.reason, "fact", criterionEvidence(criterion)),
    );
  }

  const strongest = candidate.signals.slice(0, 3);
  for (const signal of strongest) {
    requiredContext.push(
      contextItem("Observed", signal.statement, "fact", [
        signal.sourceUrl
          ? { label: "Public page", url: signal.sourceUrl, kind: "page" }
          : { label: "Public website read", kind: "page" },
      ]),
    );
  }

  if (prospect.status === "qualified" || prospect.status === "ready_for_comms") {
    requiredContext.push(
      contextItem(
        "Decision on record",
        `A Trust Tai member qualified ${prospect.name}. No contact has been made.`,
        "decision",
        [{ label: "Scout decision record", kind: "human" }],
      ),
    );
  }

  const blockers: string[] = [];
  if (!person) blockers.push("No named person is on record to address.");
  if (person && !person.roleTitle) blockers.push(`No role is recorded for ${person.fullName}.`);
  if (person && !person.email) blockers.push(`No business email is on record for ${person.fullName}.`);
  if (person?.email && person.emailStatus !== "verified") {
    blockers.push(
      `${person.email} is ${person.emailStatus === "found" ? "unverified" : person.emailStatus}, so it cannot be treated as reachable.`,
    );
  }
  if (!evaluation.scoreable) blockers.push("The company has never been researched against the ICP.");
  if (coverage.thin) blockers.push("Research coverage is thin, so the brief rests on partial reading.");

  const confidence: ConfidenceRead = {
    level: blockers.length === 0 ? fitConfidence.level : coverage.thin ? "low" : "moderate",
    because:
      blockers.length === 0
        ? `${fitConfidence.because} A verified contact is on record.`
        : `${blockers.length} thing${blockers.length === 1 ? "" : "s"} still stand${blockers.length === 1 ? "s" : ""} between this brief and a safe handoff.`,
    evidence: [
      ...fitConfidence.evidence,
      ...(person
        ? [
            {
              label: `${person.fullName} · ${person.sourceId.replace(/-/g, " ")}`,
              ...(person.sourceUrl ? { url: person.sourceUrl } : {}),
              kind: person.sourceId === "manual" ? ("human" as const) : ("provider" as const),
            },
          ]
        : []),
    ],
  };

  return {
    prospectId: prospect.id,
    companyName: prospect.name,
    ...(prospect.websiteUrl ? { websiteUrl: prospect.websiteUrl } : {}),
    contact: person ? toHandoffContact(person) : null,
    intent,
    intentBecause: because,
    requiredContext,
    confidence,
    blockers,
    ready: blockers.length === 0,
    generatedAt: new Date().toISOString(),
  };
}
