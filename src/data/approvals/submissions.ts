/**
 * How each room asks for a decision.
 *
 * A source room knows its own work. It does not know how Approvals presents,
 * ranks or routes that work, and it should not have to. These builders are the
 * translation: plain facts in, a governed submission out, with the boundary,
 * the required capability and the reason a person is needed all made explicit
 * at the point of submission rather than guessed at later.
 *
 * Pure functions. Nothing here reads or writes a database.
 */

import type { EvidenceRef } from "@/domain/confidence";
import type { ApprovalItemState, ExceptionReason } from "@/domain/approvals";
import type { ApprovalSubmission } from "@/data/supabase/approvals-service";

/* ------------------------------------------------------------ Comms draft */

export interface CommsDraftInput {
  /** The draft being judged. Two drafts to one person are two decisions. */
  draftId?: string;
  relationshipId: string;
  personName: string;
  companyName?: string;
  channel: "email" | "linkedin" | "call";
  subject?: string;
  body: string;
  /** Why the agent wrote it this way, in plain language. */
  reasoning: string;
  /** What the agent could not settle on its own. */
  uncertainties?: string[];
  lastContactAt?: string;
  /** The provider thread this message would continue, when there is one. */
  threadId?: string;
  evidence?: EvidenceRef[];
}

export function commsDraftSubmission(input: CommsDraftInput): ApprovalSubmission {
  const unsure = input.uncertainties ?? [];
  return {
    sourceApp: "comms",
    category: "communication",
    approvalType: "comms_draft",
    title: `Message to ${input.personName}`,
    summary: input.subject ?? `${input.channel} draft prepared for ${input.personName}.`,
    whyItNeedsYou:
      unsure.length > 0
        ? unsure[0]!
        : "Nothing leaves Trust Tai in your name without you reading it first.",
    status: unsure.length > 0 ? "needs_review" : "ready",
    urgency: "soon",
    impact: "medium",
    sourceEntity: {
      type: "comms_relationship",
      id: input.relationshipId,
      label: input.personName,
    },
    requiredCapability: "comms.write",
    ...(input.draftId ? { aspect: `draft:${input.draftId}` } : {}),
    boundary: {
      willDo: ["Queue this message for sending from your account"],
      willNotDo: [
        "Send anything you have not read",
        "Change the relationship's status on its own",
        "Follow up automatically",
      ],
    },
    evidence: input.evidence ?? [],
    payload: {
      draftId: input.draftId ?? "",
      threadId: input.threadId ?? "",
      personName: input.personName,
      companyName: input.companyName ?? "",
      channel: input.channel,
      subject: input.subject ?? "",
      body: input.body,
      reasoning: input.reasoning,
      uncertainties: unsure,
      lastContactAt: input.lastContactAt ?? "",
    },
  };
}

/* ------------------------------------------------- Scout relationship */

export interface ScoutRelationshipInput {
  prospectId: string;
  companyName: string;
  personName?: string;
  roleTitle?: string;
  fitScore: number;
  fitReasons: string[];
  /** What is still unknown about the person or the fit. */
  gaps?: string[];
  evidence?: EvidenceRef[];
}

export function scoutRelationshipSubmission(input: ScoutRelationshipInput): ApprovalSubmission {
  const gaps = input.gaps ?? [];
  const person = input.personName ?? "the decision maker";
  return {
    sourceApp: "scout",
    category: "qualification",
    approvalType: "scout_relationship",
    title: `${input.companyName} looks worth knowing`,
    summary: `${person}${input.roleTitle ? `, ${input.roleTitle}` : ""}. Fit ${input.fitScore}/100.`,
    whyItNeedsYou:
      gaps.length > 0
        ? gaps[0]!
        : "Deciding who is worth a relationship is a judgment call, not a score threshold.",
    status: gaps.length > 0 ? "needs_context" : "ready",
    urgency: input.fitScore >= 80 ? "soon" : "whenever",
    impact: input.fitScore >= 80 ? "high" : "medium",
    sourceEntity: { type: "prospect", id: input.prospectId, label: input.companyName },
    requiredCapability: "scout.write",
    boundary: {
      willDo: ["Open a relationship in Comms and prepare a first message for your review"],
      willNotDo: ["Contact anyone", "Mark them a client", "Add them to any sequence"],
    },
    evidence: input.evidence ?? [],
    payload: {
      companyName: input.companyName,
      personName: input.personName ?? "",
      roleTitle: input.roleTitle ?? "",
      fitScore: input.fitScore,
      fitReasons: input.fitReasons,
      gaps,
    },
  };
}

/* --------------------------------------------------------- Content batch */

export interface BlogBatchItemInput {
  slug: string;
  title: string;
  state: ApprovalItemState;
  exceptionReasons?: ExceptionReason[];
  /** The canonical content item in Studio. The pointer, never a copy. */
  itemId?: string;
  hitScore?: number;
  wordCount?: number;
  imageState?: "ready" | "missing" | "placeholder";
  seoState?: "ready" | "thin" | "missing";
  excerpt?: string;
  unresolvedLinks?: number;
}


