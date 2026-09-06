import { describe, expect, it } from "vitest";

import {
  evaluateInviteAcceptance,
  mayConsumeInvitation,
  normalizeEmail,
  sameEmail,
  type InviteRecord,
} from "@/domain/invite-acceptance";

const NOW = new Date("2026-09-06T12:00:00Z");

function pending(overrides: Partial<InviteRecord> = {}): InviteRecord {
  return {
    email: "diamond@trusttai.com",
    status: "pending",
    expiresAt: "2026-09-07T12:00:00Z",
    ...overrides,
  };
}

describe("evaluateInviteAcceptance", () => {
  it("accepts when the signed-in address is the invited address", () => {
    const decision = evaluateInviteAcceptance({
      invitation: pending(),
      sessionEmail: "Diamond@TrustTai.com",
      now: NOW,
    });
    expect(decision.outcome).toBe("accept");
    expect(mayConsumeInvitation(decision)).toBe(true);
  });

  it("refuses a different active session and grants nothing", () => {
    const decision = evaluateInviteAcceptance({
      invitation: pending(),
      sessionEmail: "tayeshobajo@gmail.com",
      now: NOW,
    });
    expect(decision.outcome).toBe("wrong_account");
    expect(mayConsumeInvitation(decision)).toBe(false);
    expect(decision.invitedEmail).toBe("diamond@trusttai.com");
    expect(decision.signedInEmail).toBe("tayeshobajo@gmail.com");
    expect(decision.because).toContain("diamond@trusttai.com");
    expect(decision.because).toContain("tayeshobajo@gmail.com");
  });

  it("asks an anonymous browser to sign in as the invited address", () => {
    const decision = evaluateInviteAcceptance({
      invitation: pending(),
      sessionEmail: null,
      now: NOW,
    });
    expect(decision.outcome).toBe("no_session");
    expect(decision.because).toContain("diamond@trusttai.com");
    expect(mayConsumeInvitation(decision)).toBe(false);
  });

  it("keeps telling the truth about an already accepted invitation", () => {
    const decision = evaluateInviteAcceptance({
      invitation: pending({ status: "accepted" }),
      sessionEmail: "diamond@trusttai.com",
      now: NOW,
    });
    expect(decision.outcome).toBe("already_accepted");
    expect(mayConsumeInvitation(decision)).toBe(false);
  });

  it("refuses a cancelled invitation", () => {
    const decision = evaluateInviteAcceptance({
      invitation: pending({ status: "cancelled" }),
      sessionEmail: "diamond@trusttai.com",
      now: NOW,
    });
    expect(decision.outcome).toBe("cancelled");
  });

  it("refuses an invitation whose expiry has passed", () => {
    const decision = evaluateInviteAcceptance({
      invitation: pending({ expiresAt: "2026-09-05T12:00:00Z" }),
      sessionEmail: "diamond@trusttai.com",
      now: NOW,
    });
    expect(decision.outcome).toBe("expired");
    expect(mayConsumeInvitation(decision)).toBe(false);
  });

  it("treats a missing invitation as unknown rather than acceptable", () => {
    const decision = evaluateInviteAcceptance({
      invitation: null,
      sessionEmail: "diamond@trusttai.com",
      now: NOW,
    });
    expect(decision.outcome).toBe("unknown");
    expect(mayConsumeInvitation(decision)).toBe(false);
  });

  it("never treats an invitation with no expiry as expired", () => {
    const decision = evaluateInviteAcceptance({
      invitation: pending({ expiresAt: null }),
      sessionEmail: "diamond@trusttai.com",
      now: NOW,
    });
    expect(decision.outcome).toBe("accept");
  });

  it("refuses the wrong account even when the invitation is expired-adjacent", () => {
    const decision = evaluateInviteAcceptance({
      invitation: pending({ status: "accepted" }),
      sessionEmail: "someone.else@example.com",
      now: NOW,
    });
    expect(mayConsumeInvitation(decision)).toBe(false);
  });
});

describe("email comparison", () => {
  it("normalizes case and whitespace", () => {
    expect(normalizeEmail("  Diamond@TrustTai.com ")).toBe("diamond@trusttai.com");
  });

  it("never matches empty against empty", () => {
    expect(sameEmail("", "")).toBe(false);
    expect(sameEmail(null, undefined)).toBe(false);
  });

  it("matches the same address written differently", () => {
    expect(sameEmail("A@B.com", "a@b.com")).toBe(true);
  });
});
