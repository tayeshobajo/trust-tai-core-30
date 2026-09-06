/**
 * The brand cannot drift between the screen and the inbox.
 *
 * These checks convert the app's own oklch tokens and compare them with the
 * hex the invitation email carries, prove the public logo an inbox loads is
 * the same file the product renders, and hold the letter to the brand's
 * contrast and geometry rules.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  BRAND_LOGO,
  EMAIL_COLORS,
  EMAIL_COLOR_SOURCES,
  EMAIL_LOGO_WIDTH,
  LOGO_ASPECT,
} from "./brand-contract";
import { contrastRatio, oklchToHex } from "./oklch";
import { inviteEmailBody } from "@/lib/invite-email-template";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel));
const styles = read("src/styles.css").toString("utf8");

const EMAIL = inviteEmailBody({
  to: "diamond@trusttai.com",
  organizationName: "Trust Tai",
  roleLabel: "Admin",
  invitedByName: "Tai",
  signInUrl: "https://cmd.trusttai.com/auth?email=diamond%40trusttai.com&invite=abc",
  expiresAt: "2026-09-07T12:00:00Z",
  logoUrl: `https://cmd.trusttai.com${BRAND_LOGO.publicPath}`,
});

describe("email palette", () => {
  it("is the sRGB conversion of the app's own tokens", () => {
    for (const [name, hex] of Object.entries(EMAIL_COLORS)) {
      const source = EMAIL_COLOR_SOURCES[name as keyof typeof EMAIL_COLORS];
      expect(oklchToHex(source), `${name} conversion`).toBe(hex);
    }
  });

  it("converts from tokens the stylesheet actually declares", () => {
    // paper and secondary are declared through other names, so check the four
    // tokens that appear verbatim in :root.
    for (const token of ["--ink", "--royal", "--rule"] as const) {
      expect(styles).toContain(`${token}: ${EMAIL_COLOR_SOURCES[
        token === "--ink" ? "ink" : token === "--royal" ? "royal" : "rule"
      ]};`);
    }
    expect(styles).toContain(`--muted-foreground: ${EMAIL_COLOR_SOURCES.muted};`);
    expect(styles).toContain(`--secondary: ${EMAIL_COLOR_SOURCES.secondary};`);
  });

  it("is the only palette the letter uses", () => {
    const allowed = new Set(Object.values(EMAIL_COLORS).map((hex) => hex.toLowerCase()));
    const used = new Set((EMAIL.html.match(/#[0-9a-fA-F]{6}/g) ?? []).map((hex) => hex.toLowerCase()));
    expect([...used].filter((hex) => !allowed.has(hex))).toEqual([]);
  });

  it("keeps body copy and the button legible at WCAG AA", () => {
    expect(contrastRatio(EMAIL_COLORS.ink, EMAIL_COLORS.paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(EMAIL_COLORS.muted, EMAIL_COLORS.paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(EMAIL_COLORS.paper, EMAIL_COLORS.royal)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(EMAIL_COLORS.muted, EMAIL_COLORS.secondary)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the logo an inbox loads", () => {
  it("is byte for byte the logo the product renders", () => {
    expect(read(BRAND_LOGO.publicFile).equals(read(BRAND_LOGO.bundledAsset))).toBe(true);
  });

  it("is rendered at the official aspect ratio", () => {
    const ratio = EMAIL_LOGO_WIDTH / BRAND_LOGO.emailHeight;
    expect(Math.abs(ratio - LOGO_ASPECT) / LOGO_ASPECT).toBeLessThanOrEqual(
      BRAND_LOGO.aspectTolerance,
    );
  });

  it("carries that width and height on the image itself, for clients that need them", () => {
    expect(EMAIL.html).toContain(`width="${EMAIL_LOGO_WIDTH}" height="${BRAND_LOGO.emailHeight}"`);
    expect(EMAIL.html).toContain(`https://cmd.trusttai.com${BRAND_LOGO.publicPath}`);
  });
});
