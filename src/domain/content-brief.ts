/**
 * The Content Brief and the Story Image Plan, as pure contracts.
 *
 * Contract only, on purpose. Nothing in Studio's current generation path
 * imports this yet, so today's prompts and today's output are unchanged. When
 * the brief step is built, the shapes are already agreed.
 *
 * Canon 28 lives in these types:
 *  - a title is a decision with a reason, not a keyword slot: every candidate
 *    names its familiar anchor, its fresh turn and the intent it serves;
 *  - the narrative default is End, Beginning, Middle, Landing, and choosing a
 *    different shape is allowed as long as the reason is written down;
 *  - an image has to earn its place: `jobInStory` says what is lost if it is
 *    removed, and a plan with nothing to lose is simply an empty plan.
 */

import type { ID, ISODateTime } from "./entities";

/* ---------------------------------------------------------------- titles */

export interface TitleCandidate {
  title: string;
  /** The part a reader already recognises. */
  familiarityAnchor: string;
  /** The turn that makes it worth reading anyway. */
  freshTurn: string;
  /** Why this fits what the reader was actually after. */
  intentFit: string;
}

/* ----------------------------------------------------------------- spine */

export type SpineShape = "end_first" | "other";

export interface NarrativeSpine {
  /** Where the reader ends up. Written first, deliberately. */
  end: string;
  beginning: string;
  middle: string[];
  landing: string;
  structureChoice: SpineShape;
  /** Required when the shape is not the default. */
  whyThisStructure: string;
}

/* ---------------------------------------------------------------- images */

export type StoryImageRole =
  | "hero"
  | "scene"
  | "evidence"
  | "contrast"
  | "metaphor"
  | "diagram";

export type StoryImageState = "planned" | "approved" | "generated" | "unavailable";

export interface StoryImage {
  id: string;
  role: StoryImageRole;
  /** What changes about the story if this image is removed. Required. */
  jobInStory: string;
  placement: "featured" | "after_section";
  /** Section anchor, when the placement is inside the article. */
  sectionAnchor?: string;
  /** The generation prompt, already inside the brand guardrails. */
  prompt: string;
  /** What the image communicates. Meaning, never keywords. */
  altText: string;
  state: StoryImageState;
  /** Set when the state is `unavailable`, naming what is missing. */
  because?: string;
}

/** Zero images is a legitimate plan, and it says so out loud. */
export interface StoryImagePlan {
  images: StoryImage[];
  /** Why this set, or why none. */
  because: string;
}

export const EMPTY_IMAGE_PLAN: StoryImagePlan = {
  images: [],
  because: "No image earns its place in this story.",
};

/** An image without a job is padding. Governance in code, not in a prompt. */
export function imageEarnsItsPlace(image: StoryImage): boolean {
  return image.jobInStory.trim().length > 0 && image.altText.trim().length > 0;
}

/** Drop the padding and say what was dropped. Never silently keep it. */
export function pruneImagePlan(plan: StoryImagePlan): {
  plan: StoryImagePlan;
  removed: StoryImage[];
} {
  const kept = plan.images.filter(imageEarnsItsPlace);
  const removed = plan.images.filter((image) => !imageEarnsItsPlace(image));
  if (kept.length === 0) return { plan: { ...EMPTY_IMAGE_PLAN }, removed };
  return { plan: { ...plan, images: kept }, removed };
}

/* ----------------------------------------------------------------- brief */

export interface BriefSeoEvidence {
  /** Observed phrasings, as people typed them. Evidence, not instructions. */
  primaryLanguage: string[];
  intent: string;
  /** Refs into the retrieval bundle the brief was reasoned over. */
  evidenceRefs: string[];
  /** Cannibalization or overlap with our own pages. Null when there is none. */
  overlapRisk: string | null;
}

export type ContentBriefState = "draft" | "approved" | "discarded";

export interface ContentBrief {
  id: string;
  organizationId: ID;
  coreIdea: string;
  angle: string;
  audienceLanguage: string[];
  titleCandidates: TitleCandidate[];
  /** The chosen title, once a person picks or writes one. */
  chosenTitle: string | null;
  opening: { firstParagraph: string; whyItEarnsParagraphTwo: string };
  spine: NarrativeSpine;
  seo: BriefSeoEvidence;
  imagePlan: StoryImagePlan;
  /** The opportunity this came from, when it came from one. */
  sourceOpportunityId: string | null;
  state: ContentBriefState;
  approvedBy?: ID;
  approvedAt?: ISODateTime;
}

/** Drafting may not start from a brief a person has not approved. */
export function briefIsDraftable(brief: ContentBrief): boolean {
  return brief.state === "approved" && Boolean(brief.approvedBy);
}
