/**
 * The client page, derived.
 *
 * A client page owns no state. Every line on it is read from the room that
 * already owns the truth (Roadmap, Projects, Comms, Approvals, Website) and
 * composed here without inference. Two rules hold on every line:
 *
 *   1. A source that could not be read is reported as unreadable. It is never
 *      shown as an empty, healthy section.
 *   2. Absence is never health. "No roadmap yet" is a fact; "healthy" would be
 *      a guess.
 *
 * Every calendar day here is a day in the organization's own timezone.
 */

import type { ApprovalRequest } from "./approvals";
import { OPEN_STATUSES, STATUS_LABEL as APPROVAL_STATUS_LABEL } from "./approvals";
import { localDaysBetween } from "./business-week";
import { formatDay, type ClientCard } from "./clients-book";
import type { Relationship } from "./comms";
import { STAGE_LABEL as RELATIONSHIP_STAGE_LABEL } from "./comms";
import type { ID, ISODateTime } from "./entities";
import type { ExecutionProject } from "./projects";
import { EXECUTION_STATE_LABEL } from "./projects";
import type { Roadmap, RoadmapDecision, RoadmapStage } from "./roadmap";
import { isActiveRoadmap, ROADMAP_STATUS_LABEL, STAGE_STATE_LABEL } from "./roadmap";

/* -------------------------------------------------------------------- tabs */

export type ClientTab = "overview" | "roadmap" | "projects" | "relationship" | "site" | "files";

/** Exactly these, in exactly this order. The shell has no other sections. */
export const CLIENT_TABS: ClientTab[] = [
  "overview",
  "roadmap",
  "projects",
  "relationship",
  "site",
  "files",
];

export const CLIENT_TAB_LABEL: Record<ClientTab, string> = {
  overview: "Overview",
  roadmap: "Roadmap",
  projects: "Projects",
  relationship: "Relationship",
  site: "Site",
  files: "Files",
};

/** Anything unrecognised opens Overview. A bad link never opens a blank tab. */
export function parseClientTab(value: unknown): ClientTab {
  return typeof value === "string" && (CLIENT_TABS as string[]).includes(value)
    ? (value as ClientTab)
    : "overview";
}

/* ------------------------------------------------------------- room reads */

/**
 * What an owning room said, or the fact that it could not be asked. The two
 * are kept apart on purpose: a failed read is an unknown, never a zero.
 */
export type RoomRead<T> = { available: true; value: T } | { available: false; because: string };

export function answered<T>(value: T): RoomRead<T> {
  return { available: true, value };
}

export function unreadable<T>(because: string): RoomRead<T> {
  return { available: false, because };
}

/* ------------------------------------------------------------------ header */

export interface ClientHeaderFacts {
  /** `Run · $3,500/mo`, `Build · $12,000`, `No tier · value not recorded`. */
  tierAndValue: string;
  /** `Next review Sep 19`, `Review overdue since Aug 20`, `No review scheduled`. */
  nextReview: string;
  /** `Renews Oct 3` or `No renewal date recorded`. */
  renewal: string;
  reviewOverdue: boolean;
}

export function clientHeaderFacts(
  card: ClientCard,
  now: Date,
  timeZone: string,
): ClientHeaderFacts {
  const reviewDays = card.nextReviewAt ? localDaysBetween(now, card.nextReviewAt, timeZone) : null;
  const reviewOverdue = reviewDays !== null && reviewDays < 0;
  const nextReview = card.nextReviewAt
    ? reviewOverdue
      ? `Review overdue since ${formatDay(card.nextReviewAt, timeZone)}`
      : `Next review ${formatDay(card.nextReviewAt, timeZone)}`
    : "No review scheduled";
  const renewal = card.renewalAt
    ? `Renews ${formatDay(card.renewalAt, timeZone)}`
    : "No renewal date recorded";
  return { tierAndValue: card.commercialLine, nextReview, renewal, reviewOverdue };
}

/* --------------------------------------------------------- review cadence */

export type ReviewCadenceState = "overdue" | "due" | "booked" | "none";

export interface ReviewCadence {
  state: ReviewCadenceState;
  line: string;
  renewalLine: string;
}

/** Due inside this many days counts as "due". Mirrors the book's rule. */
const REVIEW_DUE_WINDOW_DAYS = 7;

