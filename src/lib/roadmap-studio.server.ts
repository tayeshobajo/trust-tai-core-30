/**
 * Studio composition (server only).
 *
 * Studio is where approved thinking becomes client-facing language. It is
 * model-backed and evidence-bound, in two deliberate steps:
 *
 *   1. An explicit packet of approved truth is built from Decided strategy and
 *      approved milestones. If the packet cannot carry the argument, the run
 *      stops and says what is missing. Nothing is invented to fill the page.
 *   2. The model is asked to express only that packet: better words, better
 *      structure, a visual direction. Its output is then validated against the
 *      same packet, and any line or source that is not backed by it is refused.
 *
 * Keys never leave the server. With no provider configured the run fails
 * closed rather than falling back to template copy.
 */

import {
  buildEvidencePacket,
  hasFabrication,
  packetOutline,
  validateSections,
  type EvidencePacket,
  type ValidationResult,
} from "@/data/roadmap-studio-packet";
import type {
  ArtifactKind,
  ArtifactSection,
  RoadmapMilestone,
  RoadmapStrategy,
  SourceRef,
} from "@/domain/roadmap-intel";
import type { createLovableAiGatewayRunIdFetch } from "./ai-gateway.server";
import { callRoadmapProvider, requireRoadmapAccess } from "./roadmap-research.server";

export interface StudioStage {
  stage: "packet" | "writing" | "validating" | "complete" | "error";
  message: string;
  data?: unknown;
}

export interface StudioComposeInput {
  token: string;
  organizationId: string;
  kind: ArtifactKind;
  subjectLabel: string;
  strategy: RoadmapStrategy | null;
  milestones: RoadmapMilestone[];
  gateway?: ReturnType<typeof createLovableAiGatewayRunIdFetch> | undefined;
  initialRunId?: string | undefined;
}

export interface StudioComposeResult {
  sections: ArtifactSection[];
  rejected: ValidationResult["rejected"];
  provider: string;
  model: string;
  generatedAt: string;
}

/* --------------------------------------------------------------- prompting */

const VOICE = [
  "Voice: warm, calm, direct, first person where a person is speaking.",
  "Company native and industry fluent. Commercially intelligent, never salesy.",
  "Never use em dashes.",
  "No generic consulting or agency language, no visible formula, no tagline writing.",
  "Interpret familiar facts for what they mean commercially instead of repeating them.",
  "Every line must fail this test: could it belong to another company if the name changed? If it could, rewrite it from the approved evidence.",
  "Concise. Short paragraphs. Leadership should feel accurately understood.",
].join(" ");

function instructions(): string {
  return [
    "You write one client facing Roadmap document for Trust Tai and return json only.",
    "You are given an approved evidence packet. It is the only source of fact and strategy you have.",
    "You may improve expression, structure, ordering inside a page, and propose a visual direction.",
    "You may not introduce a new fact, figure, timeline, budget, commitment, market claim, or promised outcome.",
    "If the packet does not support a page, write that it is not ready rather than inventing it.",
    "Cite only source urls that appear in the packet.",
    VOICE,
  ].join(" ");
}

function payload(packet: EvidencePacket): string {
  return JSON.stringify({
    task: "Write this company's roadmap document from the approved packet only.",
    company: packet.subjectLabel,
    document: packet.kind === "full" ? "Full Roadmap" : "Roadmap Preview",
    pages: packetOutline(packet),
    approved_evidence: {
      central_truth: packet.centralTruth,
      point_a: packet.pointA,
      anchor_proof: packet.anchorProof,
      gaps: packet.gaps,
      leverage_point: packet.leveragePoint,
      point_b: packet.pointB,
      point_c: packet.pointC,
      milestones: packet.milestones,
    },
    citable_urls: packet.allowedUrls,
    json_shape: {
      sections: [
        {
          key: "matches a page key above",
          title: "",
          body: ["one paragraph per entry"],
          sources: [{ label: "", url: "", checked_at: "" }],
          visual_direction: "how this page should look, in one or two sentences",
          caption: "optional short caption",
          unlocks: ["milestone pages only: what it unlocks now", "and what it compounds into"],
        },
      ],
    },
  });
}

/* ----------------------------------------------------------------- parsing */

