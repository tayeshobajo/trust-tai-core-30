/**
 * Scout — adaptive prospect workspace contract.
 *
 * The prospect page does not render a fixed template. It composes surfaces
 * from the evidence actually held for that company. Everything here is a
 * contract: the selection itself is a pure function in
 * `src/data/prospect-modules.ts` so it can be reasoned about and tested
 * without rendering.
 *
 * Three tiers stay strictly separated and are never blended:
 *   fact       — read from a public page or computed by the evaluator
 *   inference  — Scout's read of what the facts might mean
 *   decision   — what a Trust Tai member actually decided
 */

import type { FitLight } from "./scout-fit";

/** One completed research pass, recorded so change over time is visible. */
export interface ResearchRun {
  at: string;
  /** `provenance.research_version` reported by the backend, when present. */
  version: number | null;
  score: number;
  light: FitLight;
  pages: number;
  evidenceCount: number;
  icpVersion: number | null;
  /** Criteria keys clearly met on that run. Drives the evidence delta. */
  metKeys: string[];
}

/** How much of the public website Scout has actually read. */
export interface ResearchCoverage {
  pages: number;
  /** Page kinds the backend confirmed it reached. */
  checked: { key: string; label: string; reached: boolean }[];
  /** 0–100. Null when the record cannot honestly report coverage. */
  percent: number | null;
  /** Plain-language note, e.g. "Team and contact pages were never reached". */
  note: string;
  thin: boolean;
}

/** What changed since the previous research pass. */
export interface SignalPulse {
  previous: ResearchRun;
  current: ResearchRun;
  scoreDelta: number;
  gained: string[];
  lost: string[];
  summary: string;
}

export type NextMoveAction = "qualify" | "research" | "people" | "handoff" | "review";

/** The single decision this page is asking for right now. */
export interface NextMove {
  action: NextMoveAction;
  headline: string;
  detail: string;
  /** Why this is the move, in the system's own words. */
  because: string;
}

export type ProspectModuleId =
  | "identity"
  | "next_move"
  | "fit_read"
  | "opportunity"
  | "people"
  | "handoff"
  | "coverage"
  | "pulse"
  | "observed"
  | "timeline";

export interface ProspectModule {
  id: ProspectModuleId;
  /** Which zone the surface belongs to. */
  zone: "decision" | "rail";
  /** Higher sorts first within its zone. */
  weight: number;
}

/** A surface that has nothing honest to say yet, collapsed to one line. */
export interface UnknownNote {
  id: ProspectModuleId;
  label: string;
  /** The action that would fill it. */
  fills: string;
}

export interface ProspectComposition {
  modules: ProspectModule[];
  unknown: UnknownNote[];
  nextMove: NextMove;
  coverage: ResearchCoverage;
  pulse: SignalPulse | null;
  history: ResearchRun[];
  /** True when the active ICP has moved on since this was scored. */
  needsRescore: boolean;
  /** Days since the evidence was last read, when known. */
  staleDays: number | null;
}