export function reviewCadenceFor(
  record: { nextReviewAt: ISODateTime | null; renewalAt: ISODateTime | null },
  now: Date,
  timeZone: string,
): ReviewCadence {
  const renewalLine = record.renewalAt
    ? `Renews ${formatDay(record.renewalAt, timeZone)}`
    : "No renewal date recorded";
  if (!record.nextReviewAt) {
    return { state: "none", line: "No review scheduled", renewalLine };
  }
  const days = localDaysBetween(now, record.nextReviewAt, timeZone);
  const day = formatDay(record.nextReviewAt, timeZone);
  if (days === null) return { state: "none", line: "No review scheduled", renewalLine };
  if (days < 0) return { state: "overdue", line: `Review overdue since ${day}`, renewalLine };
  if (days === 0) return { state: "due", line: "Review due today", renewalLine };
  if (days <= REVIEW_DUE_WINDOW_DAYS) {
    return {
      state: "due",
      line: `Review due ${day} · in ${days} day${days === 1 ? "" : "s"}`,
      renewalLine,
    };
  }
  return { state: "booked", line: `Next review ${day}`, renewalLine };
}

/* ----------------------------------------------------------------- roadmap */

export interface RoadmapOutcome {
  roadmapId: ID;
  title: string;
  statusLabel: string;
  active: boolean;
  /** Point B as Roadmap wrote it. Inferred until a person approved it. */
  destination: string | null;
  destinationTier: "inferred" | "decided" | null;
  /** The stage that is moving right now, or the next one mapped. */
  milestone: string | null;
  milestoneStateLabel: string | null;
  milestoneBlocked: boolean;
  nextMove: string | null;
  openDecisions: number;
  stagesLive: number;
  stagesTotal: number;
}

/** The roadmap that speaks for a client: the active one moved most recently. */
export function roadmapForClient(roadmaps: Roadmap[], clientId: ID): Roadmap | null {
  const mine = roadmaps.filter((roadmap) => roadmap.clientId === clientId);
  if (mine.length === 0) return null;
  const byRecency = (a: Roadmap, b: Roadmap) => b.updatedAt.localeCompare(a.updatedAt);
  const active = mine.filter(isActiveRoadmap).sort(byRecency);
  return active[0] ?? [...mine].sort(byRecency)[0] ?? null;
}

/** Every roadmap about a client, most recently moved first. */
export function roadmapsForClient(roadmaps: Roadmap[], clientId: ID): Roadmap[] {
  return roadmaps
    .filter((roadmap) => roadmap.clientId === clientId)
    .sort((a, b) => {
      const aActive = isActiveRoadmap(a) ? 0 : 1;
      const bActive = isActiveRoadmap(b) ? 0 : 1;
      return aActive - bActive || b.updatedAt.localeCompare(a.updatedAt);
    });
}

/**
 * The stage a person would call "the milestone": a blocked stage always wins,
 * then whatever is in build, then the next mapped stage. All live means done.
 */
export function currentStage(stages: RoadmapStage[]): RoadmapStage | null {
  return (
    stages.find((stage) => stage.state === "blocked") ??
    stages.find((stage) => stage.state === "in_build") ??
    stages.find((stage) => stage.state === "mapped") ??
    null
  );
}

export function roadmapOutcomeFor(
  roadmap: Roadmap,
  stages: RoadmapStage[],
  openDecisions: RoadmapDecision[],
): RoadmapOutcome {
  const stage = currentStage(stages);
  return {
    roadmapId: roadmap.id,
    title: roadmap.title,
    statusLabel: ROADMAP_STATUS_LABEL[roadmap.status],
    active: isActiveRoadmap(roadmap),
    destination: roadmap.pointB?.statement ?? null,
    destinationTier: roadmap.pointB?.tier ?? null,
    milestone: stage?.title ?? null,
    milestoneStateLabel: stage ? STAGE_STATE_LABEL[stage.state] : null,
    milestoneBlocked: stage?.state === "blocked",
    nextMove: roadmap.nextMove?.action ?? null,
    openDecisions: openDecisions.filter((decision) => decision.roadmapId === roadmap.id).length,
    stagesLive: stages.filter((stage) => stage.state === "live").length,
    stagesTotal: stages.length,
  };
}

/* ---------------------------------------------------------------- projects */

/** Blocked work first, then what moved most recently. */
export function projectsForClient(projects: ExecutionProject[], clientId: ID): ExecutionProject[] {
  return projects
    .filter((project) => project.clientId === clientId)
    .sort((a, b) => {
      const aBlocked = a.state === "blocked" ? 0 : 1;
      const bBlocked = b.state === "blocked" ? 0 : 1;
      return aBlocked - bBlocked || b.lastMovedAt.localeCompare(a.lastMovedAt);
    });
}

export function projectStateLabel(project: ExecutionProject): string {
  return EXECUTION_STATE_LABEL[project.state];
}

/** Work still in someone's hands. Delivered and closed work has left the line. */
export function isOpenProject(project: ExecutionProject): boolean {
  return project.state !== "delivered" && project.state !== "closed";
}

/* ------------------------------------------------------------ relationship */

export interface RelationshipPerson {
  id: ID;
  fullName: string;
  stageLabel: string;
  lastTouchAt: ISODateTime | null;
  nextAction: string | null;
  /** A response or follow-up whose day has passed. */
  overdue: boolean;
}

