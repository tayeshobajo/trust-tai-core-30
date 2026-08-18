/**
 * Trust Tai OS, per-app visual world.
 *
 * Each registered app gets a distinct motif and a single tonal accent so the
 * suite reads as one building with different rooms. Paper, ink and royal stay
 * dominant; the tint is atmosphere only, never a brand colour of its own.
 */

export type AppMotif =
  | "horizon"
  | "terrain"
  | "correspondence"
  | "contour"
  | "blueprint"
  | "systems"
  | "composition"
  | "rhythm"
  | "ledger";

export interface AppTheme {
  motif: AppMotif;
  /** Subtle secondary tonal accent, used at low opacity only. */
  tint: string;
  /** Short editorial line that sets the room's character. */
  character: string;
}

const DEFAULT_THEME: AppTheme = {
  motif: "horizon",
  tint: "oklch(0.48 0.185 265)",
  character: "An elevated view of the whole journey.",
};

export const APP_THEMES: Record<string, AppTheme> = {
  home: DEFAULT_THEME,
  scout: {
    motif: "terrain",
    tint: "oklch(0.52 0.09 210)",
    character: "Field notes from the terrain before outreach begins.",
  },
  comms: {
    motif: "correspondence",
    tint: "oklch(0.56 0.075 62)",
    character: "Correspondence kept in one hand, on one desk.",
  },
  roadmap: {
    motif: "contour",
    tint: "oklch(0.48 0.185 265)",
    character: "Contour lines between Point A and Point B.",
  },
  projects: {
    motif: "blueprint",
    tint: "oklch(0.50 0.08 250)",
    character: "The working table: materials, order, ownership.",
  },
  steward: {
    motif: "ledger",
    tint: "oklch(0.50 0.06 145)",
    character: "A quiet ledger of what was said, and who carries it.",
  },
  ops: {
    motif: "systems",
    tint: "oklch(0.46 0.098 152)",
    character: "A quiet control room that rarely needs your attention.",
  },
  studio: {
    motif: "composition",
    tint: "oklch(0.55 0.09 30)",
    character: "An editorial workspace: type, image, composition.",
  },
  conductor: {
    motif: "ledger",
    tint: "oklch(0.5 0.1 85)",
    character: "A quiet desk where the whole factory can be heard at once.",
  },
  pulse: {
    motif: "rhythm",
    tint: "oklch(0.52 0.12 300)",
    character: "Measured rhythm across the portfolio.",
  },
};

export function getAppTheme(appId: string): AppTheme {
  return APP_THEMES[appId] ?? DEFAULT_THEME;
}
