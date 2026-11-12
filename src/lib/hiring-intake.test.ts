import { afterEach, describe, expect, it, vi } from "vitest";
import { publicHiring, publicHiringSubmission } from "./hiring-intake.server";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const input = {
  submissionId: "11111111-1111-4111-8111-111111111111",
  jobSlug: "digital-sales-intern",
  fullName: "Synthetic QA",
  email: "delivered@resend.dev",
  location: "Test",
  timezone: "UTC",
  answers: { intro: "Personal introduction" },
  consent: true,
  resumePath: "11111111-1111-4111-8111-111111111111/resume.pdf",
  resumeName: "qa.pdf",
  resumeReceipt: "a".repeat(64),
};
describe("canonical public intake", () => {
  it("requires review consent, location, receipt and safe asset paths", () => {
    expect(publicHiringSubmission.safeParse(input).success).toBe(true);
    for (const patch of [
      { consent: false },
      { location: "" },
      { resumeReceipt: "guess" },
      { resumePath: "../private.pdf" },
      { linkedinUrl: "http://example.com" },
      { answers: { a: "", b: "", c: "", d: "" } },
    ])
      expect(publicHiringSubmission.safeParse({ ...input, ...patch }).success).toBe(false);
  });
  it("does not share service credentials with public callers", async () => {
    vi.stubEnv("TRUST_TAI_SUPABASE_SERVICE_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(publicHiring("jobs", {})).rejects.toThrow("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("fails closed on the database intake switch before upload or submission", async () => {
    vi.stubEnv("TRUST_TAI_SUPABASE_SERVICE_KEY", "sb_secret_synthetic");
    const fetcher = vi
      .fn()
      .mockImplementation(async () => Response.json({ intake_enabled: false }));
    vi.stubGlobal("fetch", fetcher);
    expect(await publicHiring("upload", {})).toEqual({ ok: false, error: "not_open" });
    expect(await publicHiring("submit", input)).toEqual({ ok: false, error: "not_open" });
    expect(fetcher.mock.calls.every(([url]) => String(url).includes("hiring_runtime"))).toBe(true);
  });
  it("limits public listing to published states and excludes internal owner fields", async () => {
    vi.stubEnv("TRUST_TAI_SUPABASE_SERVICE_KEY", "sb_secret_synthetic");
    const fetcher = vi.fn(async (url: string | URL | Request) =>
      Response.json(String(url).includes("hiring_runtime") ? { intake_enabled: false } : []),
    );
    vi.stubGlobal("fetch", fetcher);
    expect(await publicHiring("jobs", {})).toEqual({ jobs: [], accepting: false });
    const url = new URL(String(fetcher.mock.calls[0]![0]));
    expect(url.searchParams.get("status")).toBe("in.(open,closed)");
    expect(url.searchParams.get("select")).not.toContain("owner");
  });
  it("does not acknowledge a saved application for an invalid receipt", async () => {
    vi.stubEnv("TRUST_TAI_SUPABASE_SERVICE_KEY", "sb_secret_synthetic");
    const fetcher = vi.fn().mockResolvedValue(Response.json([]));
    vi.stubGlobal("fetch", fetcher);
    expect(
      await publicHiring("receipt", {
        submissionId: input.submissionId,
        receipt: input.resumeReceipt,
      }),
    ).toEqual({ saved: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