function sourcesFrom(value: unknown): SourceRef[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>;
      return {
        label: String(row["label"] ?? "Source"),
        url: String(row["url"] ?? ""),
        checkedAt: String(row["checked_at"] ?? row["checkedAt"] ?? new Date().toISOString()),
      };
    })
    .filter((ref) => /^https?:\/\//i.test(ref.url));
}

function sectionsFrom(value: unknown): ArtifactSection[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    const body = Array.isArray(row["body"])
      ? row["body"].map(String).filter(Boolean)
      : [String(row["body"] ?? "")].filter(Boolean);
    const visual = row["visual_direction"] ?? row["visualDirection"];
    return {
      key: String(row["key"] ?? row["title"] ?? "section"),
      title: String(row["title"] ?? ""),
      body,
      tier: "inferred" as const,
      sources: sourcesFrom(row["sources"]),
      ...(typeof visual === "string" && visual.trim() ? { visualDirection: visual.trim() } : {}),
      ...(typeof row["caption"] === "string" && row["caption"].trim()
        ? { caption: row["caption"].trim() }
        : {}),
      ...(Array.isArray(row["unlocks"]) ? { unlocks: row["unlocks"].map(String) } : {}),
    };
  });
}

/* --------------------------------------------------------------------- run */

export async function* runStudioComposition(
  input: StudioComposeInput,
): AsyncGenerator<StudioStage> {
  if (!(await requireRoadmapAccess(input.token, input.organizationId))) {
    yield { stage: "error", message: "You do not have access to this workspace." };
    return;
  }

  yield { stage: "packet", message: "Gathering approved strategy and approved milestones" };

  const packet = buildEvidencePacket({
    subjectLabel: input.subjectLabel,
    kind: input.kind,
    strategy: input.strategy,
    milestones: input.milestones,
  });

  if (!packet.ready) {
    yield {
      stage: "error",
      message: `This is not ready to compose yet. ${packet.missing.join(" ")}`,
      data: { missing: packet.missing },
    };
    return;
  }

  yield {
    stage: "writing",
    message: `Writing ${packet.kind === "full" ? "the full roadmap" : "the preview"} for ${input.subjectLabel}`,
  };

  let raw = "";
  let provider = "";
  let model = "";
  try {
    const result = await callRoadmapProvider(instructions(), payload(packet), {
      webSearch: false,
      gateway: input.gateway,
      initialRunId: input.initialRunId,
    });
    raw = result.raw;
    provider = result.provider;
    model = result.model;
  } catch (error) {
    yield { stage: "error", message: error instanceof Error ? error.message : String(error) };
    return;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    yield {
      stage: "error",
      message: "Studio could not read the composed document. Nothing was saved.",
    };
    return;
  }

  yield { stage: "validating", message: "Checking every line against the approved evidence" };

  const composed = sectionsFrom(parsed["sections"]);
  if (composed.length === 0) {
    yield { stage: "error", message: "The composition came back empty. Nothing was saved." };
    return;
  }

  const validated = validateSections(composed, packet);

  /**
   * A voice problem can be edited out. An invented figure or an uncited source
   * cannot: it means this run asserted something nobody approved, so the whole
   * composition is refused and nothing is saved.
   */
  if (hasFabrication(validated.rejected)) {
    const fabrications = validated.rejected.filter((entry) => entry.severity === "fabrication");
    yield {
      stage: "error",
      message: `This composition claimed ${fabrications.length === 1 ? "something" : `${fabrications.length} things`} the approved evidence does not support, so nothing was saved. ${fabrications[0]?.reason ?? ""}`.trim(),
      data: { rejected: fabrications },
    };
    return;
  }

  if (validated.sections.length === 0) {
    yield { stage: "error", message: "Nothing survived validation. Nothing was saved." };
    return;
  }

  const result: StudioComposeResult = {
    sections: validated.sections,
    rejected: validated.rejected,
    provider,
    model,
    generatedAt: new Date().toISOString(),
  };

  yield {
    stage: "complete",
    message:
      validated.rejected.length > 0
        ? `Composed. ${validated.rejected.length} lines were refused for lacking approved backing.`
        : "Composed. Every line is backed by approved evidence.",
    data: result,
  };
}