export interface BlogBatchInput {
  batchId: string;
  campaignName: string;
  items: BlogBatchItemInput[];
}

export function blogBatchSubmission(input: BlogBatchInput): ApprovalSubmission {
  const exceptions = input.items.filter((item) => item.state === "exception").length;
  const failed = input.items.filter((item) => item.state === "failed").length;
  return {
    sourceApp: "content",
    category: "marketing",
    approvalType: "blog_batch",
    title: `${input.campaignName}: ${input.items.length} posts`,
    summary: `${input.items.length - exceptions - failed} ready, ${exceptions} need review, ${failed} failed.`,
    whyItNeedsYou:
      exceptions > 0
        ? `${exceptions} posts fell below the bar the agent can clear on its own.`
        : "Publishing under the Trust Tai name is yours to authorise.",
    status: exceptions > 0 ? "needs_review" : "ready",
    urgency: "whenever",
    impact: "medium",
    sourceEntity: { type: "content_batch", id: input.batchId, label: input.campaignName },
    requiredCapability: "workspace.read",
    boundary: {
      willDo: ["Queue the posts you approve, in order"],
      willNotDo: [
        "Publish anything you skipped",
        "Publish the exceptions",
        "Change a post after you approve it",
      ],
    },
    payload: { campaignName: input.campaignName, batchId: input.batchId },
    items: input.items.map((item) => ({
      itemKey: item.slug,
      title: item.title,
      state: item.state,
      ...(item.exceptionReasons ? { exceptionReasons: item.exceptionReasons } : {}),
      facts: {
        hitScore: item.hitScore ?? null,
        wordCount: item.wordCount ?? null,
        imageState: item.imageState ?? "ready",
        seoState: item.seoState ?? "ready",
        excerpt: item.excerpt ?? "",
        unresolvedLinks: item.unresolvedLinks ?? 0,
        ...(item.itemId ? { contentItemId: item.itemId } : {}),
      },
      sourceEntity: item.itemId
        ? { type: "content_item", id: item.itemId, label: item.title }
        : { type: "blog_post", id: item.slug, label: item.title },
    })),

  };
}

/* -------------------------------------------------------- Roadmap change */

export interface RoadmapChangeInput {
  roadmapId: string;
  changeTitle: string;
  rationale: string;
  before: string;
  after: string;
  affects: string[];
  evidence?: EvidenceRef[];
  /** The open roadmap decision this proposal belongs to, when there is one. */
  decisionId?: string;
  /** Where the proposal came from, kept with the decision for later reading. */
  provenance?: Record<string, unknown>;
}

export function roadmapChangeSubmission(input: RoadmapChangeInput): ApprovalSubmission {
  return {
    sourceApp: "roadmap",
    category: "strategy",
    approvalType: "roadmap_change",
    title: input.changeTitle,
    summary: input.rationale,
    whyItNeedsYou: "Changing direction is a decision, and decisions carry a name.",
    status: "ready",
    urgency: "whenever",
    impact: "high",
    sourceEntity: { type: "roadmap", id: input.roadmapId, label: input.changeTitle },
    requiredCapability: "roadmap.decide",
    /* One roadmap can carry several open questions at once, so the decision,
       not the roadmap, is what makes this request itself. */
    ...(input.decisionId ? { aspect: `decision:${input.decisionId}` } : {}),
    boundary: {
      willDo: ["Record the change and your reasoning in the roadmap decision log"],
      willNotDo: ["Tell anyone", "Reschedule work", "Change a client commitment"],
    },
    evidence: input.evidence ?? [],
    payload: {
      before: input.before,
      after: input.after,
      rationale: input.rationale,
      affects: input.affects,
      ...(input.decisionId ? { decisionId: input.decisionId } : {}),
      ...(input.provenance ? { provenance: input.provenance } : {}),
    },
  };
}

/* ------------------------------------------------------- Delivery change */

export interface DeliveryChangeInput {
  projectId: string;
  projectName: string;
  clientName: string;
  change: string;
  reason: string;
  scheduleImpact?: string;
  costImpact?: string;
  clientVisible: boolean;
}

export function deliveryChangeSubmission(input: DeliveryChangeInput): ApprovalSubmission {
  return {
    sourceApp: "projects",
    category: "delivery",
    approvalType: "delivery_change",
    title: `${input.projectName}: ${input.change}`,
    summary: input.reason,
    whyItNeedsYou: input.clientVisible
      ? "The client will see this change, so it needs your name on it."
      : "This changes what was agreed internally.",
    status: "ready",
    urgency: input.clientVisible ? "now" : "soon",
    impact: input.clientVisible ? "high" : "medium",
    sourceEntity: { type: "project", id: input.projectId, label: input.projectName },
    requiredCapability: "projects.write",
    boundary: {
      willDo: ["Raise a change order on this project"],
      willNotDo: ["Tell the client", "Move any deadline", "Change an invoice"],
    },
    payload: {
      projectName: input.projectName,
      clientName: input.clientName,
      change: input.change,
      reason: input.reason,
      scheduleImpact: input.scheduleImpact ?? "",
      costImpact: input.costImpact ?? "",
      clientVisible: input.clientVisible,
    },
  };
}
