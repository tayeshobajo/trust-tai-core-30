/**
 * The one roadmap research pass.
 *
 * Standalone Roadmap and the Roadmap surface inside a Project both call this.
 * There is exactly one candidate generator, it writes only through the Roadmap
 * intelligence service, and everything it produces lands Inferred and Proposed
 * so a person still has to decide.
 */

import {
  normalizeMilestones,
  normalizeResearch,
  normalizeStrategy,
} from "@/data/roadmap-research-parse";
import { roadmapIntel, type IntelContext } from "@/data/supabase/roadmap-intel-service";
import type { RoadmapDetail } from "@/domain/roadmap";

export interface ResearchRun {
  /** Canonical roadmap detail read. Never reconstructed from labels. */
  detail: RoadmapDetail;
  intelContext: IntelContext;
  accessToken: () => Promise<string>;
  onStage: (message: string) => void;
}

export async function runRoadmapResearch({
  detail,
  intelContext,
  accessToken,
  onStage,
}: ResearchRun): Promise<void> {
  onStage("Starting");

  const response = await fetch("/api/public/roadmap/research", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await accessToken()}`,
    },
    body: JSON.stringify({
      organization_id: intelContext.organizationId,
      subject_label: detail.roadmap.subjectLabel,
      objective: detail.roadmap.objective,
      known: detail.roadmap.pointA.map((entry) => `${entry.label}: ${entry.value}`),
    }),
  });

  if (!response.ok || !response.body) {
    const detailText = await response.text();
    throw new Error(detailText.slice(0, 300) || "The research run could not start.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let payload: Record<string, unknown> | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const stage = JSON.parse(line) as { stage: string; message: string; data?: unknown };
      onStage(stage.message);
      if (stage.stage === "error") throw new Error(stage.message);
      if (stage.stage === "complete") payload = stage.data as Record<string, unknown>;
    }
  }

  if (!payload) throw new Error("The research run returned nothing. Nothing was changed.");

  const provenance = {
    provider: String(payload["provider"] ?? "unknown"),
    model: String(payload["model"] ?? "unknown"),
    checkedAt: String(payload["checkedAt"] ?? new Date().toISOString()),
  };
  const roadmapId = detail.roadmap.id;
  const label = detail.roadmap.subjectLabel;

  await roadmapIntel.saveResearch(
    intelContext,
    roadmapId,
    label,
    normalizeResearch(payload["research"], provenance),
    provenance,
  );

  const strategy = normalizeStrategy(payload["strategy"], provenance);
  await roadmapIntel.saveStrategy(intelContext, roadmapId, label, {
    ...strategy,
    provider: provenance.provider,
    model: provenance.model,
    generatedAt: provenance.checkedAt,
  });

  const candidates = normalizeMilestones(payload["milestones"], provenance);
  if (candidates.length > 0) {
    await roadmapIntel.replaceCandidates(intelContext, roadmapId, label, candidates);
  }
}
