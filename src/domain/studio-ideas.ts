import type { ContentBrief } from "./content-brief";

/** Ideas are explicitly marked early-stage manual briefs in the existing workspace store. */
export const STUDIO_IDEA_STRUCTURE =
  "Manual idea captured in Studio; narrative structure not chosen yet.";
export function isStudioIdea(brief: ContentBrief): boolean {
  return (
    brief.sourceOpportunityId === null && brief.spine.whyThisStructure === STUDIO_IDEA_STRUCTURE
  );
}
export function ideaBrief(
  organizationId: string,
  text: string,
  existing?: ContentBrief,
  kind: string = existing?.angle || "Topic idea",
): ContentBrief {
  const clean = text.trim();
  if (!clean) throw new Error("Write a thought before saving your idea.");
  if (clean.length > 12000) throw new Error("Keep this idea under 12,000 characters.");
  if (existing && (existing.organizationId !== organizationId || !isStudioIdea(existing)))
    throw new Error("This brief does not belong to this idea workspace.");
  return {
    ...(existing ?? {}),
    id: existing?.id ?? "",
    organizationId,
    coreIdea: clean,
    chosenTitle: clean.split(/\n/)[0]!.slice(0, 100),
    angle: kind,
    audienceLanguage: existing?.audienceLanguage ?? [],
    titleCandidates: existing?.titleCandidates ?? [],
    opening: existing?.opening ?? { firstParagraph: "", whyItEarnsParagraphTwo: "" },
    spine: {
      end: "",
      beginning: "",
      middle: [],
      landing: "",
      structureChoice: "other",
      whyThisStructure: STUDIO_IDEA_STRUCTURE,
    },
    seo: existing?.seo ?? { primaryLanguage: [], intent: "", evidenceRefs: [], overlapRisk: null },
    imagePlan: existing?.imagePlan ?? {
      images: [],
      because: "No image planned for this idea yet.",
    },
    sourceOpportunityId: null,
    state: "draft",
  };
}
