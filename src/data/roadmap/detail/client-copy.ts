/**
 * The client copy, written out.
 *
 * Pure and deterministic. Every line comes from the frozen snapshot: nothing
 * is added here, nothing is softened, and a destination that is still a
 * proposal is labelled as one rather than presented as agreed.
 */

import type { ExportSnapshot, RoadmapExport } from "@/domain/roadmap-exports";

/** Subject line for the Comms draft that carries this copy. */
export function clientCopySubject(snapshot: ExportSnapshot, version: string): string {
  return `${snapshot.company} roadmap — version ${version}`;
}

/** Plain-text body. Readable as-is, and editable in Comms before anything is sent. */
export function clientCopyBody(entry: RoadmapExport): string {
  const snapshot = entry.snapshot;
  const lines: string[] = [];

  lines.push(`Roadmap for ${snapshot.company} — version ${entry.version}`);
  lines.push("");

  if (snapshot.pointA.length > 0) {
    lines.push("Where things stand today");
    for (const item of snapshot.pointA) lines.push(`- ${item}`);
    lines.push("");
  }

  if (snapshot.pointB.trim()) {
    lines.push(snapshot.pointBProposed ? "Where this could go (proposed)" : "Where this is going");
    lines.push(snapshot.pointB);
    lines.push("");
  }

  if (snapshot.milestones.length > 0) {
    lines.push("The path");
    for (const milestone of snapshot.milestones) {
      lines.push(`${milestone.ordinal}. ${milestone.name} — ${milestone.status}`);
      if (milestone.whatWeBuild.trim()) lines.push(`   What we build: ${milestone.whatWeBuild}`);
      if (milestone.whatItUnlocks.trim()) lines.push(`   What it unlocks: ${milestone.whatItUnlocks}`);
    }
    lines.push("");
  }

  if (snapshot.evidence.length > 0) {
    lines.push("What this rests on");
    for (const item of snapshot.evidence) {
      lines.push(item.url ? `- ${item.label} (${item.url})` : `- ${item.label}`);
    }
    lines.push("");
  }

  if (snapshot.noteFromTai?.trim()) {
    lines.push(snapshot.noteFromTai.trim());
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
