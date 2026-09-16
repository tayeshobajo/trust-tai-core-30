/**
 * Turning real results into relevant demand, honestly.
 *
 * Studio may prepare a content brief from results a person deliberately
 * approved for that use. Nothing here assumes permission to name a client,
 * publish anything, or claim that a piece of content earned revenue.
 */

import type { ID, ISODateTime } from "./entities";
import type { OutcomeReview } from "./client-care";

/* --------------------------------------------------- approved material */

export interface ApprovedLesson {
  id: string;
  clientRef: string;
  /** The lesson in the words a person approved. */
  text: string;
  approvedBy: ID;
  approvedAt: ISODateTime;
  /** Explicit permission for this material to appear in outward content. */
  contentUseApproved: boolean;
  /** Separate again: may the client be named. Default is no. */
  clientNamingApproved: boolean;
  evidenceRef?: string;
}

export interface ContentBriefRequest {
  organizationId: ID;
  clientRef: string;
  audience: string;
  goal: string;
  lessons: ApprovedLesson[];
  review?: OutcomeReview;
  requestedBy: ID;
  requestedAt: ISODateTime;
}

export interface PreparedContentBrief {
  key: string;
  organizationId: ID;
  audience: string;
  goal: string;
  /** Each line with the lesson it came from. */
  points: { text: string; fromLessonId: string; evidenceRef?: string }[];
  sourceRefs: string[];
  /** Whether the client may be named in the finished piece. */
  clientMayBeNamed: boolean;
  /** Always false here. Publication is approved elsewhere, by a person. */
  publicationApproved: false;
  excluded: string[];
  preparedBy: ID;
  preparedAt: ISODateTime;
}

export type ContentBriefOutcome =
  | { prepared: true; brief: PreparedContentBrief }
  | { prepared: false; because: string; excluded: string[] };

/**
 * Prepare a brief from approved lessons only. Anything belonging to another
 * client, or not approved for content use, is left out and said so.
 */
export function prepareContentBrief(request: ContentBriefRequest): ContentBriefOutcome {
  const excluded: string[] = [];
  const usable: ApprovedLesson[] = [];

  for (const lesson of request.lessons) {
    if (lesson.clientRef !== request.clientRef) {
      excluded.push(`${lesson.id} belongs to another client and was left out.`);
      continue;
    }
    if (!lesson.contentUseApproved) {
      excluded.push(`${lesson.id} has not been approved for use in content.`);
      continue;
    }
    if (!lesson.text.trim()) {
      excluded.push(`${lesson.id} has no recorded wording.`);
      continue;
    }
    usable.push(lesson);
  }

  if (!request.audience.trim() || !request.goal.trim()) {
    return {
      prepared: false,
      because: "A brief needs both who it is for and what it is meant to do.",
      excluded,
    };
  }
  if (usable.length === 0) {
    return {
      prepared: false,
      because: "No approved lesson from this client is available for content.",
      excluded,
    };
  }

  const clientMayBeNamed = usable.every((lesson) => lesson.clientNamingApproved);
  if (!clientMayBeNamed) {
    excluded.push("The client may not be named, so the brief is written without identifying them.");
  }

  const points = usable.map((lesson) => ({
    text: lesson.text,
    fromLessonId: lesson.id,
    ...(lesson.evidenceRef ? { evidenceRef: lesson.evidenceRef } : {}),
  }));

  const sourceRefs = [
    ...usable.map((lesson) => lesson.evidenceRef).filter((ref): ref is string => Boolean(ref)),
    ...(request.review?.observed.evidenceRef ? [request.review.observed.evidenceRef] : []),
  ];

  if (request.review && !request.review.attributedValue) {
    excluded.push("No value has been attributed to this result, so the brief does not claim one.");
  }

  return {
    prepared: true,
    brief: {
      key: `${request.clientRef}::content-brief::${request.requestedAt}`,
      organizationId: request.organizationId,
      audience: request.audience,
      goal: request.goal,
      points,
      sourceRefs,
      clientMayBeNamed,
      publicationApproved: false,
      excluded,
      preparedBy: request.requestedBy,
      preparedAt: request.requestedAt,
    },
  };
}

/* ------------------------------------------------------- attribution */

export interface IntakeAttributionEvidence {
  /** For example a referrer, a campaign parameter, or what the person wrote. */
  kind: "referrer" | "campaign_parameter" | "stated_by_person" | "link_token";
  value: string;
  observedAt: ISODateTime;
}

export type AttributionLink =
  | {
      linked: true;
      contentRef: string;
      evidence: IntakeAttributionEvidence[];
      /** Never revenue. This says where they came from, nothing more. */
      claim: string;
    }
  | { linked: false; because: string };

/**
 * Link an enquiry to content only where the enquiry itself carried evidence of
 * it. Timing alone is not evidence, and no revenue is attributed here.
 */
export function attributeEnquiry(input: {
  contentRef: string;
  enquiryEvidence: IntakeAttributionEvidence[];
  /** Tokens or campaign values that actually belong to this piece. */
  knownMarkers: string[];
}): AttributionLink {
  const markers = input.knownMarkers.map((marker) => marker.toLowerCase());
  const matching = input.enquiryEvidence.filter((evidence) =>
    markers.some((marker) => evidence.value.toLowerCase().includes(marker)),
  );
  if (matching.length === 0) {
    return {
      linked: false,
      because: "The enquiry carried nothing that points at this content, so no link is claimed.",
    };
  }
  return {
    linked: true,
    contentRef: input.contentRef,
    evidence: matching,
    claim: `The enquiry arrived carrying ${matching.map((item) => item.kind).join(", ")} for this content. It does not say the content caused any revenue.`,
  };
}

/* ------------------------------------------- care to next roadmap */

export interface NextRoadmapHandoff {
  key: string;
  clientRef: string;
  fromReviewOf: string;
  openQuestions: string[];
  ownerId: ID;
  recordedAt: ISODateTime;
}

export type NextRoadmapOutcome =
  | { opened: true; handoff: NextRoadmapHandoff; alreadyExisted: boolean }
  | { opened: false; because: string };

/**
 * A finished review can open the next roadmap conversation, once, with an
 * owner. Retrying returns the first one.
 */
export function openNextRoadmap(input: {
  review: OutcomeReview;
  ownerId: ID;
  at: ISODateTime;
  existing?: NextRoadmapHandoff[];
}): NextRoadmapOutcome {
  const key = `${input.review.clientRef}::roadmap::${input.review.observed.key}`;
  const existing = (input.existing ?? []).find((handoff) => handoff.key === key);
  if (existing) return { opened: true, handoff: existing, alreadyExisted: true };
  if (!input.ownerId.trim()) {
    return { opened: false, because: "A next roadmap needs a named owner." };
  }
  if (input.review.targetReached === null) {
    return {
      opened: false,
      because: "The review has no confirmed result yet, so there is nothing to plan from.",
    };
  }
  return {
    opened: true,
    alreadyExisted: false,
    handoff: {
      key,
      clientRef: input.review.clientRef,
      fromReviewOf: input.review.observed.key,
      openQuestions: input.review.notes,
      ownerId: input.ownerId,
      recordedAt: input.at,
    },
  };
}
