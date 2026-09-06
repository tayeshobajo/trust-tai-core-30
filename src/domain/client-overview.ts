/**
 * The client Overview, composed.
 *
 * Overview owns nothing. It reads what each room already recorded and puts it
 * in the order a person actually asks: what needs me now, what is moving,
 * where are we taking them, what is happening in the relationship, what
 * commercial truth should I remember, what has changed.
 *
 * The two laws of the client page still hold here. A room that could not be
 * read is reported as unreadable, never as an empty healthy section, and an
 * absence is stated plainly rather than dressed as calm.
 */

import type { RelationshipWindow } from "@/data/clients/relationship-window";

import type { ApprovalRequest } from "./approvals";
import {
  isOpenApproval,
  isOpenProject,
  lastTouchLine,
  projectStateLabel,
  type RelationshipSnapshot,
  type ReviewCadence,
  type RoadmapOutcome,
  type RoomRead,
} from "./client-shell";
import type { ExecutionProject } from "./projects";

export type OverviewTone = "calm" | "attention" | "unknown";

/** One line in the executive strip. Never a score, never a big number. */
export interface OverviewSignal {
  key: "delivery" | "relationship" | "direction" | "commercial";
  label: string;
  line: string;
  note: string | null;
  tone: OverviewTone;
}

/** One real obligation. Absence produces no item at all. */
export interface AttentionItem {
  key: string;
  line: string;
  because: string | null;
}

export interface OverviewComposeInput {
  projects: RoomRead<ExecutionProject[]> | null;
  relationship: RoomRead<RelationshipSnapshot> | null;
  roadmap: RoomRead<RoadmapOutcome | null> | null;
  approvals: RoomRead<{ ready: false } | { ready: true; requests: ApprovalRequest[] }> | null;
  exchange: RelationshipWindow | null;
  cadence: ReviewCadence;
  commercialLine: string;
  now: Date;
  timeZone: string;
}

const READING = "Still reading";
const UNREADABLE = "Could not be read";

function signalFrom<T>(
  read: RoomRead<T> | null,
  key: OverviewSignal["key"],
  label: string,
  resolve: (value: T) => { line: string; note?: string | null; tone?: OverviewTone },
): OverviewSignal {
  if (read === null) return { key, label, line: READING, note: null, tone: "unknown" };
  if (!read.available) return { key, label, line: UNREADABLE, note: read.because, tone: "unknown" };
  const resolved = resolve(read.value);
  return {
    key,
    label,
    line: resolved.line,
    note: resolved.note ?? null,
    tone: resolved.tone ?? "calm",
  };
}

/** The four signals of the top band, always in this order. */
export function overviewSignals(input: OverviewComposeInput): OverviewSignal[] {
  const delivery = signalFrom(input.projects, "delivery", "Delivery", (projects) => {
    const open = projects.filter(isOpenProject);
    const blocked = open.find((project) => project.state === "blocked");
    if (blocked) {
      return {
        line: `${blocked.name} · blocked`,
        note: blocked.blockedBecause ?? null,
        tone: "attention" as const,
      };
    }
    const first = open[0];
    if (!first) {
      return {
        line: projects.length === 0 ? "No delivery work recorded" : "Nothing in flight",
        note: null,
      };
    }
    return {
      line: `${first.name} · ${projectStateLabel(first)}`,
      note: first.nextMove ?? first.currentWork ?? null,
    };
  });

  const relationship = signalFrom(input.relationship, "relationship", "Relationship", (snapshot) => {
    if (snapshot.people.length === 0) return { line: "No one tracked here yet", note: null };
    const owed = input.exchange?.people.find((person) => person.obligation)?.obligation ?? null;
    const lead = snapshot.lead;
    const line = lead
      ? `${lead.fullName} · ${lastTouchLine(lead.lastTouchAt, input.now, input.timeZone).toLowerCase()}`
      : lastTouchLine(snapshot.lastTouchAt, input.now, input.timeZone);
    if (snapshot.overdue > 0) {
      return {
        line,
        note: `${snapshot.overdue} follow-up${snapshot.overdue === 1 ? "" : "s"} past due`,
        tone: "attention" as const,
      };
    }
    return { line, note: owed?.action ?? null };
  });

  const direction = signalFrom(input.roadmap, "direction", "Direction", (outcome) => {
    if (!outcome) return { line: "No roadmap yet", note: null };
    const line = outcome.milestone
      ? `${outcome.milestone} · ${outcome.milestoneStateLabel ?? outcome.statusLabel}`
      : (outcome.destination ?? outcome.statusLabel);
    return {
      line,
      note:
        outcome.openDecisions > 0
          ? `${outcome.openDecisions} open decision${outcome.openDecisions === 1 ? "" : "s"}`
          : outcome.nextMove,
      tone: outcome.milestoneBlocked ? ("attention" as const) : ("calm" as const),
    };
  });

  const commercial: OverviewSignal = {
    key: "commercial",
    label: "Commercial",
    line: input.commercialLine,
    note: input.cadence.state === "none" ? input.cadence.renewalLine : input.cadence.line,
    tone: input.cadence.state === "overdue" || input.cadence.state === "due" ? "attention" : "calm",
  };

  return [delivery, relationship, direction, commercial];
}

/**
 * Only real obligations. Nothing is added to fill the rail, and a source that
 * could not be read is named so the emptiness is not mistaken for calm.
 */
export function attentionItems(input: OverviewComposeInput): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (input.cadence.state === "overdue" || input.cadence.state === "due") {
    items.push({ key: "review", line: input.cadence.line, because: "Owned by Clients" });
  }

  if (input.projects?.available) {
    for (const project of input.projects.value.filter(
      (project) => isOpenProject(project) && project.state === "blocked",
    )) {
      items.push({
        key: `project-${project.id}`,
        line: `${project.name} is blocked`,
        because: project.blockedBecause ?? "Owned by Projects",
      });
    }
  } else if (input.projects && !input.projects.available) {
    items.push({ key: "projects-unreadable", line: "Delivery could not be read", because: null });
  }

  if (input.relationship?.available) {
    for (const person of input.relationship.value.people.filter((person) => person.overdue)) {
      items.push({
        key: `person-${person.id}`,
        line: `${person.fullName} · follow-up past due`,
        because: person.nextAction ?? "Owned by Comms",
      });
    }
  }

  for (const person of input.exchange?.people ?? []) {
    const owed = person.obligation;
    if (!owed || (owed.urgency !== "now" && owed.urgency !== "soon")) continue;
    if (items.some((item) => item.key === `person-${person.relationshipId}`)) continue;
    items.push({
      key: `owed-${person.relationshipId}`,
      line: `${person.fullName} · ${owed.action}`,
      because: owed.whyNow,
    });
  }

  if (input.roadmap?.available && input.roadmap.value && input.roadmap.value.openDecisions > 0) {
    const count = input.roadmap.value.openDecisions;
    items.push({
      key: "roadmap-decisions",
      line: `${count} open decision${count === 1 ? "" : "s"} on the roadmap`,
      because: "Owned by Roadmap",
    });
  }

  if (input.approvals?.available && input.approvals.value.ready) {
    const open = input.approvals.value.requests.filter(isOpenApproval);
    if (open.length > 0) {
      items.push({
        key: "approvals",
        line: `${open.length} decision${open.length === 1 ? "" : "s"} waiting in Approvals`,
        because: "Owned by Approvals",
      });
    }
  }

  return items;
}

export const NOTHING_TO_DECIDE = "Nothing needs your decision right now.";
