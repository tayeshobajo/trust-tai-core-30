/**
 * Grounded project suggestions.
 *
 * Every suggestion here is produced by a condition that is true in the record.
 * There is no model, no guessing and no autonomy: a suggestion carries its
 * evidence, a person decides, and any of them can be dismissed.
 */

import type { ProjectAsset } from "@/domain/project-intelligence";
import type { WorkItem } from "@/domain/project-delivery";
import type { ProjectContextPacket } from "./context-packet";

export interface ProjectSuggestion {
  id: string;
  title: string;
  because: string;
  evidence: string[];
}

export interface SuggestionInput {
  packet: ProjectContextPacket;
  work: WorkItem[];
  assets: ProjectAsset[];
  dismissed?: string[];
}

export function projectSuggestions(input: SuggestionInput): ProjectSuggestion[] {
  const dismissed = new Set(input.dismissed ?? []);
  const out: ProjectSuggestion[] = [];
  const { packet, work, assets } = input;

  if (work.length === 0) {
    out.push({
      id: "plan-the-work",
      title: "Create the implementation plan",
      because: "This project has an outcome but no work items yet.",
      evidence: [`Outcome: ${packet.project.outcome || "not recorded"}`, "0 work items"],
    });
  }

  const approved = assets.filter((asset) => asset.status === "approved");
  const qa = work.some((item) => /qa|test|review/i.test(item.title));
  if (approved.length > 0 && !qa) {
    out.push({
      id: "qa-checklist",
      title: "Add a QA checklist for the approved design",
      because: "An asset is approved and no QA or review work is recorded.",
      evidence: approved.map((asset) => `Approved: ${asset.title} v${asset.version}`),
    });
  }

  // A newer upload after an approval is a question, not an answer.
  for (const asset of approved) {
    const newer = assets.find(
      (other) =>
        other.id !== asset.id &&
        other.assetType === asset.assetType &&
        other.status !== "superseded" &&
        other.status !== "approved" &&
        new Date(other.createdAt).getTime() > new Date(asset.createdAt).getTime(),
    );
    if (newer) {
      out.push({
        id: `review-approval-${asset.id}`,
        title: `Check whether "${asset.title}" is still the approved version`,
        because: "A newer asset of the same type was uploaded after this one was approved.",
        evidence: [`Approved: ${asset.title}`, `Newer upload: ${newer.title}`],
      });
    }
  }

  if (!packet.roadmap.linked) {
    out.push({
      id: "link-roadmap",
      title: "Link this project to a roadmap milestone",
      because: "This project was created manually and carries no roadmap origin.",
      evidence: ["No roadmap milestone recorded"],
    });
  }

  for (const conflict of packet.conflicts) {
    out.push({
      id: `conflict-${conflict.about}`,
      title: `Resolve the conflict about ${conflict.about}`,
      because: "A confirmed decision disagrees with an older source.",
      evidence: [`Kept: ${conflict.kept}`, `Also claims: ${conflict.alsoClaims}`],
    });
  }

  return out.filter((suggestion) => !dismissed.has(suggestion.id));
}
