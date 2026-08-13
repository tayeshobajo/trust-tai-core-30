/**
 * Trust Tai OS — Ambient Identity Wash.
 *
 * Trust Tai stays the frame: paper canvas, ink type, royal signals, one shell.
 * Each room carries a single ambient accent so moving between apps feels like
 * moving between rooms in one house — the light changes, nothing else does.
 *
 * The accents live as CSS custom properties in `src/styles.css` (`--tt-app-*`)
 * so any future page inherits them without importing anything. This module is
 * the canonical mapping and the only place an app's accent is chosen.
 *
 * These are atmosphere, never meaning. Fit lights, warnings, errors, success,
 * stage pills and buttons keep their existing Trust Tai semantics.
 */

export interface AmbientTheme {
  /** CSS colour reference for the wash. Always a token, never a literal. */
  accent: string;
  /** The colour's Trust Tai name, for documentation and design review. */
  accentName: string;
}

/** Home / Foundation. Orientation and command. */
const FOUNDATION: AmbientTheme = {
  accent: "var(--tt-app-home)",
  accentName: "Trust Tai Royal",
};

/**
 * App → ambient accent. Keys are app ids from the app registry.
 *
 * home     Trust Tai Royal  #1D54C1  orientation, command
 * scout    Alpine Cyan      #2AAFC8  discovery, horizon, clarity
 * comms    Warm Terracotta  #B96D52  human conversation, warmth
 * roadmap  Iris             #7667C9  direction, possibility, sequencing
 * projects Slate Blue       #52789C  structure, delivery, steadiness
 * ops      Steward Green    #5F8F72  health, maintenance, stewardship
 * studio   Soft Coral       #C77A6B  creation, expression, craft
 * pulse    Mulberry         #8A5C92  signals, synthesis, portfolio intelligence
 */
export const APP_AMBIENT_THEMES: Record<string, AmbientTheme> = {
  home: FOUNDATION,
  scout: { accent: "var(--tt-app-scout)", accentName: "Alpine Cyan" },
  comms: { accent: "var(--tt-app-comms)", accentName: "Warm Terracotta" },
  roadmap: { accent: "var(--tt-app-roadmap)", accentName: "Iris" },
  projects: { accent: "var(--tt-app-projects)", accentName: "Slate Blue" },
  ops: { accent: "var(--tt-app-ops)", accentName: "Steward Green" },
  studio: { accent: "var(--tt-app-studio)", accentName: "Soft Coral" },
  pulse: { accent: "var(--tt-app-pulse)", accentName: "Mulberry" },
};

/** An unknown app still belongs to Trust Tai, so it inherits the Foundation. */
export function getAppAmbientTheme(appId: string): AmbientTheme {
  return APP_AMBIENT_THEMES[appId] ?? FOUNDATION;
}

/**
 * The accent a surface should actually use.
 *
 * A detail page about a real subject (a company, and later a client or
 * project) may carry that subject's own colour. Only real, validated colours
 * qualify — pass `null` when none was recorded and the room's accent is used.
 */
export function resolveAmbientAccent(appId: string, contextAccent?: string | null): string {
  return contextAccent && contextAccent.trim() !== ""
    ? contextAccent
    : getAppAmbientTheme(appId).accent;
}
