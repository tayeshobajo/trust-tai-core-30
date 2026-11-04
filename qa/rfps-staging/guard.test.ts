import { describe, it, expect, vi } from "vitest";
import { stagingConfig, stagingFetch, stagingCsp, PRODUCTION_REF } from "./guard";
const env = {
  VITE_RFP_STAGING_PROJECT_REF: "abcdefghijklmnopqrst",
  VITE_RFP_STAGING_URL: "https://abcdefghijklmnopqrst.supabase.co",
  VITE_RFP_STAGING_PUBLISHABLE_KEY: "sb_publishable_SYNTHETIC_NOT_A_REAL_KEY",
};
describe("isolated staging boundary", () => {
  it("has no default or production fallback", () => {
    expect(() => stagingConfig({})).toThrow("disabled");
    expect(() => stagingConfig({ ...env, VITE_RFP_STAGING_PROJECT_REF: PRODUCTION_REF })).toThrow(
      "Production",
    );
  });
  it.each([
    "https://okydosoacqdnursmmenf.supabase.co",
    "https://abcdefghijklmnopqrst.supabase.co.evil.test",
    "http://abcdefghijklmnopqrst.supabase.co",
    "https://user:password@abcdefghijklmnopqrst.supabase.co",
    "https://abcdefghijklmnopqrst.supabase.co/path",
    "https://abcdefghijklmnopqrst.supabase.co?target=prod",
  ])("rejects unsafe origin %s", (url) =>
    expect(() => stagingConfig({ ...env, VITE_RFP_STAGING_URL: url })).toThrow(),
  );
  it.each([
    "sb_secret_test",
    "eyJhbGciOiJIUzI1NiJ9.test.jwt",
    "sb_publishable_uARvNwZli88tfhOHBwFTsQ_JUpQo-UL",
  ])("rejects secret/legacy/production key", (key) =>
    expect(() => stagingConfig({ ...env, VITE_RFP_STAGING_PUBLISHABLE_KEY: key })).toThrow(),
  );
  it("accepts only explicit matching hosted or loopback targets", () => {
    expect(stagingConfig(env).origin).toBe(env.VITE_RFP_STAGING_URL);
    expect(
      stagingConfig({
        ...env,
        VITE_RFP_STAGING_PROJECT_REF: "local",
        VITE_RFP_STAGING_URL: "http://127.0.0.1:54321",
      }).projectRef,
    ).toBe("local");
  });
  it("blocks production before transport, forbids redirect following and browser cookies", async () => {
    const transport = vi.fn().mockResolvedValue(new Response("{}"));
    const guarded = stagingFetch(stagingConfig(env), transport);
    await expect(
      guarded(`https://${PRODUCTION_REF}.supabase.co/rest/v1/organizations`),
    ).rejects.toThrow("Blocked");
    expect(transport).not.toHaveBeenCalled();
    await guarded(env.VITE_RFP_STAGING_URL + "/rest/v1/rfp_opportunities", {
      redirect: "follow",
      credentials: "include",
    });
    expect(transport).toHaveBeenCalledWith(
      env.VITE_RFP_STAGING_URL + "/rest/v1/rfp_opportunities",
      expect.objectContaining({ redirect: "error", credentials: "omit" }),
    );
  });
  it("CSP excludes production and other network destinations", () => {
    expect(stagingCsp(stagingConfig(env))).toContain(`connect-src ${env.VITE_RFP_STAGING_URL};`);
    expect(stagingCsp(stagingConfig(env))).not.toContain(PRODUCTION_REF);
  });
});
