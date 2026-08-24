/**
 * Scout, derived activity summary.
 *
 * A handful of plain-language bullets answering "what matters right now" for
 * one company, derived only from state that already exists: the fit
 * evaluation, recorded activity, and research coverage. Deterministic; no
 * second source of truth is stored anywhere.
 */

import type { ActivityEvent } from "@/domain/activity";
import type { ProspectCandidate } from "@/domain/scout";
import type { ResearchCoverage } from "@/data/prospect-modules";

export interface ScoutActivitySummary {
  bullets: string[];
}

const STATUS_BULLET: Partial<Record<ProspectCandidate["prospect"]["status"], string>> = {
  ready_for_comms: "Qualified and ready to hand to Comms when you decide.",
  qualified: "Qualified — the next move is preparing the way in.",
  passed: "Passed. It stays on record; nothing more is asked of you.",
};

function activityBullet(activities: ActivityEvent[]): string | null {
  const latest = activities[0];
  if (!latest) return null;
  return `Latest: ${latest.summary}`;
}

function coverageBullet(coverage: ResearchCoverage): string | null {
  if (coverage.researched) {
    return coverage.staleDays !== null && coverage.staleDays > 30
      ? `Research is ${coverage.staleDays} days old — a refresh would sharpen the read.`
      : null;
  }
  return "No deep research yet — the fit read rests on what Scout observed at intake.";
}

export function buildActivitySummary(input: {
  candidate: ProspectCandidate;
  activities: ActivityEvent[];
  coverage: ResearchCoverage;
}): ScoutActivitySummary {
  const { candidate, activities, coverage } = input;
  const { evaluation, prospect } = candidate;

  const bullets: string[] = [];

  bullets.push(
    evaluation.scoreable
      ? `ICP fit scores ${evaluation.score}/100. ${evaluation.explanation}`
      : "This company cannot be scored against the ICP yet — the evidence is too thin to judge honestly.",
  );

  const activity = activityBullet(activities);
  if (activity) bullets.push(activity);

  const coverageNote = coverageBullet(coverage);
  if (coverageNote) bullets.push(coverageNote);

  const status = STATUS_BULLET[prospect.status];
  if (status) bullets.push(status);

  return { bullets: bullets.slice(0, 4) };
}
