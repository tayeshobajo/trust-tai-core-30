import { describe, expect, it } from "vitest";

import { EMAIL_COLORS } from "@/brand/brand-contract";
import { contrastRatio } from "@/brand/oklch";
import {
  MAGIC_LINK_LOGO_URL,
  MAGIC_LINK_SUBJECT,
  SUPABASE_CONFIRMATION_URL,
  SUPABASE_EMAIL,
  magicLinkEmail,
  magicLinkEmailHtml,
} from "@/lib/auth-email-template";

describe("magic link email", () => {
  const html = magicLinkEmailHtml();

  it("keeps Supabase substitution intact and hard-codes no real link", () => {
    expect(html).toContain(`href="${SUPABASE_CONFIRMATION_URL}"`);
    expect(html).toContain(SUPABASE_EMAIL);
    expect(html).not.toMatch(/access_token=|magiclink&token=/);
  });

  it("carries a restrained branded subject", () => {
    expect(MAGIC_LINK_SUBJECT).toBe("Your Trust Tai OS sign-in link");
    expect(magicLinkEmail().subject).toBe(MAGIC_LINK_SUBJECT);
  });

  it("loads the real lockup from a public https URL", () => {
    expect(MAGIC_LINK_LOGO_URL).toBe("https://cmd.trusttai.com/brand/trust-tai-logo.png");
    expect(html).toContain(`src="${MAGIC_LINK_LOGO_URL}"`);
    expect(html).toContain('alt="Trust Tai"');
  });

  it("falls back to a text lockup rather than a broken image", () => {
    const withoutLogo = magicLinkEmailHtml({ logoUrl: null });
    expect(withoutLogo).not.toContain("<img");
    expect(withoutLogo).toContain("Trust&nbsp;Tai");
  });

  it("uses the shared email palette, never a second one", () => {
    for (const hex of Object.values(EMAIL_COLORS)) expect(html).toContain(hex);
    const strays = html.match(/#[0-9a-fA-F]{6}/g) ?? [];
    const allowed = new Set(Object.values(EMAIL_COLORS).map((value) => value.toLowerCase()));
    for (const hex of strays) expect(allowed.has(hex.toLowerCase())).toBe(true);
  });

  it("keeps the button and body legible", () => {
    expect(contrastRatio(EMAIL_COLORS.paper, EMAIL_COLORS.royal)).toBeGreaterThan(4.5);
    expect(contrastRatio(EMAIL_COLORS.paper, EMAIL_COLORS.ink)).toBeGreaterThan(4.5);
    expect(contrastRatio(EMAIL_COLORS.paper, EMAIL_COLORS.muted)).toBeGreaterThan(4.5);
  });

  it("stays mobile safe: fluid table, no fixed wide widths", () => {
    expect(html).toContain("max-width:560px");
    expect(html).toContain('name="viewport"');
    expect(html).not.toMatch(/width:\s*(6[5-9]\d|[7-9]\d\d)px/);
  });

  it("says the security things a sign-in email must say", () => {
    expect(html).toContain("Your secure sign-in link");
    expect(html).toContain("works once and expires shortly");
    expect(html).toContain("did not request this email");
    expect(html).toContain("Sign in to Trust Tai OS");
  });

  it("ships a plain text companion carrying the same link placeholder", () => {
    const { text } = magicLinkEmail();
    expect(text).toContain(SUPABASE_CONFIRMATION_URL);
    expect(text).toContain(SUPABASE_EMAIL);
    expect(text).toContain("expires shortly");
  });
});
