/**
 * Stage one: observe.
 *
 * Deterministic, pure, and deliberately dull. This file counts and dates what
 * the suite already holds. It never interprets, never uses the word "risk",
 * and never calls a model. Everything downstream, hypotheses, recommendations
 * and the learning loop, rests on these rows, so a wrong reading here is a
 * wrong reading everywhere. When the evidence is not in the snapshot, no
 * observation is produced.
 */

import { dueState, isActive, DORMANT_AFTER_DAYS } from "@/domain/comms";
import type { EvidenceRef } from "@/domain/confidence";
import type { EntityRef } from "@/domain/entities";
import { isOpenProject, projectHealth, STALE_AFTER_DAYS } from "@/domain/projects";
import type { BusinessTheme, Observation } from "@/domain/intelligence-engine";

import { contextBlocks, opsEventsOf, type SuiteSnapshot } from "../derive";
import { deriveOpsSignals } from "../ops-signals";

const DAY = 86_400_000;

/** A prospect at one of these statuses is no longer live pipeline. */
const CLOSED_PROSPECT_STATUSES = new Set(["passed", "archived", "converted"]);

/** Pipeline thinner than this, with capacity free, is worth naming. */
export const THIN_PIPELINE_COUNT = 3;

/** No new company found for this long is a sourcing fact, not an opinion. */
export const STALE_SOURCING_DAYS = 21;

/** The same blocker this many times stops being an incident. */
export const RECURRING_BLOCKER_THRESHOLD = 2;

/** A roadmap untouched this long has stopped being a live direction. */
export const STALE_ROADMAP_DAYS = 21;

/** A room with records but no activity for this long reads as quiet. */
export const QUIET_ROOM_DAYS = 14;

/** Rooms whose cadence the engine watches in the shared activity record. */
const CADENCE_ROOMS: { appId: string; label: string }[] = [
  { appId: "scout", label: "Scout" },
  { appId: "comms", label: "Comms" },
  { appId: "roadmap", label: "Roadmap" },
  { appId: "projects", label: "Projects" },
  { appId: "steward", label: "Steward" },
  { appId: "ops", label: "Ops" },
];

function daysOld(at: string | undefined, now: string): number {
  if (!at) return 0;
  const a = new Date(at).getTime();
  const b = new Date(now).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.floor((b - a) / DAY));
}

function computed(label: string): EvidenceRef {
  return { label, kind: "computed" };
}

function human(label: string): EvidenceRef {
  return { label, kind: "human" };
}

interface Draft {
  kind: string;
  theme: BusinessTheme;
  statement: string;
  tier?: Observation["tier"];
  magnitude?: number;
  subject?: EntityRef;
  evidence: EvidenceRef[];
  contextRefs?: string[];
  sourceApps: string[];
  at?: string;
}

/**
 * Everything the engine can honestly say about the business right now.
 *
 * Pure over the snapshot: the same snapshot always yields the same rows, in
 * the same order, with the same ids.
 */
