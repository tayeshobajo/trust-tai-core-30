/**
 * Visual regression — static half.
 *
 * These checks run without a browser and guard the things a screenshot diff is
 * bad at explaining: the logo lockup's geometry, the declared type hierarchy,
 * the colour tokens, and the rule that no component hardcodes a colour.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  AMBIENT_TOKENS,
  BRAND_FONTS,
  BRAND_LOGO,
  COLOR_TOKENS,
  FORBIDDEN_COLOR_UTILITIES,
  TYPE_SCALE,
} from "./brand-contract";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const styles = read("src/styles.css");
const logoComponent = read("src/components/tt/brand-logo.tsx");
const appShell = read("src/components/tt/app-shell.tsx");
const rootRoute = read("src/routes/__root.tsx");

describe("logo", () => {
  it("keeps the official lockup geometry", () => {
    expect(logoComponent).toContain(`NATURAL_WIDTH = ${BRAND_LOGO.naturalWidth}`);
    expect(logoComponent).toContain(`NATURAL_HEIGHT = ${BRAND_LOGO.naturalHeight}`);
    // Width is derived from height, so the aspect ratio can never drift.
    expect(logoComponent).toContain("NATURAL_WIDTH) / NATURAL_HEIGHT");
  });

  it("ships both official variants and never a text lockup in the shell", () => {
    expect(logoComponent).toContain("trust-tai-logo.png");
    expect(logoComponent).toContain("trust-tai-logo-white.png");
    expect(appShell).toContain("<BrandLogo");
    expect(appShell).not.toMatch(/>\s*Trust Tai OS\s*</);
  });

  it("renders the shell lockup at the contracted heights", () => {
    expect(appShell).toContain(`height={${BRAND_LOGO.shellHeight.mobile}}`);
    expect(appShell).toContain(`sm:h-[${BRAND_LOGO.shellHeight.desktop}px]`);
  });
});

describe("typography hierarchy", () => {
  it("declares the three brand families", () => {
    for (const family of Object.values(BRAND_FONTS)) {
      expect(styles).toContain(family);
    }
  });

  it("binds each type role to its family", () => {
    // Display headings are serif, eyebrows are mono — enforced by utilities.
    expect(styles).toMatch(/@utility tt-display[\s\S]*?font-family: var\(--font-display\)/);
    expect(styles).toMatch(/@utility tt-eyebrow[\s\S]*?font-family: var\(--font-mono\)/);
    expect(styles).toMatch(/body\s*\{[\s\S]*?font-family: var\(--font-sans\)/);
  });

  it("keeps the scale ordered from display down to eyebrow", () => {
    const maxima = TYPE_SCALE.map((step) => step.max);
    expect([...maxima].sort((a, b) => b - a)).toEqual(maxima);
    for (const step of TYPE_SCALE) expect(step.min).toBeLessThanOrEqual(step.max);
  });
});

describe("colour tokens", () => {
  it("defines every brand token with its canonical value", () => {
    for (const [token, value] of Object.entries(COLOR_TOKENS)) {
      expect(styles, `${token} missing or changed`).toContain(`${token}: ${value};`);
    }
  });

  it("defines an ambient accent for every room", () => {
    for (const [token, value] of Object.entries(AMBIENT_TOKENS)) {
      expect(styles.toLowerCase(), `${token} missing or changed`).toContain(
        `${token}: ${value};`,
      );
    }
  });

  it("maps the semantic surfaces onto brand tokens", () => {
    expect(styles).toContain("--background: var(--cloud);");
    expect(styles).toContain("--foreground: var(--ink);");
    expect(styles).toContain("--ring: var(--royal);");
    expect(styles).toContain("--border: var(--rule);");
  });
});

describe("no hardcoded colour drift", () => {
  const files = import.meta.glob("../{components,routes}/**/*.tsx", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;

  it("scans the whole component and route tree", () => {
    expect(Object.keys(files).length).toBeGreaterThan(20);
  });

  it("never bypasses the design tokens", () => {
    const offenders: string[] = [];
    for (const [file, source] of Object.entries(files)) {
      if (file.includes("/components/ui/")) continue; // vendored shadcn primitives
      for (const pattern of FORBIDDEN_COLOR_UTILITIES) {
        if (pattern.test(source)) offenders.push(`${file} → ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("brand metadata", () => {
  it("keeps the OS title, description and share image centralized in the root route", () => {
    expect(rootRoute).toContain("Trust Tai OS");
    expect(rootRoute).toContain("og:image");
    expect(rootRoute).toContain("twitter:card");
    expect(rootRoute).toContain("noindex, nofollow");
  });
});
