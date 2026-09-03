/**
 * Trust Tai OS, brand contract.
 *
 * The single machine-readable description of the brand surface: the official
 * logo lockup, the typography hierarchy, and the colour tokens every room
 * inherits. Visual regression checks (unit + headless browser) read this file
 * so a drift in the shell is caught as a failing test, not noticed months later.
 */

/** Official Trust Tai lockup, taken from trusttai.com. Never re-typed as text. */
export const BRAND_LOGO = {
  naturalWidth: 534,
  naturalHeight: 97,
  /** Rendered heights in the OS shell, in CSS px. */
  shellHeight: { mobile: 26, desktop: 30 },
  /** Allowed deviation from the natural aspect ratio when rendered. */
  aspectTolerance: 0.02,
} as const;

export const LOGO_ASPECT = BRAND_LOGO.naturalWidth / BRAND_LOGO.naturalHeight;

/** Font families, in the order the shell declares them. */
export const BRAND_FONTS = {
  display: "Sora",
  sans: "Manrope",
  mono: "JetBrains Mono",
} as const;

/**
 * Typography hierarchy. Serif display for room titles, sans for reading,
 * mono for eyebrows and machine facts. Sizes are the rendered px the browser
 * must report; `min`/`max` bound responsive display type.
 */
export const TYPE_SCALE = [
  { role: "display", family: "display", min: 26, max: 56 },
  { role: "body", family: "sans", min: 13, max: 17 },
  { role: "eyebrow", family: "mono", min: 9, max: 12 },
] as const;

/** Colour tokens that must exist in:root, with their canonical oklch values. */
export const COLOR_TOKENS: Record<string, string> = {
  "--ink": "oklch(0.19 0.048 266)",
  "--paper": "oklch(1 0 0)",
  "--royal": "oklch(0.49 0.185 264)",
  "--rule": "oklch(0.906 0.016 250)",
  "--success": "oklch(0.46 0.098 152)",
  "--warning": "oklch(0.58 0.117 76)",
  "--danger": "oklch(0.52 0.19 27)",
  "--ember": "oklch(0.62 0.16 45)",
  "--cloud": "oklch(0.974 0.012 250)",
  "--cloud-strong": "oklch(0.955 0.022 250)",
  "--cloud-line": "oklch(0.906 0.016 250)",
  "--cloud-ink": "oklch(0.36 0.11 262)",
  "--card": "oklch(1 0 0)",
};

/** Per-room ambient accents. Atmosphere only, never status or control colour. */
export const AMBIENT_TOKENS: Record<string, string> = {
  "--tt-app-home": "#1d54c1",
  "--tt-app-scout": "#2aafc8",
  "--tt-app-comms": "#b96d52",
  "--tt-app-roadmap": "#7667c9",
  "--tt-app-projects": "#52789c",
  "--tt-app-steward": "#4f7d63",
  "--tt-app-ops": "#5f8f72",
  "--tt-app-studio": "#c77a6b",
  "--tt-app-pulse": "#8a5c92",
};

/** Colour utilities that bypass theming and must never appear in app code. */
export const FORBIDDEN_COLOR_UTILITIES = [
  /\btext-white\b/,
  /\bbg-black\b/,
  /\bbg-white\b/,
  /\b(?:bg|text|border|fill|stroke)-\[#[0-9a-fA-F]{3,8}\]/,
];

/** Screens the visual regression sweep covers, and the breakpoints it uses. */
export const VISUAL_SCREENS = [
  { id: "auth", path: "/auth?redirect=%2F" },
  { id: "home", path: "/" },
  { id: "scout", path: "/modules/scout" },
  { id: "comms", path: "/modules/comms" },
  { id: "conductor", path: "/modules/conductor" },
  { id: "pulse", path: "/modules/pulse" },
] as const;

export const VISUAL_BREAKPOINTS = [
  { id: "mobile", width: 375, height: 900 },
  { id: "tablet", width: 768, height: 1100 },
  { id: "desktop", width: 1440, height: 1200 },
] as const;