export function observeBusiness(snapshot: SuiteSnapshot): Observation[] {
  const now = snapshot.now;
  const nowDate = new Date(now);
  const knownRefs = new Set(contextBlocks(snapshot).map((block) => block.id));
  const drafts: Draft[] = [];

  /* ------------------------------------------------------------- capacity */

  const openProjects = snapshot.projects.filter(isOpenProject);
  const hasAnyoneToServe =
    snapshot.relationships.length > 0 ||
    snapshot.candidates.length > 0 ||
    snapshot.roadmaps.length > 0;

  if (openProjects.length === 0 && hasAnyoneToServe) {
    drafts.push({
      kind: "no_active_project",
      theme: "capacity",
      statement: "No project is open in Projects.",
      magnitude: 0,
      evidence: [human("Projects delivery record")],
      sourceApps: ["projects"],
    });
  } else if (openProjects.length > 0) {
    drafts.push({
      kind: "open_projects",
      theme: "capacity",
      statement: `${openProjects.length} project${openProjects.length === 1 ? " is" : "s are"} open in Projects.`,
      magnitude: openProjects.length,
      evidence: [human("Projects delivery record")],
      contextRefs: openProjects.map((p) => `projects:state:${p.id}`),
      sourceApps: ["projects"],
    });
  }

  /* ------------------------------------------------------------- delivery */

  let delayed = 0;
  for (const project of openProjects) {
    const health = projectHealth(project, nowDate);
    const idle = daysOld(project.lastMovedAt, now);
    if (health.level === "at_risk" || health.level === "needs_attention") {
      delayed += 1;
      drafts.push({
        kind: "project_delayed",
        theme: "delivery",
        statement: `${project.name} has not moved for ${idle} day${idle === 1 ? "" : "s"} and is ${project.state.replace(/_/g, " ")}.`,
        magnitude: idle,
        subject: { type: "project", id: project.id, label: project.name },
        evidence: [human("Projects delivery record")],
        contextRefs: [`projects:state:${project.id}`, `projects:health:${project.id}`],
        sourceApps: ["projects"],
        at: project.lastMovedAt,
      });
    }
    if (project.state === "blocked" && project.blockedBecause) {
      drafts.push({
        kind: "project_blocked",
        theme: "delivery",
        statement: `${project.name} is blocked: ${project.blockedBecause}`,
        subject: { type: "project", id: project.id, label: project.name },
        tier: "decided",
        evidence: [human("Recorded by a person in Projects")],
        contextRefs: [`projects:state:${project.id}`],
        sourceApps: ["projects"],
        at: project.lastMovedAt,
      });
    }
  }
  if (delayed > 0) {
    drafts.push({
      kind: "delivery_delay_count",
      theme: "delivery",
      statement: `${delayed} of ${openProjects.length} open project${openProjects.length === 1 ? "" : "s"} ${delayed === 1 ? "has" : "have"} gone longer than ${STALE_AFTER_DAYS} days without recorded movement, or is blocked.`,
      magnitude: delayed,
      evidence: [computed("Counted from the Projects record")],
      sourceApps: ["projects"],
    });
  }

  /* ------------------------------------------------------------- pipeline */

  const live = snapshot.candidates.filter(
    (candidate) => !CLOSED_PROSPECT_STATUSES.has(candidate.prospect.status),
  );
  const qualified = live.filter(
    (candidate) =>
      candidate.prospect.status === "qualified" ||
      candidate.prospect.status === "ready_for_comms",
  );
  const routedProspectIds = new Set(
    snapshot.relationships.map((r) => r.prospectId).filter((id): id is string => Boolean(id)),
  );

  drafts.push({
    kind: "pipeline_volume",
    theme: "pipeline",
    statement:
      live.length === 0
        ? "No live company is on the Scout board."
        : `${live.length} compan${live.length === 1 ? "y is" : "ies are"} live on the Scout board, ${qualified.length} of them qualified.`,
    magnitude: live.length,
    evidence: [human("Scout board")],
    contextRefs: live.map((c) => `scout:status:${c.prospect.id}`),
    sourceApps: ["scout"],
  });

  const newest = live
    .map((candidate) => candidate.prospect.createdAt)
    .sort()
    .at(-1);
  const sourcingAge = daysOld(newest, now);
  if (live.length > 0 && sourcingAge >= STALE_SOURCING_DAYS) {
    drafts.push({
      kind: "pipeline_sourcing_stale",
      theme: "pipeline",
      statement: `The newest company on the Scout board was found ${sourcingAge} days ago.`,
      magnitude: sourcingAge,
      evidence: [computed("Newest record on the Scout board")],
      sourceApps: ["scout"],
      ...(newest ? { at: newest } : {}),
    });
  }

  const unrouted = qualified.filter(
    (candidate) => !routedProspectIds.has(candidate.prospect.id),
  );
  if (unrouted.length > 0) {
    drafts.push({
      kind: "pipeline_unrouted",
      theme: "pipeline",
      statement: `${unrouted.length} qualified compan${unrouted.length === 1 ? "y has" : "ies have"} no relationship in Comms.`,
      magnitude: unrouted.length,
      tier: "decided",
      evidence: [human("Scout qualification")],
      contextRefs: unrouted.map((c) => `scout:status:${c.prospect.id}`),
      sourceApps: ["scout", "comms"],
    });
  }

  /* -------------------------------------------------------- follow-through */

  const overdueRelationships = snapshot.relationships.filter(
    (relationship) => dueState(relationship, nowDate) === "overdue",
  );
  if (overdueRelationships.length > 0) {
    drafts.push({
      kind: "reply_debt",
      theme: "follow_through",
      statement: `${overdueRelationships.length} relationship${overdueRelationships.length === 1 ? " is" : "s are"} past a date recorded in Comms.`,
      magnitude: overdueRelationships.length,
      tier: "decided",
      evidence: [human("Due dates recorded in Comms")],
      contextRefs: overdueRelationships.map((r) => `comms:stage:${r.id}`),
      sourceApps: ["comms"],
    });
  }

  const openCommitments = snapshot.steward.commitments.filter(
    (commitment) => commitment.status === "open" || commitment.status === "waiting",
  );
  const overdueCommitments = openCommitments.filter(
    (commitment) => commitment.dueAt && new Date(commitment.dueAt).getTime() < nowDate.getTime(),
  );
  if (overdueCommitments.length > 0) {
    drafts.push({
      kind: "commitment_overdue",
      theme: "follow_through",
      statement: `${overdueCommitments.length} promise${overdueCommitments.length === 1 ? "" : "s"} made in a conversation ${overdueCommitments.length === 1 ? "has" : "have"} passed the date a person set.`,
      magnitude: overdueCommitments.length,
      tier: "decided",
      evidence: [human("Dates set by a person in Steward")],
      contextRefs: overdueCommitments.map((c) => `steward-commitment-${c.id}`),
      sourceApps: ["steward"],
    });
  }

  if (snapshot.openDecisions.length > 0) {
    drafts.push({
      kind: "open_decisions",
      theme: "follow_through",
      statement: `${snapshot.openDecisions.length} decision${snapshot.openDecisions.length === 1 ? " is" : "s are"} waiting for an answer in Roadmap.`,
      magnitude: snapshot.openDecisions.length,
      evidence: [computed("Raised by Roadmap")],
      contextRefs: snapshot.openDecisions.map((d) => `roadmap:decision:${d.id}`),
      sourceApps: ["roadmap"],
    });
  }

  /* ---------------------------------------------------------- client risk */

  for (const relationship of snapshot.relationships) {
    if (!isActive(relationship)) continue;
    if (dueState(relationship, nowDate) !== "dormant") continue;
    const silence = daysOld(relationship.lastTouchAt ?? relationship.updatedAt, now);
    drafts.push({
      kind: "relationship_silent",
      theme: "client_risk",
      statement: `No contact with ${relationship.fullName}${relationship.companyName ? ` (${relationship.companyName})` : ""} for ${silence} days, while the relationship is still marked active.`,
      magnitude: silence,
      subject: { type: "relationship", id: relationship.id, label: relationship.fullName },
      evidence: [computed("Last logged touch in Comms")],
      contextRefs: [`comms:stage:${relationship.id}`],
      sourceApps: ["comms"],
      ...(relationship.lastTouchAt ? { at: relationship.lastTouchAt } : {}),
    });
  }

  /* ------------------------------------------------------------- friction */

  const blockerCounts = new Map<string, { count: number; at: string; label: string }>();
  for (const event of [...snapshot.events, ...snapshot.opsActivities]) {
    if (!/\.(blocked|flagged)$/.test(event.name)) continue;
    const label = event.subject.label ?? event.subject.id;
    const key = `${event.name}|${label.toLowerCase()}`;
    const seen = blockerCounts.get(key);
    blockerCounts.set(key, {
      count: (seen?.count ?? 0) + 1,
      at: seen && seen.at > event.occurredAt ? seen.at : event.occurredAt,
      label,
    });
  }
  for (const [key, seen] of [...blockerCounts.entries()].sort((a, b) => b[1].count - a[1].count)) {
    if (seen.count < RECURRING_BLOCKER_THRESHOLD) continue;
    drafts.push({
      kind: "recurring_blocker",
      theme: "friction",
      statement: `${seen.label} has been recorded as blocked or flagged ${seen.count} times.`,
      magnitude: seen.count,
      evidence: [computed(`Counted from the shared activity record (${key.split("|")[0]})`)],
      sourceApps: ["ops", "activity"],
      at: seen.at,
    });
  }

  /* ---------------------------------------------------------- opportunity */

  const strongUnreviewed = live.filter(
    (candidate) =>
      (candidate.prospect.status === "discovered" || candidate.prospect.status === "reviewing") &&
      candidate.evaluation.scoreable &&
      candidate.evaluation.score >= 70,
  );
  if (strongUnreviewed.length > 0) {
    drafts.push({
      kind: "strong_fit_unreviewed",
      theme: "opportunity",
      statement: `${strongUnreviewed.length} compan${strongUnreviewed.length === 1 ? "y reads" : "ies read"} as a strong ICP fit and ${strongUnreviewed.length === 1 ? "has" : "have"} not been reviewed.`,
      magnitude: strongUnreviewed.length,
      tier: "inferred",
      evidence: [computed("Deterministic ICP evaluator")],
      contextRefs: strongUnreviewed.map((c) => `scout:fit:${c.prospect.id}`),
      sourceApps: ["scout"],
    });
  }

  const inbound = snapshot.relationships.filter((r) => r.source === "inbound");
  if (inbound.length >= 2) {
    drafts.push({
      kind: "inbound_volume",
      theme: "opportunity",
      statement: `${inbound.length} relationships were recorded as inbound.`,
      magnitude: inbound.length,
      evidence: [human("Relationship source recorded in Comms")],
      contextRefs: inbound.map((r) => `comms:stage:${r.id}`),
      sourceApps: ["comms"],
    });
  }

  /* -------------------------------------------------------------- roadmap */

  const liveRoadmaps = snapshot.roadmaps.filter(
    (roadmap) => roadmap.status !== "archived" && roadmap.status !== "complete",
  );
  const undecided = liveRoadmaps.filter((roadmap) => roadmap.pointB === null);
  if (undecided.length > 0) {
    drafts.push({
      kind: "roadmap_direction_undecided",
      theme: "delivery",
      statement: `${undecided.length} roadmap${undecided.length === 1 ? " has" : "s have"} no decided destination in Roadmap.`,
      magnitude: undecided.length,
      evidence: [human("Roadmap destination record")],
      sourceApps: ["roadmap"],
    });
  }

  const staleRoadmaps = liveRoadmaps.filter(
    (roadmap) => daysOld(roadmap.updatedAt, now) >= STALE_ROADMAP_DAYS,
  );
  if (staleRoadmaps.length > 0) {
    const oldest = staleRoadmaps
      .map((roadmap) => daysOld(roadmap.updatedAt, now))
      .sort((a, b) => b - a)[0] ?? 0;
    drafts.push({
      kind: "roadmap_stale",
      theme: "delivery",
      statement: `${staleRoadmaps.length} live roadmap${staleRoadmaps.length === 1 ? " has" : "s have"} not been updated for at least ${oldest} days.`,
      magnitude: staleRoadmaps.length,
      evidence: [computed("Last update recorded in Roadmap")],
      sourceApps: ["roadmap"],
    });
  }

  /* ------------------------------------------------------------------ ops */

  const opsSignals = deriveOpsSignals(opsEventsOf(snapshot), now, snapshot.organizationId);
  const openOps = opsSignals.filter((signal) => signal.status !== "resolved");
  if (openOps.length > 0) {
    const first = openOps[0];
    drafts.push({
      kind: "ops_open_signal",
      theme: "friction",
      statement: `${openOps.length} technical signal${openOps.length === 1 ? " is" : "s are"} open in Ops${first ? `, the most urgent being: ${first.title}` : ""}.`,
      magnitude: openOps.length,
      evidence: [computed("Ops recorded in the shared activity record")],
      contextRefs: openOps.flatMap((signal) => signal.contextRefs),
      sourceApps: ["ops"],
      at: first?.at ?? now,
    });
  }

  /* --------------------------------------------------------- room cadence */

  const allEvents = [...snapshot.events, ...snapshot.opsActivities];
  const roomHasRecords: Record<string, boolean> = {
    scout: snapshot.candidates.length > 0,
    comms: snapshot.relationships.length > 0,
    roadmap: snapshot.roadmaps.length > 0,
    projects: snapshot.projects.length > 0,
    steward: snapshot.steward.conversations.length > 0,
    ops: snapshot.opsActivities.length > 0,
  };
  for (const room of CADENCE_ROOMS) {
    if (!roomHasRecords[room.appId]) continue;
    const last = allEvents
      .filter((event) => event.provenance.appId === room.appId)
      .map((event) => event.occurredAt)
      .sort()
      .at(-1);
    if (!last) continue;
    const quiet = daysOld(last, now);
    if (quiet < QUIET_ROOM_DAYS) continue;
    drafts.push({
      kind: "room_quiet",
      theme: "capacity",
      statement: `Nothing has been recorded in ${room.label} for ${quiet} days.`,
      magnitude: quiet,
      evidence: [computed("Shared activity record")],
      sourceApps: [room.appId, "activity"],
      at: last,
    });
  }

  const weekAgo = nowDate.getTime() - 7 * DAY;
  const recent = allEvents.filter((event) => new Date(event.occurredAt).getTime() >= weekAgo);
  if (allEvents.length > 0) {
    drafts.push({
      kind: "activity_volume",
      theme: "capacity",
      statement: `${recent.length} thing${recent.length === 1 ? " was" : "s were"} recorded across the suite in the last seven days.`,
      magnitude: recent.length,
      evidence: [computed("Shared activity record")],
      sourceApps: ["activity"],
    });
  }

  /* ----------------------------------------------------------- what we know */

  const recurringMemory = snapshot.memory.filter(
    (belief) =>
      !belief.meta.retired &&
      belief.meta.kind === "responsibility" &&
      (belief.meta.sourceConversationIds?.length ?? 0) > 0,
  );
  if (recurringMemory.length > 0) {
    drafts.push({
      kind: "memory_recurring_work",
      theme: "friction",
      statement: `${recurringMemory.length} recurring piece${recurringMemory.length === 1 ? "" : "s"} of work ${recurringMemory.length === 1 ? "is" : "are"} remembered from conversations.`,
      magnitude: recurringMemory.length,
      tier: "inferred",
      evidence: [computed("Steward memory, learned from repeated conversations")],
      sourceApps: ["steward"],
    });
  }

  const decidedMemory = snapshot.memory.filter(
    (belief) => !belief.meta.retired && belief.tier === "decided" && belief.authority === "human",
  );
  if (decidedMemory.length > 0) {
    drafts.push({
      kind: "memory_decided",
      theme: "follow_through",
      statement: `${decidedMemory.length} thing${decidedMemory.length === 1 ? " has" : "s have"} been decided by a person and are held as settled.`,
      magnitude: decidedMemory.length,
      tier: "decided",
      evidence: [human("Recorded by a person")],
      sourceApps: ["steward"],
    });
  }

  /* ------------------------------------------------------------ finalise */

  const counters = new Map<string, number>();
  return drafts.map((draft) => {
    const index = counters.get(draft.kind) ?? 0;
    counters.set(draft.kind, index + 1);
    return {
      id: `obs:${draft.kind}:${draft.subject?.id ?? index}`,
      theme: draft.theme,
      kind: draft.kind,
      statement: draft.statement,
      tier: draft.tier ?? "observed",
      ...(draft.magnitude === undefined ? {} : { magnitude: draft.magnitude }),
      ...(draft.subject ? { subject: draft.subject } : {}),
      evidence: draft.evidence,
      contextRefs: (draft.contextRefs ?? []).filter((ref) => knownRefs.has(ref)),
      sourceApps: draft.sourceApps,
      at: draft.at ?? now,
    } satisfies Observation;
  });
}

/** Days of silence after which a relationship reads as dormant. Re-exported for surfaces. */
export { DORMANT_AFTER_DAYS };
