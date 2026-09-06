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
  /**
   * The same lockup, served from a public path so an inbox can load it.
   * `publicPath` is a byte-for-byte copy of the bundled asset, kept honest by
   * a test, and `emailHeight` is the rendered height in an email header.
   */
  bundledAsset: "src/assets/brand/trust-tai-logo.png",
  publicPath: "/brand/trust-tai-logo.png",
  publicFile: "public/brand/trust-tai-logo.png",
  emailHeight: 28,
} as const;

/** Width the email lockup must declare, derived so the ratio can never drift. */
export const EMAIL_LOGO_WIDTH = Math.round(
  (BRAND_LOGO.emailHeight * BRAND_LOGO.naturalWidth) / BRAND_LOGO.naturalHeight,
);

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

/**
 * The email palette.
 *
 * Email clients understand neither oklch, CSS variables nor color-mix(), so a
 * letter has to carry literal hex. These are not hand-picked: each one is the
 * sRGB conversion of the token named beside it, and a test reconverts the
 * tokens and fails if this table drifts from the screen palette. Change a
 * token in src/styles.css and this table has to follow, deliberately.
 */
export const EMAIL_COLORS = {
  /** --ink, the deep navy the whole brand rests on. */
  ink: "#0a1229",
  /** --paper, the letter's own surface. */
  paper: "#ffffff",
  /** --royal, reserved for the single primary action. */
  royal: "#2755c7",
  /** --rule, hairline borders. */
  rule: "#d8e1ea",
  /** --muted-foreground, supporting copy. */
  muted: "#4d586c",
  /** --secondary, the calm wash behind the letter and its quiet panel. */
  secondary: "#e9f4ff",
} as const;

/** The screen tokens each email colour is converted from. */
export const EMAIL_COLOR_SOURCES: Record<keyof typeof EMAIL_COLORS, string> = {
  ink: "oklch(0.19 0.048 266)",
  paper: "oklch(1 0 0)",
  royal: "oklch(0.49 0.185 264)",
  rule: "oklch(0.906 0.016 250)",
  muted: "oklch(0.46 0.035 262)",
  secondary: "oklch(0.962 0.02 250)",
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
