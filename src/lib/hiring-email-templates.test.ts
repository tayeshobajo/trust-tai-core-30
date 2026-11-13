import { afterEach, describe, expect, it, vi } from "vitest";
import { HIRING_ORG, HIRING_PEOPLE } from "@/domain/hiring";
import { prepareHiringEmails, HIRING_EMAIL_LOGO } from "./hiring-email-templates.server";
import { sendHiringQA } from "./hiring-provider.server";
import { publicHiring } from "./hiring-intake.server";

const a = {
  id: "11111111-1111-4111-8111-111111111111",
  organization_id: HIRING_ORG,
  job_id: "22222222-2222-4222-8222-222222222222",
  full_name: "Jordan Avery",
  email: "jordan@example.test",
  created_at: "2026-11-13T15:42:00Z",
};
const role = {
  id: a.job_id,
  organization_id: HIRING_ORG,
  title: "Digital Sales Intern",
  slug: "digital-sales-intern",
  owner_id: HIRING_PEOPLE[1]?.id ?? "",
};
const member = {
  user_id: role.owner_id,
  organization_id: HIRING_ORG,
  name: "Diamond",
  email: "owner@example.test",
  email_verified: true,
  active: true,
  hiring_access: true,
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("prepared hiring emails, no dispatch", () => {
  const tai = {
    ...member,
    user_id: HIRING_PEOPLE[0]?.id ?? "",
    name: "Tai",
    email: "tai@trust-tai.com",
  };
  it("copies the internal alert only to verified Tai with a separate immutable purpose", () => {
    const p = prepareHiringEmails(a, role, [member, tai]);
    expect(p.taiCopy?.state).toBe("prepared");
    if (p.taiCopy?.state !== "prepared") throw new Error("Missing copy");
    expect(p.taiCopy.to).toEqual(["tai@trust-tai.com"]);
    expect(p.taiCopy.idempotencyKey).toBe(`hiring/${a.id}/tai_alert_copy/v1`);
  });
  it("deduplicates Tai when Tai is assigned owner", () => {
    expect(prepareHiringEmails(a, { ...role, owner_id: tai.user_id }, [tai]).taiCopy?.state).toBe(
      "deduplicated",
    );
  });
  it.each([
    { active: false },
    { email_verified: false },
    { hiring_access: false },
    { email: "forged@example.test" },
  ])("blocks invalid Tai copy %j", (patch) => {
    expect(prepareHiringEmails(a, role, [member, { ...tai, ...patch }]).taiCopy?.state).toBe(
      "blocked",
    );
  });
  it("blocks ambiguous Tai identity", () => {
    expect(prepareHiringEmails(a, role, [member, tai, tai]).taiCopy?.state).toBe("blocked");
  });
  it("addresses only submitted applicant and verified role owner, with no network calls", () => {
    const fetcher = vi.fn(() => {
      throw new Error("No network allowed");
    });
    vi.stubGlobal("fetch", fetcher);
    const p = prepareHiringEmails(a, role, [member]);
    expect(p.receipt.to).toEqual([a.email]);
    expect(p.ownerAlert.state).toBe("prepared");
    if (p.ownerAlert.state !== "prepared") throw new Error("Missing alert");
    expect(p.ownerAlert.to).toEqual([member.email]);
    expect(p.receipt.html).toContain(HIRING_EMAIL_LOGO);
    expect(p.ownerAlert.html).toContain(
      `https://cmd.trusttai.com/modules/hiring?application=${a.id}`,
    );
    expect(p.ownerAlert.text).toContain("Sign in required");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([null, "33333333-3333-4333-8333-333333333333"])(
    "blocks absent or unknown owner %s, without suppressing receipt",
    (owner_id) => {
      const p = prepareHiringEmails(a, { ...role, owner_id }, [member]);
      expect(p.receipt.state).toBe("prepared");
      expect(p.ownerAlert.state).toBe("blocked");
    },
  );
  it.each([
    { active: false },
    { hiring_access: false },
    { email_verified: false },
    { email: "invalid" },
    { organization_id: "another-org" },
  ])("blocks invalid membership %j", (patch) => {
    expect(prepareHiringEmails(a, role, [{ ...member, ...patch }]).ownerAlert.state).toBe(
      "blocked",
    );
  });
  it("blocks ambiguous owner rows even when one is valid", () => {
    expect(
      prepareHiringEmails(a, role, [member, { ...member, email: "other@example.test" }]).ownerAlert
        .state,
    ).toBe("blocked");
  });
  it("ignores unrelated valid members rather than broadcasting", () => {
    expect(
      prepareHiringEmails(a, role, [{ ...member, user_id: HIRING_PEOPLE[0]?.id ?? "" }]).ownerAlert
        .state,
    ).toBe("blocked");
  });
  it("rejects mismatched role, tenant, invalid saved timestamp and injection into subject headers", () => {
    for (const patch of [
      { job_id: "33333333-3333-4333-8333-333333333333" },
      { organization_id: "other" },
      { created_at: "yesterday" },
    ])
      expect(() => prepareHiringEmails({ ...a, ...patch }, role, [member])).toThrow();
    expect(() =>
      prepareHiringEmails(a, { ...role, title: "Role\r\nBcc: attacker@example.test" }, [member]),
    ).toThrow();
  });
  it("escapes content and excludes unknown applicant secrets, answers and files", () => {
    const p = prepareHiringEmails(
      {
        ...a,
        full_name: '<img src=x onerror="evil()">',
        ...{
          answers: "PRIVATE_ANSWER",
          resume_path: "PRIVATE_RESUME",
          resumeReceipt: "PRIVATE_RECEIPT",
        },
      },
      role,
      [member],
    );
    expect(p.receipt.html).toContain("&lt;img");
    expect(p.receipt.html).not.toContain("<img src=x");
    expect(JSON.stringify(p)).not.toMatch(
      /PRIVATE_ANSWER|PRIVATE_RESUME|PRIVATE_RECEIPT|attachments|bcc/,
    );
  });
  it("uses stable separate keys, accurate saved dates and never asserts delivery or hiring decisions", () => {
    const p = prepareHiringEmails(a, role, [member]);
    expect(prepareHiringEmails(a, role, [member])).toEqual(p);
    expect(p.receipt.idempotencyKey).toBe(`hiring/${a.id}/applicant_receipt/v1`);
    expect(p.receipt.text).toContain("November 13, 2026");
    expect(p.receipt.text).toContain("not a hiring decision");
    if (p.ownerAlert.state !== "prepared") throw new Error("Missing alert");
    expect(p.ownerAlert.idempotencyKey).not.toBe(p.receipt.idempotencyKey);
    expect(p.ownerAlert.text).toContain("9:42 AM CST");
    expect(JSON.stringify(p)).not.toMatch(
      /interview guaranteed|within 48|"sent"|"delivered"|"queued"/,
    );
  });
  it("existing transport refuses both prepared recipients, without invoking even a mocked provider", async () => {
    const f = vi.fn().mockRejectedValue(new Error("Provider unavailable"));
    const p = prepareHiringEmails(a, role, [member]);
    if (p.ownerAlert.state !== "prepared") throw new Error("Missing alert");
    for (const m of [p.receipt, p.ownerAlert]) {
      expect(
        await sendHiringQA(
          {
            base: "https://provider.invalid",
            headers: {},
            id: m.idempotencyKey,
            revision: 1,
            recipient: m.to[0],
            subject: m.subject,
            body: m.text,
          },
          f,
        ),
      ).toEqual({ state: "failed", id: null, code: "qa_recipient_required" });
    }
    expect(f).not.toHaveBeenCalled();
  });
  it("durable application success remains independent of unavailable email provider", async () => {
    vi.stubEnv("TRUST_TAI_SUPABASE_SERVICE_KEY", "sb_secret_synthetic");
    const f = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("hiring_runtime")) return Response.json({ intake_enabled: true });
      if (String(url).includes("rpc/hiring_submit")) return Response.json(a.id);
      throw new Error("Email provider must not be called");
    });
    vi.stubGlobal("fetch", f);
    expect(
      await publicHiring("submit", {
        submissionId: a.id,
        jobSlug: role.slug,
        fullName: a.full_name,
        email: a.email,
        location: "Test",
        timezone: "UTC",
        answers: {},
        consent: true,
        resumePath: `${a.id}/resume.pdf`,
        resumeName: "synthetic.pdf",
        resumeReceipt: "a".repeat(64),
      }),
    ).toEqual({ ok: true, applicationId: a.id, delivery: "disabled" });
    expect(f).toHaveBeenCalledTimes(2);
  });
});
