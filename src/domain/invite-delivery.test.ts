import { describe, expect, it } from "vitest";

import {
  INVITE_DELIVERY_ACTION,
  INVITE_DELIVERY_LABEL,
  INVITE_DELIVERY_MEANING,
  INVITE_DELIVERY_TONE,
  classifyDeliveryFailure,
  deliveryStateOf,
  latestDeliveryByInvitation,
} from "./invite-delivery";

const SENDER_REFUSAL =
  'The sender domain is not verified in your Resend account (The trusttai.com domain is not verified). Verify the domain in Resend, or set INVITE_EMAIL_FROM to "Trust Tai OS <onboarding@resend.dev>" for owner-only tests.';

describe("classifyDeliveryFailure", () => {
  it("recognises the sender domain refusal we write ourselves", () => {
    expect(classifyDeliveryFailure(SENDER_REFUSAL)).toBe("sender_unverified");
  });

  it("recognises the provider's own phrasing", () => {
    expect(classifyDeliveryFailure("You are not authorized to send from this address")).toBe(
      "sender_unverified",
    );
  });

  it("recognises transport that was never switched on", () => {
    expect(
      classifyDeliveryFailure("Email delivery is not configured yet, so nothing was emailed."),
    ).toBe("not_configured");
  });

  it("treats anything else as a plain refusal", () => {
    expect(classifyDeliveryFailure("The email provider refused the message (429).")).toBe(
      "refused",
    );
    expect(classifyDeliveryFailure("")).toBe("refused");
    expect(classifyDeliveryFailure(null)).toBe("refused");
  });
});

describe("deliveryStateOf", () => {
  it("says prepared when no email has been attempted", () => {
    expect(deliveryStateOf(null)).toBe("prepared");
    expect(deliveryStateOf(undefined)).toBe("prepared");
  });

  it("says delivered when the provider accepted it", () => {
    expect(deliveryStateOf({ delivered: true, because: "Invitation emailed." })).toBe("delivered");
  });

  it("separates provider authorization from other refusals", () => {
    expect(deliveryStateOf({ delivered: false, because: SENDER_REFUSAL })).toBe(
      "sender_unverified",
    );
    expect(deliveryStateOf({ delivered: false, because: "Provider unreachable." })).toBe("refused");
  });
});

describe("latestDeliveryByInvitation", () => {
  const attempt = (
    invitationId: string | null,
    at: string,
    delivered: boolean | null,
    because: string | null,
  ) => ({ invitationId, at, delivered, because });

  it("keeps only the most recent attempt per invitation", () => {
    const map = latestDeliveryByInvitation([
      attempt("inv-1", "2026-09-01T10:00:00Z", false, SENDER_REFUSAL),
      attempt("inv-1", "2026-09-02T10:00:00Z", true, "Invitation emailed."),
      attempt("inv-2", "2026-09-02T09:00:00Z", false, SENDER_REFUSAL),
    ]);
    expect(map["inv-1"]?.state).toBe("delivered");
    expect(map["inv-1"]?.at).toBe("2026-09-02T10:00:00Z");
    expect(map["inv-2"]?.state).toBe("sender_unverified");
  });

  it("ignores entries that are not delivery evidence", () => {
    const map = latestDeliveryByInvitation([
      attempt("inv-3", "2026-09-01T10:00:00Z", null, null),
      attempt(null, "2026-09-01T11:00:00Z", true, "Invitation emailed."),
    ]);
    expect(map).toEqual({});
  });

  it("does not let an older attempt overwrite a newer one", () => {
    const map = latestDeliveryByInvitation([
      attempt("inv-4", "2026-09-05T10:00:00Z", true, "Invitation emailed."),
      attempt("inv-4", "2026-09-01T10:00:00Z", false, SENDER_REFUSAL),
    ]);
    expect(map["inv-4"]?.state).toBe("delivered");
  });
});

describe("delivery vocabulary", () => {
  it("gives every state a label, tone and plain meaning", () => {
    for (const state of [
      "prepared",
      "delivered",
      "sender_unverified",
      "not_configured",
      "refused",
    ] as const) {
      expect(INVITE_DELIVERY_LABEL[state]).toBeTruthy();
      expect(INVITE_DELIVERY_TONE[state]).toBeTruthy();
      expect(INVITE_DELIVERY_MEANING[state]).toBeTruthy();
    }
  });

  it("offers a human action only where one exists, and never a secret", () => {
    expect(INVITE_DELIVERY_ACTION.sender_unverified).toMatch(/verify the sending domain/i);
    expect(INVITE_DELIVERY_ACTION.prepared).toBeUndefined();
    expect(INVITE_DELIVERY_ACTION.delivered).toBeUndefined();
    for (const text of Object.values(INVITE_DELIVERY_ACTION)) {
      expect(text).not.toMatch(/api[_ ]?key|secret|bearer/i);
    }
  });

  it("keeps the blocked state honest: the invitation still stands", () => {
    expect(INVITE_DELIVERY_MEANING.sender_unverified).toMatch(/saved/i);
  });
});
