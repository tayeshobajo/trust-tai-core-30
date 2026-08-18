/**
 * Scout, what is still missing, and what Scout would do about it.
 *
 * A gap is never a failure state. It states plainly what has not been
 * established, whether Scout can close it from public sources on its own, and
 * what closing it would change. Nothing here guesses at the answer.
 */

import type { ResearchCoverage } from "@/domain/prospect-modules";
import type { GapPlan, PersonPlan, ResearchGap, ScoutIntel } from "@/domain/scout-intel";
import type { ProspectCandidate } from "@/domain/scout";

export interface GapInput {
  candidate: ProspectCandidate;
  intel: ScoutIntel;
  plan: PersonPlan;
  coverage?: ResearchCoverage | null;
}

export function buildGapPlan({ candidate, intel, plan, coverage }: GapInput): GapPlan {
  const gaps: ResearchGap[] = [];

  if (!candidate.evaluation.scoreable) {
    gaps.push({
      key: "research",
      label: "This company has never been researched",
      plan: "Run public-website research to read the site and score it against the active ICP.",
      autonomous: true,
    });
  } else {
    if (coverage?.thin) {
      gaps.push({
        key: "coverage",
        label: "Only part of the public site has been read",
        plan: coverage.note,
        autonomous: true,
      });
    }

    for (const criterion of candidate.evaluation.criteria) {
      if (criterion.state !== "missing") continue;
      gaps.push({
        key: `criterion:${criterion.key}`,
        label: `${criterion.label} is unknown`,
        plan: `Re-read the public site looking specifically for ${criterion.label.toLowerCase()}. Unknown is holding the score down, not counting against them.`,
        autonomous: true,
      });
    }

    if (intel.opportunities.length === 0) {
      gaps.push({
        key: "opportunity",
        label: "No specific digital problem has been observed",
        plan: "Inspect the public site for experience, performance, accessibility, and conversion problems Trust Tai could fix.",
        autonomous: true,
      });
    }

    if (intel.buyingSignals.length === 0) {
      gaps.push({
        key: "timing",
        label: "No public timing signal has been found",
        plan: "Look for hiring, funding, expansion, or leadership changes on public pages. Absence stays unknown.",
        autonomous: true,
      });
    }
  }

  if (!plan.primary) {
    gaps.push({
      key: "people",
      label: "Nobody has been identified at this company",
      plan: "Read the public team and contact pages, or ingest from an approved enrichment source.",
      autonomous: true,
    });
  } else if (plan.primary.route === "none" || plan.primary.route === "linkedin") {
    gaps.push({
      key: "contact_route",
      label: `No email route for ${plan.primary.fullName}`,
      plan: "Look for a public business address, or use an approved enrichment provider. Never guess an address.",
      autonomous: false,
    });
  } else if (plan.primary.route === "unverified_email") {
    gaps.push({
      key: "verification",
      label: `${plan.primary.fullName}'s email is unverified`,
      plan: "Run an email check before Comms sends anything. Unverified is never treated as reachable.",
      autonomous: false,
    });
  }

  const actionable = gaps.some((gap) => gap.autonomous);
  const summary =
    gaps.length === 0
      ? "Nothing material is missing. This account is ready for a decision."
      : `${gaps.length} thing${gaps.length === 1 ? "" : "s"} still missing. ${
          actionable
            ? "Scout can close some of these itself from public sources."
            : "The rest needs a provider or a person."
        }`;

  return { gaps, actionable, summary };
}