export interface RelationshipSnapshot {
  people: RelationshipPerson[];
  /** The person the relationship is most alive with, by last touch. */
  lead: RelationshipPerson | null;
  lastTouchAt: ISODateTime | null;
  overdue: number;
}

function isPast(iso: ISODateTime | undefined, now: Date, timeZone: string): boolean {
  if (!iso) return false;
  const days = localDaysBetween(now, iso, timeZone);
  return days !== null && days < 0;
}

export function relationshipSnapshotFor(
  relationships: Relationship[],
  clientId: ID,
  now: Date,
  timeZone: string,
): RelationshipSnapshot {
  const people: RelationshipPerson[] = relationships
    .filter((relationship) => relationship.clientId === clientId)
    .map((relationship) => ({
      id: relationship.id,
      fullName: relationship.fullName,
      stageLabel: RELATIONSHIP_STAGE_LABEL[relationship.stage],
      lastTouchAt: relationship.lastTouchAt ?? null,
      nextAction: relationship.nextAction?.trim() || null,
      overdue:
        isPast(relationship.responseDueAt, now, timeZone) ||
        isPast(relationship.followUpDueAt, now, timeZone),
    }))
    .sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      return (
        (b.lastTouchAt ?? "").localeCompare(a.lastTouchAt ?? "") ||
        a.fullName.localeCompare(b.fullName)
      );
    });

  /* The lead is whoever was touched last, whatever the list order says. */
  const touched = people
    .filter((person) => person.lastTouchAt)
    .sort((a, b) => (b.lastTouchAt ?? "").localeCompare(a.lastTouchAt ?? ""));
  const lead = touched[0] ?? people[0] ?? null;
  return {
    people,
    lead,
    lastTouchAt: touched[0]?.lastTouchAt ?? null,
    overdue: people.filter((person) => person.overdue).length,
  };
}

/** `Last touch Sep 1`, `Last touch today`, or the honest absence. */
export function lastTouchLine(iso: ISODateTime | null, now: Date, timeZone: string): string {
  if (!iso) return "No touch recorded";
  const days = localDaysBetween(now, iso, timeZone);
  if (days === 0) return "Last touch today";
  if (days === -1) return "Last touch yesterday";
  return `Last touch ${formatDay(iso, timeZone)}`;
}

/* --------------------------------------------------------------- approvals */

export interface ClientApprovalLinks {
  clientId: ID;
  roadmapIds: ID[];
  projectIds: ID[];
  relationshipIds: ID[];
}

/** Every canonical id a decision about this client could have been filed under. */
export function approvalEntityIds(links: ClientApprovalLinks): ID[] {
  return Array.from(
    new Set([links.clientId, ...links.roadmapIds, ...links.projectIds, ...links.relationshipIds]),
  );
}

const ROADMAP_TYPES = new Set(["roadmap", "roadmap_change", "milestone"]);
const PROJECT_TYPES = new Set(["project"]);
const RELATIONSHIP_TYPES = new Set(["comms_relationship", "relationship"]);

/**
 * Decisions that belong to this client, matched on canonical ids only. A
 * request whose source entity is not one of this client's roadmaps, projects
 * or relationships is never claimed, however its title reads.
 */
export function approvalsForClient(
  requests: ApprovalRequest[],
  links: ClientApprovalLinks,
): ApprovalRequest[] {
  const roadmaps = new Set(links.roadmapIds);
  const projects = new Set(links.projectIds);
  const relationships = new Set(links.relationshipIds);
  return requests.filter((request) => {
    const { type, id } = request.sourceEntity;
    if (type === "client") return id === links.clientId;
    if (ROADMAP_TYPES.has(type)) return roadmaps.has(id);
    if (PROJECT_TYPES.has(type)) return projects.has(id);
    if (RELATIONSHIP_TYPES.has(type)) return relationships.has(id);
    return false;
  });
}

export function isOpenApproval(request: ApprovalRequest): boolean {
  return OPEN_STATUSES.includes(request.status);
}

export function approvalStatusLabel(request: ApprovalRequest): string {
  return APPROVAL_STATUS_LABEL[request.status];
}

/* ------------------------------------------------------------ site, files */

/**
 * Website records carry no client link today, so no site can be claimed for a
 * client. Said plainly; never shown as a healthy site.
 */
export const SITE_UNLINKED = "No site record linked yet";
export const SITE_UNLINKED_BECAUSE =
  "Website submissions and analytics are not yet attached to a client record, so nothing here can be read for this company.";

/** There is no file store on a client yet. Nothing is faked to fill the tab. */
export const FILES_NONE = "No files linked yet";
export const FILES_NONE_BECAUSE =
  "Files will attach to a client once a store exists for them. Until then, nothing is listed here.";
