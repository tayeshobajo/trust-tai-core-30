/**
 * Scout, bounded next steps.
 *
 * Only actions the product actually supports appear here. Anything the current
 * build cannot do is either omitted or shown as explicitly unavailable, with
 * the honest reason. Nothing is auto-executed: these are offers, not moves.
 */

import type { ProspectCandidate } from "@/domain/scout";

export type NextStepKey =
  | "research_leadership"
  | "rerun_research"
  | "track_signals"
  | "prepare_comms_handoff"
  | "add_note";

export interface ScoutNextStep {
  key: NextStepKey;
  label: string;
  description: string;
  available: boolean;
  unavailableReason?: string;
}

export function scoutNextSteps(input: {
  candidate: ProspectCandidate;
  peopleCount: number;
  providerAvailable: boolean;
}): ScoutNextStep[] {
  const { candidate, peopleCount, providerAvailable } = input;
  const researched = candidate.source.kind === "live_website";
  const status = candidate.prospect.status;

  const steps: ScoutNextStep[] = [
    {
      key: "research_leadership",
      label: peopleCount > 0 ? "Review leadership" : "Research leadership",
      description:
        peopleCount > 0
          ? `${peopleCount} ${peopleCount === 1 ? "person is" : "people are"} on record for this company.`
          : "Look for the people who would decide on a web engagement.",
      available: providerAvailable || peopleCount > 0,
      ...(providerAvailable || peopleCount > 0
        ? {}
        : { unavailableReason: "No people source is connected yet." }),
    },
    {
      key: "rerun_research",
      label: researched ? "Re-read the public pages" : "Research this company",
      description: "Read the company's own public pages again and rescore the ICP fit.",
      available: Boolean(candidate.prospect.websiteUrl || candidate.prospect.domain),
      ...(candidate.prospect.websiteUrl || candidate.prospect.domain
        ? {}
        : { unavailableReason: "No website is recorded for this company." }),
    },
    {
      key: "prepare_comms_handoff",
      label: "Prepare a Comms handoff",
      description:
        status === "ready_for_comms"
          ? "This company has already been handed to Comms."
          : "Hand the brief to Comms with its context intact. Nothing is sent.",
      available: status !== "ready_for_comms" && researched,
      ...(status === "ready_for_comms"
        ? { unavailableReason: "Already handed to Comms." }
        : researched
          ? {}
          : { unavailableReason: "Research this company before handing it over." }),
    },
    {
      key: "track_signals",
      label: "Track for signals",
      description: "Keep this company on the board and watch for new dated evidence.",
      available: true,
    },
    {
      key: "add_note",
      label: "Add a note",
      description: "Record what you know that Scout cannot read from a public page.",
      available: true,
    },
  ];

  return steps;
}
