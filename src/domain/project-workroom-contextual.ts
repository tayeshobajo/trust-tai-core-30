/**
 * What the Project workroom shows by default, and what it keeps behind a door.
 *
 * Projects is where delivery is run, not a console for every internal concept.
 * Blockers, decision requests and specialist routing are real capabilities and
 * they stay reachable, but a person should only meet them when there is either
 * real state to read or an explicit intent to record something. Nothing that
 * has no state and no intent occupies the page.
 */

export const CONTEXTUAL_PANELS = ["blocker", "decision", "route"] as const;

export type ContextualPanel = (typeof CONTEXTUAL_PANELS)[number];

/**
 * hidden — no state, nobody asked: only the small doorway is offered.
 * state  — there is real state, so it is shown concisely, without a form.
 * form   — a person asked to record something, so the full path is open.
 */
export type PanelVisibility = "hidden" | "state" | "form";

export function panelVisibility(input: {
  /** How many live things of this kind exist (open blockers, routes, and so on). */
  active: number;
  /** How many things of this kind exist at all, live or settled. */
  recorded?: number;
  /** The panel the person explicitly opened, if any. */
  opened: ContextualPanel | null;
  /** Which panel this is. */
  panel: ContextualPanel;
}): PanelVisibility {
  if (input.opened === input.panel) return "form";
  if (input.active > 0 || (input.recorded ?? 0) > 0) return "state";
  return "hidden";
}

export function isPanelOpen(visibility: PanelVisibility): boolean {
  return visibility !== "hidden";
}

/** The doorway is always offered, so no capability becomes unreachable. */
export const PANEL_DOORWAY: Record<ContextualPanel, string> = {
  blocker: "Record a blocker",
  decision: "Ask for a decision",
  route: "Get specialist help",
};
