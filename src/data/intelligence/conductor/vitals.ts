/**
 * Vital signs, read from the suite. Deterministic and dull on purpose.
 *
 * Every reading is either counted from a room's own record (`observed`),
 * carried from a person's commitment (`decided`), computed from those two
 * (`derived`), or `unknown`. A sign nothing in the suite can answer is
 * reported as unknown with the instrument that would fix it, it is never
 * filled in with a zero, an average, or a plausible figure.
 */

import { dueState, isActive } from "@/domain/comms";
import type { EvidenceRef } from "@/domain/confidence";
import { isOpenProject } from "@/domain/projects";
import {
  VITAL_QUESTION_LABEL,
  VITAL_QUESTION_ORDER,
  VITAL_SIGNS,
  type BusinessFigure,
  type BusinessIntent,
  type BusinessVitals,
  type VitalArea,
  type VitalQuestion,
  type VitalReading,
  type VitalSignDefinition,
  type ValueBasis,
  type VitalStanding,
} from "@/domain/conductor";

import type { SuiteSnapshot } from "../derive";
import { readFigures } from "./figures";

const DAY = 86_400_000;

/** Which vital sign a decided goal is measured by, when one exists. */
export const GOAL_VITAL_KEY: Record<string, string> = {
  revenue: "recurring_revenue",
  qualified_pipeline: "qualified_prospects",
  retention: "retention",
  delivery_health: "blocked_delivery",
  client_satisfaction: "unanswered_relationships",
  utilization: "open_delivery",
  authority: "content_output",
  reliability: "system_reliability",
};

function computed(label: string): EvidenceRef {
  return { label, kind: "computed" };
}

function human(label: string): EvidenceRef {
  return { label, kind: "human" };
}

function daysOld(at: string | undefined, now: string): number {
  if (!at) return Number.POSITIVE_INFINITY;
  const a = new Date(at).getTime();
  const b = new Date(now).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((b - a) / DAY));
}

function countEvents(snapshot: SuiteSnapshot, names: string[], windowDays: number): number {
  const cutoff = new Date(snapshot.now).getTime() - windowDays * DAY;
  return snapshot.events.filter(
    (event) => names.includes(event.name) && new Date(event.occurredAt).getTime() >= cutoff,
  ).length;
}

interface ReadingDraft {
  key: string;
  standing: VitalStanding;
  /** Defaults to observed. Recorded and derived figures say otherwise. */
  basis?: ValueBasis;
  value?: number;
  statement: string;
  because: string;
  evidence: EvidenceRef[];
}

/** A sign nobody can answer. Said plainly, with the instrument that fixes it. */
function unknownReading(definition: VitalSignDefinition): ReadingDraft {
  return {
    key: definition.key,
    standing: "unknown",
    statement: `${definition.label} is not instrumented.`,
    because: definition.instrumentation,
    evidence: [],
  };
}

/**
 * Everything the suite can honestly say about the health of the business.
 *
 * Pure over the snapshot plus whatever a person has decided. The same inputs
 * always produce the same read, in the same order.
 */
