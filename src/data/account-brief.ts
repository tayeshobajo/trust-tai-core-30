/**
 * Scout, the account brief.
 *
 * One evidence-backed page a Trust Tai member could take into a conversation:
 * what the company is, why it fits, what the opportunity looks like, why now,
 * who to speak to, and what is still unknown.
 *
 * Every section declares its tier. Facts carry sources; inferences say plainly
 * that they are Scout's read; human decisions are labelled as decisions. The
 * brief refuses to look complete when the evidence behind it is thin.
 */

import {
  OPPORTUNITY_AREA_LABEL,
  type AccountBrief,
  type BriefSection,
  type PersonPlan,
  type ScoutIntel,
} from "@/domain/scout-intel";
import type { ProspectCandidate } from "@/domain/scout";

function sources(...urls: (string | undefined)[]): string[] {
  return Array.from(new Set(urls.filter((url): url is string => !!url)));
}

export interface BriefInput {
  candidate: ProspectCandidate;
  intel: ScoutIntel;
  plan: PersonPlan;
}

export function buildAccountBrief({ candidate, intel, plan }: BriefInput): AccountBrief {
  const { prospect, evaluation } = candidate;
  const grounded = evaluation.scoreable && evaluation.evidenceCount > 0;
  const sectionList: BriefSection[] = [];

  const strongest = evaluation.criteria
    .filter((criterion) => criterion.state === "met")
    .slice(0, 3);

  sectionList.push({
    id: "company",
    title: "The company",
    tier: "fact",
    body: grounded
      ? `${prospect.name}${prospect.domain ? ` (${prospect.domain})` : ""}. ${evaluation.strongestSignal}`
      : `${prospect.name}${prospect.domain ? ` (${prospect.domain})` : ""}. Nothing has been read about this company yet.`,
    sources: sources(prospect.websiteUrl, ...intel.citations.slice(0, 3)),
  });

  sectionList.push({
    id: "why_this_account",
    title: "Why this account",
    tier: "inference",
    body: grounded
      ? `${evaluation.explanation} ${strongest.length > 0 ? `The read rests on: ${strongest.map((c) => c.label.toLowerCase()).join(", ")}.` : ""}`.trim()
      : "Scout cannot yet say why this account deserves attention. Research it first.",
    sources: sources(...strongest.flatMap((criterion) => criterion.sourceUrls ?? [])),
  });

  if (intel.opportunities.length > 0) {
    sectionList.push({
      id: "opportunity",
      title: "The opportunity",
      tier: "fact",
      body: intel.opportunities
        .slice(0, 4)
        .map((item) => `${OPPORTUNITY_AREA_LABEL[item.area]}: ${item.statement} (${item.evidence})`)
        .join(" "),
      sources: sources(...intel.opportunities.map((item) => item.sourceUrl)),
    });
  }

  if (intel.buyingSignals.length > 0) {
    sectionList.push({
      id: "why_now",
      title: "Why now",
      tier: "fact",
      body: intel.buyingSignals
        .slice(0, 4)
        .map(
          (signal) =>
            `${signal.statement}${signal.observedAt ? ` (${signal.observedAt.slice(0, 10)})` : ""}`,
        )
        .join(" "),
      sources: sources(...intel.buyingSignals.map((signal) => signal.sourceUrl)),
    });
  }

  if (plan.primary) {
    sectionList.push({
      id: "primary_contact",
      title: "Who to speak to",
      tier: "inference",
      body: `${plan.primary.fullName}${plan.primary.roleTitle ? `, ${plan.primary.roleTitle}` : ""}. ${plan.primary.why} ${plan.primary.routeNote}`,
      sources: [],
    });
    if (plan.supporting.length > 0) {
      sectionList.push({
        id: "supporting_people",
        title: "Also worth knowing",
        tier: "inference",
        body: plan.supporting
          .map(
            (person) =>
              `${person.fullName}${person.roleTitle ? ` (${person.roleTitle})` : ""} · ${person.routeNote}`,
          )
          .join(" "),
        sources: [],
      });
    }
  }

  sectionList.push({
    id: "angle",
    title: "Suggested angle",
    tier: "inference",
    body: buildAngle({ candidate, intel, plan }),
    sources: [],
  });

  const unknowns = [
    ...intel.unknowns,
    ...(plan.gap ? [plan.gap] : []),
    ...evaluation.criteria
      .filter((criterion) => criterion.state === "missing")
      .map((criterion) => `${criterion.label} is unknown · ${criterion.reason}`),
  ];

  if (unknowns.length > 0) {
    sectionList.push({
      id: "unknowns",
      title: "Still unknown",
      tier: "fact",
      body: unknowns.slice(0, 6).join(" "),
      sources: [],
    });
  }

  const evidenceUrls = sources(
    ...evaluation.criteria.flatMap((criterion) => criterion.sourceUrls ?? []),
    ...intel.citations,
  );
  if (evidenceUrls.length > 0) {
    sectionList.push({
      id: "evidence",
      title: "Everything this rests on",
      tier: "fact",
      body: `${evidenceUrls.length} public source${evidenceUrls.length === 1 ? "" : "s"} were read for this brief.`,
      sources: evidenceUrls,
    });
  }

  return { companyName: prospect.name, sections: sectionList, grounded };
}

/**
 * The angle is explicitly an inference: it names the strongest observed
 * problem and the strongest timing signal, and says nothing when neither
 * exists rather than inventing a hook.
 */
function buildAngle({ candidate, intel, plan }: BriefInput): string {
  const problem = intel.opportunities[0];
  const signal = intel.buyingSignals[0];
  const who = plan.primary ? plan.primary.fullName : "the right person";

  if (!problem && !signal) {
    return `Scout has no honest hook yet. Open with a question rather than a claim, or research ${candidate.prospect.name} further before approaching ${who}.`;
  }
  const parts: string[] = [];
  if (problem) {
    parts.push(
      `Lead with ${OPPORTUNITY_AREA_LABEL[problem.area].toLowerCase()}: ${problem.statement.replace(/\.$/, "")}.`,
    );
  }
  if (signal) {
    parts.push(`Tie it to what is happening now · ${signal.statement.replace(/\.$/, "")}.`);
  }
  parts.push(`Address it to ${who}, and reference only what was actually read on their site.`);
  return parts.join(" ");
}
