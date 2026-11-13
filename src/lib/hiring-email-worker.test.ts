import { afterEach, describe, expect, it, vi } from "vitest";
import { HIRING_ORG, HIRING_PEOPLE } from "@/domain/hiring";
import {
  runNotificationBatch,
  observedOutcome,
  type NotificationClaim,
  type NotificationStore,
} from "./hiring-email-worker.server";
import { hiringNotificationSchedule } from "./hiring-email-scheduler.server";
const claim: NotificationClaim = {
  id: "11111111-1111-4111-8111-111111111111",
  lease: "33333333-3333-4333-8333-333333333333",
  purpose: "applicant_receipt",
  templateVersion: 1,
  mode: "qa",
  application: {
    id: "11111111-1111-4111-8111-111111111111",
    organization_id: HIRING_ORG,
    job_id: "22222222-2222-4222-8222-222222222222",
    full_name: "Synthetic Applicant",
    email: "applicant@example.test",
    created_at: "2026-11-13T15:00:00Z",
  },
  role: {
    id: "22222222-2222-4222-8222-222222222222",
    organization_id: HIRING_ORG,
    title: "Synthetic Role",
    slug: "synthetic-role",
    owner_id: HIRING_PEOPLE[1]?.id ?? "",
  },
  members: [
    {
      user_id: HIRING_PEOPLE[1]?.id ?? "",
      organization_id: HIRING_ORG,
      name: "Synthetic Owner",
      email: "owner@example.test",
      active: true,
      hiring_access: true,
      email_verified: true,
    },
    {
      user_id: HIRING_PEOPLE[0]?.id ?? "",
      organization_id: HIRING_ORG,
      name: "Tai",
      email: "tai@trust-tai.com",
      active: true,
      hiring_access: true,
      email_verified: true,
    },
  ],
};
const provider = { base: "https://provider.invalid", headers: {} };
function fixture(rows: NotificationClaim[] = [claim]): NotificationStore {
  return {
    claim: vi.fn(async () => rows.shift() ?? null),
    settle: vi.fn(async () => {}),
    reconcileCandidates: vi.fn(async () => []),
    observe: vi.fn(async () => {}),
  };
}
afterEach(() => vi.unstubAllEnvs());
describe("disabled Hiring notification candidate", () => {
  it.each(["applicant_receipt", "role_owner_alert", "tai_alert_copy"] as const)(
    "routes all QA %s only to Resend tests",
    async (purpose) => {
      const f = vi
        .fn<typeof fetch>()
        .mockImplementation(async () => Response.json({ id: "synthetic-provider" }));
      await runNotificationBatch(fixture([{ ...claim, purpose }]), provider, f);
      expect(JSON.parse(String(f.mock.calls[0]?.[1]?.body)).to).toEqual(["delivered@resend.dev"]);
    },
  );
  it("ignores forged client-style recipients and includes HTML plus text", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "synthetic" }));
    await runNotificationBatch(
      fixture([{ ...claim, ...{ recipient: "attacker@example.test" } }]),
      provider,
      f,
    );
    const body = JSON.parse(String(f.mock.calls[0]?.[1]?.body));
    expect(body.to).toEqual(["delivered@resend.dev"]);
    expect(body.html).toContain("Application received");
    expect(body.text).toContain("not a hiring decision");
    expect(f.mock.calls[0]?.[1]?.redirect).toBe("error");
  });
  it("keeps stable idempotency across lease changes", async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ id: "synthetic" }));
    await runNotificationBatch(fixture(), provider, f);
    await runNotificationBatch(
      fixture([{ ...claim, lease: "44444444-4444-4444-8444-444444444444" }]),
      provider,
      f,
    );
    expect(new Headers(f.mock.calls[0]?.[1]?.headers).get("Idempotency-Key")).toBe(
      new Headers(f.mock.calls[1]?.[1]?.headers).get("Idempotency-Key"),
    );
  });
  it.each(["active", "hiring_access", "email_verified"] as const)(
    "blocks revoked owner %s but preserves receipt",
    async (field) => {
      const members = claim.members.map((m) => ({ ...m, [field]: false }));
      const store = fixture([
        { ...claim, purpose: "role_owner_alert", members },
        { ...claim, members },
      ]);
      const f = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "synthetic" }));
      await runNotificationBatch(store, provider, f);
      expect(f).toHaveBeenCalledTimes(1);
      expect(vi.mocked(store.settle).mock.calls[0]?.[1].state).toBe("blocked");
    },
  );
  it("does not transport a deduplicated Tai copy", async () => {
    const f = vi.fn<typeof fetch>();
    await runNotificationBatch(
      fixture([
        {
          ...claim,
          purpose: "tai_alert_copy",
          role: { ...claim.role, owner_id: HIRING_PEOPLE[0]?.id ?? "" },
        },
      ]),
      provider,
      f,
    );
    expect(f).not.toHaveBeenCalled();
  });
  it("limits one invocation to five claims", async () => {
    const store = fixture(Array.from({ length: 9 }, () => claim));
    const f = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ id: "synthetic" }));
    expect((await runNotificationBatch(store, provider, f)).claimed).toBe(5);
    expect(f).toHaveBeenCalledTimes(5);
  });
  it("records provider acceptance as sent, not delivered", async () => {
    const store = fixture();
    await runNotificationBatch(
      store,
      provider,
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "synthetic" })),
    );
    expect(vi.mocked(store.settle).mock.calls[0]?.[1].state).toBe("sent");
  });
  it("unknown transport gets one attempt and never an automatic retry", async () => {
    const store = fixture(),
      f = vi.fn<typeof fetch>().mockRejectedValue(new Error("disconnect"));
    await runNotificationBatch(store, provider, f);
    expect(f).toHaveBeenCalledTimes(1);
    expect(vi.mocked(store.settle).mock.calls[0]?.[1].state).toBe("unknown");
  });
  it.each([422, 500, 429])("classifies HTTP %s without retry", async (status) => {
    const store = fixture(),
      f = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status }));
    await runNotificationBatch(store, provider, f);
    expect(vi.mocked(store.settle).mock.calls[0]?.[1].state).toBe(
      status === 422 ? "failed" : "unknown",
    );
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("stops on interrupted receipt recording", async () => {
    const store = fixture([claim, claim]);
    vi.mocked(store.settle).mockRejectedValue(new Error("ledger interrupted"));
    const f = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "synthetic" }));
    await expect(runNotificationBatch(store, provider, f)).rejects.toThrow("ledger interrupted");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("reconciles observed status using GET only", async () => {
    const store = fixture([]);
    vi.mocked(store.reconcileCandidates).mockResolvedValue([
      { id: claim.id, providerId: "synthetic", state: "unknown" },
    ]);
    const f = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ last_event: "delivered" }));
    expect((await runNotificationBatch(store, provider, f)).reconciled).toBe(1);
    expect(f.mock.calls[0]?.[1]?.method).toBeUndefined();
    expect(vi.mocked(store.observe).mock.calls[0]?.[1].state).toBe("delivered");
  });
  it.each(["bounced", "complained", "failed"])(
    "observes delivered → %s without resending",
    async (event) => {
      const store = fixture([]);
      vi.mocked(store.reconcileCandidates).mockResolvedValue([
        { id: claim.id, providerId: "synthetic", state: "delivered" },
      ]);
      const f = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ last_event: event }));
      expect(await runNotificationBatch(store, provider, f)).toEqual({ claimed: 0, reconciled: 1 });
      expect(f).toHaveBeenCalledTimes(1);
      expect(f.mock.calls[0]?.[1]?.method).toBeUndefined();
      expect(f.mock.calls[0]?.[1]?.redirect).toBe("error");
      expect(store.observe).toHaveBeenCalledWith(claim.id, {
        state: "failed",
        providerId: "synthetic",
        code: event,
      });
      expect(store.settle).not.toHaveBeenCalled();
    },
  );
  it.each(["sent", "unknown", "delivered"])(
    "does not degrade or re-record delivered on %s",
    async (event) => {
      const store = fixture([]);
      vi.mocked(store.reconcileCandidates).mockResolvedValue([
        { id: claim.id, providerId: "synthetic", state: "delivered" },
      ]);
      const f = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ last_event: event }));
      expect((await runNotificationBatch(store, provider, f)).reconciled).toBe(0);
      expect(f).toHaveBeenCalledTimes(1);
      expect(store.observe).not.toHaveBeenCalled();
    },
  );
  it("bounds recent-delivered observation to five provider reads", async () => {
    const store = fixture([]);
    vi.mocked(store.reconcileCandidates).mockResolvedValue(
      Array.from({ length: 9 }, (_, i) => ({
        id: String(i),
        providerId: `synthetic-${i}`,
        state: "delivered",
      })),
    );
    const f = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ last_event: "complained" }));
    expect((await runNotificationBatch(store, provider, f)).reconciled).toBe(5);
    expect(f).toHaveBeenCalledTimes(5);
    expect(store.observe).toHaveBeenCalledTimes(5);
  });
  it.each(["failed", "bounced", "complained", "suppressed"])(
    "preserves definitive %s",
    async (state) => {
      expect(observedOutcome(state, "delivered")).toBeNull();
      const store = fixture([]);
      vi.mocked(store.reconcileCandidates).mockResolvedValue([
        { id: claim.id, providerId: "synthetic", state },
      ]);
      const f = vi.fn<typeof fetch>();
      await runNotificationBatch(store, provider, f);
      expect(f).not.toHaveBeenCalled();
      expect(store.observe).not.toHaveBeenCalled();
    },
  );
  it("unknown provider observations do not erase delivery evidence", () => {
    expect(observedOutcome("sent", "sent")).toBeNull();
  });
  it("scheduler fails closed without its separate secret", async () => {
    vi.stubEnv("HIRING_NOTIFICATION_CRON_SECRET", "");
    expect(
      (await hiringNotificationSchedule(new Request("https://local.invalid", { method: "POST" })))
        .status,
    ).toBe(503);
  });
  it("scheduler denies incorrect credentials", async () => {
    vi.stubEnv("HIRING_NOTIFICATION_CRON_SECRET", "synthetic-only");
    expect(
      (
        await hiringNotificationSchedule(
          new Request("https://local.invalid", {
            method: "POST",
            headers: { "X-Hiring-Notification-Key": "wrong" },
          }),
        )
      ).status,
    ).toBe(401);
  });
  it("even authorized scheduler cannot bypass independent SQL review hold", async () => {
    vi.stubEnv("HIRING_NOTIFICATION_CRON_SECRET", "synthetic-only");
    const r = await hiringNotificationSchedule(
      new Request("https://local.invalid", {
        method: "POST",
        headers: { "X-Hiring-Notification-Key": "synthetic-only" },
      }),
    );
    expect(await r.json()).toEqual({ state: "review_required", claimed: 0, reconciled: 0 });
  });
});
