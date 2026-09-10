import { describe, expect, it } from "vitest";

import { inviteEmailBody } from "@/lib/invite-email-template";

const INPUT = {
  to: "diamond@trusttai.com",
  organizationName: "Trust Tai",
  roleLabel: "Admin",
  invitedByName: "Tai",
  signInUrl: "https://cmd.trusttai.com/auth?email=diamond%40trusttai.com&invite=abc",
  expiresAt: "2026-09-07T12:00:00Z",
  logoUrl: "https://cmd.trusttai.com/brand/trust-tai-logo.png",
};

describe("inviteEmailBody", () => {
  it("keeps the existing subject contract", () => {
    expect(inviteEmailBody(INPUT).subject).toBe("Tai invited you to Trust Tai on Trust Tai OS");
  });

  it("renders the brand lockup with alt text when a public logo URL is given", () => {
    const { html } = inviteEmailBody(INPUT);
    expect(html).toContain('src="https://cmd.trusttai.com/brand/trust-tai-logo.png"');
    expect(html).toContain('alt="Trust Tai"');
  });

  it("falls back to a text lockup rather than a broken image", () => {
    const { html } = inviteEmailBody({ ...INPUT, logoUrl: null });
    expect(html).not.toContain("<img");
    expect(html).toContain("Trust&nbsp;Tai");
  });

  it("refuses a non-https logo URL", () => {
    const { html } = inviteEmailBody({ ...INPUT, logoUrl: "/brand/trust-tai-logo.png" });
    expect(html).not.toContain("<img");
  });

  it("names the inviter, the role, the invited address and the expiry", () => {
    const { html, text } = inviteEmailBody(INPUT);
    for (const body of [html, text]) {
      expect(body).toContain("Tai");
      expect(body).toContain("Admin");
      expect(body).toContain("diamond@trusttai.com");
      expect(body).toContain("September 7, 2026");
    }
  });

  it("carries the primary call to action and the invite link", () => {
    const { html } = inviteEmailBody(INPUT);
    expect(html).toContain("Open Trust Tai OS");
    expect(html).toContain("invite=abc");
  });

  it("escapes hostile content instead of rendering it", () => {
    const { html } = inviteEmailBody({ ...INPUT, invitedByName: '<script>x</script>"' });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("stays light-only and free of tracking pixels", () => {
    const { html } = inviteEmailBody(INPUT);
    expect(html).toContain('content="light only"');
    expect(html.match(/<img/g) ?? []).toHaveLength(1);
  });

  it("gives a readable plaintext fallback with the sign-in guidance", () => {
    const { text } = inviteEmailBody(INPUT);
    expect(text).toContain("Open Trust Tai OS: https://cmd.trusttai.com/auth?");
    expect(text).toContain("sign out first");
  });
});
