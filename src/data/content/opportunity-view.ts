/**
 * Studio's opportunity view.
 *
 * Pure formatting between the derived `StudioOpportunity` objects and what the
 * Studio room shows above its composer. It fetches nothing, writes nothing and
 * decides nothing.
 *
 * Three rules hold here, because the surface cannot restate them safely:
 *  - unknown is never a zero: an unreported metric reads "Not reported"
 *  - thin stays thin: a phrase under the demand floor is never promoted into a
 *    confident opportunity, and a window with no rows is "unread", not "none"
 *  - active rows and the quiet state are mutually exclusive, by construction
 */

import {
  OPPORTUNITY_ACTION_LABEL,
  type OpportunityAction,
  type OpportunityConfidence,
  type OpportunityDecisionState,
  type StudioOpportunity,
} from "@/domain/content-opportunity";
import type { ContentDemandReading } from "@/data/website/content-demand";

/** How many opportunities Studio will put in front of a person at once. */
export const MAX_VISIBLE_OPPORTUNITIES = 4;

export const QUIET_LINE = "Search data is too thin for a confident content opportunity right now.";
export const UNREAD_LINE =
  "Search Console has not reported for this window, so demand is unknown rather than absent.";

export const CONFIDENCE_LABEL: Record<OpportunityConfidence, string> = {
  observed: "Observed",
  supported: "Supported",
  thin: "Thin",
};

export interface OpportunityRowView {
  id: string;
  phrase: string;
  windowLabel: string;
  provenanceLabel: string;
  confidence: OpportunityConfidence;
  confidenceLabel: string;
  /** Studio's read. Deterministic, and labelled as Studio's read, not a model. */
  interpretation: string;
  /** Competing pages of our own, when the inventory says so. */
  overlap: string | null;
  impressions: string;
  clicks: string;
  ctr: string;
  averagePosition: string;
  move: OpportunityAction;
  moveLabel: string;
  /** False for `no_action`: there is nothing to build a brief from. */
  actionable: boolean;
  /** What a person already decided about this row. `open` until they do. */
  decisionState: OpportunityDecisionState;
  /** The path this demand lands on, when one was observed. */
  path: string | null;
}

export interface StudioOpportunitiesView {
  state: "unread" | "quiet" | "active";
  rows: OpportunityRowView[];
  /** The one sentence a quiet or unread state shows. Empty when active. */
  quietLine: string;
  /** Plain sentences explaining thin or unread data, shown as written. */
  because: string[];
}

const NOT_REPORTED = "Not reported";

export function formatCount(value: number | null): string {
  return value === null ? NOT_REPORTED : value.toLocaleString();
}

export function formatRate(value: number | null): string {
  return value === null ? NOT_REPORTED : `${(value * 100).toFixed(1)}%`;
}

export function formatPosition(value: number | null): string {
  return value === null ? NOT_REPORTED : value.toFixed(1);
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function day(iso: string): string {
  const [year, month, date] = iso.slice(0, 10).split("-").map(Number);
  if (!year || !month || !date) return iso.slice(0, 10);
  return `${date} ${MONTH[month - 1]}`;
}

/** The observed window, said plainly. Days with data, never days assumed. */
export function formatWindow(window: {
  start: string | null;
  end: string | null;
  daysWithData: number;
  read: boolean;
}): string {
  if (!window.read || !window.start || !window.end) return "No observed window";
  const days = `${window.daysWithData} day${window.daysWithData === 1 ? "" : "s"} with data`;
  return window.start === window.end
    ? `${day(window.start)} · ${days}`
    : `${day(window.start)} – ${day(window.end)} · ${days}`;
}

function toRow(opportunity: StudioOpportunity): OpportunityRowView {
  const conflict = opportunity.conflicts[0];
  return {
    id: opportunity.id,
    phrase: opportunity.subject.label,
    windowLabel: formatWindow(opportunity.observed.window),
    provenanceLabel: "Search Console",
    confidence: opportunity.confidence,
    confidenceLabel: CONFIDENCE_LABEL[opportunity.confidence],
    interpretation: opportunity.rationale,
    overlap: conflict ? `${conflict.detail} ${conflict.paths.join(", ")}`.trim() : null,
    impressions: formatCount(opportunity.observed.impressions),
    clicks: formatCount(opportunity.observed.clicks),
    ctr: formatRate(opportunity.observed.ctr),
    averagePosition: formatPosition(opportunity.observed.averagePosition),
    move: opportunity.action,
    moveLabel: OPPORTUNITY_ACTION_LABEL[opportunity.action],
    actionable: opportunity.action !== "no_action",
    decisionState: opportunity.decision.state,
    path: opportunity.observed.paths[0]?.path ?? null,
  };
}

/**
 * Fold derived opportunities into what Studio shows.
 *
 * Only opportunities that clear the existing demand floor are shown; thin ones
 * are left out rather than dressed up, and their absence produces the quiet
 * state instead of an empty list pretending to be a result.
 */
export function studioOpportunitiesView(
  demand: ContentDemandReading,
  opportunities: StudioOpportunity[],
  dismissed: readonly string[] = [],
): StudioOpportunitiesView {
  if (!demand.window.read) {
    return {
      state: "unread",
      rows: [],
      quietLine: UNREAD_LINE,
      because: demand.unknowns,
    };
  }

  const rows = opportunities
    .filter((opportunity) => opportunity.confidence !== "thin")
    .filter((opportunity) => opportunity.decision.state !== "dismissed")
    .filter((opportunity) => !dismissed.includes(opportunity.id))
    .sort((a, b) => (b.observed.impressions ?? 0) - (a.observed.impressions ?? 0))
    .slice(0, MAX_VISIBLE_OPPORTUNITIES)
    .map(toRow);

  if (rows.length === 0) {
    return { state: "quiet", rows: [], quietLine: QUIET_LINE, because: demand.because };
  }

  return { state: "active", rows, quietLine: "", because: [] };
}