export function readVitals(
  snapshot: SuiteSnapshot,
  intents: BusinessIntent[] = [],
  figures: BusinessFigure[] = [],
): BusinessVitals {
  const now = snapshot.now;
  const nowDate = new Date(now);
  const withheld = new Set(snapshot.withheld.map((row) => row.appId));
  const drafts = new Map<string, ReadingDraft>();

  const record = (draft: ReadingDraft) => drafts.set(draft.key, draft);

  /* ------------------------------------------------- creating demand */

  if (!withheld.has("scout")) {
    const live = snapshot.candidates.filter(
      (candidate) =>
        candidate.prospect.status === "qualified" ||
        candidate.prospect.status === "ready_for_comms",
    );
    record({
      key: "qualified_prospects",
      standing: live.length === 0 ? "at_risk" : live.length < 3 ? "watch" : "healthy",
      value: live.length,
      statement:
        live.length === 0
          ? "No company is currently qualified in Scout."
          : `${live.length} qualified compan${live.length === 1 ? "y is" : "ies are"} live in Scout.`,
      because:
        live.length === 0
          ? "Nothing downstream can convert what was never qualified."
          : "Counted from Scout's own record.",
      evidence: [human("Scout prospect record")],
    });

    const found = countEvents(snapshot, ["prospect.discovered", "contact.discovered"], 14);
    record({
      key: "sourcing_cadence",
      standing: found === 0 ? "at_risk" : found < 3 ? "watch" : "healthy",
      value: found,
      statement: `${found} new compan${found === 1 ? "y was" : "ies were"} found in the last 14 days.`,
      because: "Counted from discovery events in the shared record.",
      evidence: [computed("Activity record, last 14 days")],
    });
  }

  /* ----------------------------------------------- converting demand */

  if (!withheld.has("comms")) {
    const active = snapshot.relationships.filter(isActive);
    record({
      key: "live_conversations",
      standing: active.length === 0 ? "at_risk" : active.length < 3 ? "watch" : "healthy",
      value: active.length,
      statement:
        active.length === 0
          ? "No relationship is active in Comms."
          : `${active.length} relationship${active.length === 1 ? " is" : "s are"} active in Comms.`,
      because: "Counted from Comms' own record.",
      evidence: [human("Comms relationship record")],
    });

    const waiting = snapshot.relationships.filter((relationship) => {
      const state = dueState(relationship, nowDate);
      return state === "overdue" || state === "today";
    });
    record({
      key: "unanswered_relationships",
      standing: waiting.length === 0 ? "healthy" : waiting.length > 2 ? "at_risk" : "watch",
      value: waiting.length,
      statement:
        waiting.length === 0
          ? "Nobody is waiting on a reply from us."
          : `${waiting.length} person${waiting.length === 1 ? " is" : "s are"} waiting on us today or already overdue.`,
      because: "Derived from response and follow-up dates recorded in Comms.",
      evidence: [human("Comms reply and follow-up dates")],
    });
  }

  if (!withheld.has("roadmap")) {
    const open = snapshot.roadmaps.length;
    record({
      key: "open_opportunities",
      standing: open === 0 ? "at_risk" : open < 2 ? "watch" : "healthy",
      value: open,
      statement:
        open === 0 ? "No roadmap is open." : `${open} roadmap${open === 1 ? " is" : "s are"} open.`,
      because: "Counted from Roadmap's own record.",
      evidence: [human("Roadmap record")],
    });
  }

  /* ------------------------------------------------------- delivery */

  if (!withheld.has("projects")) {
    const open = snapshot.projects.filter(isOpenProject);
    record({
      key: "open_delivery",
      standing: "healthy",
      value: open.length,
      statement: `${open.length} project${open.length === 1 ? " is" : "s are"} open in Projects.`,
      because: "Counted from Projects' own record. Capacity itself is not instrumented.",
      evidence: [human("Projects delivery record")],
    });

    const blocked = open.filter((project) => project.state === "blocked");
    record({
      key: "blocked_delivery",
      standing: blocked.length === 0 ? "healthy" : blocked.length > 1 ? "at_risk" : "watch",
      value: blocked.length,
      statement:
        blocked.length === 0
          ? "No project is blocked."
          : `${blocked.length} project${blocked.length === 1 ? " is" : "s are"} blocked.`,
      because: "Read from the state a person set in Projects.",
      evidence: [human("Projects delivery record")],
    });
  }

  /* -------------------------------------------------- client health */

  if (!withheld.has("steward")) {
    const overdue = snapshot.steward.commitments.filter(
      (commitment) =>
        (commitment.status === "open" || commitment.status === "waiting") &&
        commitment.dueAt !== undefined &&
        new Date(commitment.dueAt).getTime() < nowDate.getTime(),
    );
    record({
      key: "overdue_commitments",
      standing: overdue.length === 0 ? "healthy" : overdue.length > 2 ? "at_risk" : "watch",
      value: overdue.length,
      statement:
        overdue.length === 0
          ? "No confirmed promise is overdue."
          : `${overdue.length} confirmed promise${overdue.length === 1 ? " is" : "s are"} past its date.`,
      because: "Counted from promises a person confirmed in Steward.",
      evidence: [human("Steward commitment record")],
    });
  }

  /* --------------------------------------------------- compounding */

  const published = countEvents(snapshot, ["content.published", "studio.work_completed"], 30);
  if (published > 0) {
    record({
      key: "content_output",
      standing: "healthy",
      value: published,
      statement: `${published} asset${published === 1 ? "" : "s"} published in the last 30 days.`,
      because: "Counted from publish events in the shared record.",
      evidence: [computed("Activity record, last 30 days")],
    });
  }

  const opsEvents = snapshot.opsActivities.filter((event) => daysOld(event.occurredAt, now) <= 14);
  if (opsEvents.length > 0) {
    const incidents = opsEvents.filter((event) => event.name.endsWith(".blocked")).length;
    record({
      key: "system_reliability",
      standing: incidents === 0 ? "healthy" : incidents > 2 ? "at_risk" : "watch",
      value: incidents,
      statement: `${incidents} Ops incident${incidents === 1 ? "" : "s"} recorded in the last 14 days.`,
      because: "Counted from what Ops wrote into the shared record.",
      evidence: [computed("Ops events, last 14 days")],
    });
  }

  /* ------------------------------------------- figures a person recorded */

  /*
   * Recorded last, deliberately: a number a person stands behind outranks
   * anything counted for the same sign, and runway is only ever arithmetic
   * over two figures they supplied.
   */
  for (const reading of readFigures(figures, now)) {
    record({
      key: reading.key,
      standing: reading.standing,
      basis: reading.basis,
      value: reading.value,
      statement: reading.statement,
      because: reading.because,
      evidence: reading.evidence,
    });
  }

  /* ------------------------------------------------------ assemble */

  const intentFor = (key: string) => intents.find((intent) => GOAL_VITAL_KEY[intent.kind] === key);

  const readings: VitalReading[] = VITAL_SIGNS.map((definition) => {
    const draft = drafts.get(definition.key) ?? unknownReading(definition);
    const intent = intentFor(definition.key);
    const decidedTarget = intent?.target;
    const basis: ValueBasis =
      draft.standing === "unknown" ? "unknown" : (draft.basis ?? "observed");

    /* A decided target can only worsen a standing, never flatter it. */
    let standing = draft.standing;
    if (
      decidedTarget !== undefined &&
      draft.value !== undefined &&
      standing !== "unknown" &&
      draft.value < decidedTarget
    ) {
      standing = draft.value < decidedTarget / 2 ? "at_risk" : "watch";
    }

    return {
      key: definition.key,
      definition,
      standing,
      basis,
      ...(draft.value !== undefined ? { value: draft.value } : {}),
      statement: draft.statement,
      because:
        decidedTarget !== undefined && draft.value !== undefined && draft.value < decidedTarget
          ? `${draft.because} You decided a target of ${decidedTarget} ${definition.unit}.`
          : draft.because,
      evidence: draft.evidence,
      ...(decidedTarget !== undefined ? { target: decidedTarget } : {}),
      critical: intent?.critical ?? false,
    };
  });

  const areas: VitalArea[] = VITAL_QUESTION_ORDER.map((question) => {
    const rows = readings.filter((reading) => reading.definition.question === question);
    return {
      question,
      label: VITAL_QUESTION_LABEL[question],
      standing: worstStanding(rows.map((row) => row.standing)),
      readings: rows,
    };
  });

  const critical = readings.filter((reading) => reading.critical);
  const standing = worstStanding(
    (critical.length > 0 ? critical : readings).map((reading) => reading.standing),
  );

  return {
    organizationId: snapshot.organizationId,
    areas,
    standing,
    unknownKeys: readings
      .filter((reading) => reading.standing === "unknown")
      .map((reading) => reading.key),
    generatedAt: now,
  };
}

/**
 * The worst thing true of a set of readings.
 *
 * `at_risk` beats `watch`, `watch` beats `healthy`, and `unknown` never
 * masquerades as health: an area with nothing but unknowns reads unknown.
 */
export function worstStanding(values: VitalStanding[]): VitalStanding {
  if (values.length === 0) return "unknown";
  if (values.includes("at_risk")) return "at_risk";
  if (values.includes("watch")) return "watch";
  if (values.includes("healthy")) return "healthy";
  return "unknown";
}

/** One reading, by key. */
export function vitalReading(vitals: BusinessVitals, key: string): VitalReading | undefined {
  for (const area of vitals.areas) {
    const found = area.readings.find((reading) => reading.key === key);
    if (found) return found;
  }
  return undefined;
}

/** Areas that read badly, worst first. Used to answer "where are we leaking?". */
export function troubledAreas(vitals: BusinessVitals): VitalArea[] {
  const rank: Record<VitalStanding, number> = { at_risk: 0, watch: 1, unknown: 2, healthy: 3 };
  return vitals.areas
    .filter((area) => area.standing === "at_risk" || area.standing === "watch")
    .sort((a, b) => rank[a.standing] - rank[b.standing]);
}

export type { VitalQuestion };
