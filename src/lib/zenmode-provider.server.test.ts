/**
 * ZenMode provider — lead normalization, envelope shape and fail-closed gating.
 *
 * The regression that matters most here: ZenMode sends `lead_id` and
 * `campaign_id` as JSON NUMBERS. A string-only coercion drops every lead and
 * the import reports zero — indistinguishable from "the campaign found nobody
 * yet". That silence is the bug, so it gets pinned.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ZENMODE_DEFAULT_BASE_URL,
  ZENMODE_LEADS_PAGE_SIZE,
  normalizeZenModeLead,
  zenModeConfig,
  zenModeListAllLeads,
  zenModeStatus,
} from "@/lib/zenmode-provider.server";

const ENABLED = { ZENMODE_READ_ENABLED: "true", ZENMODE_API_KEY: "zm_test_key" };

describe("normalizeZenModeLead", () => {
  it("keeps a lead whose ids arrive as numbers", () => {
    const lead = normalizeZenModeLead({
      lead_id: 37110,
      campaign_id: 2347,
      name: "Omar Molina",
      linkedin_url: "https://www.linkedin.com/in/example",
      company_name: "Molina Rooling",
      title: "Founder",
      status: "replied",
    });
    expect(lead).not.toBeNull();
    expect(lead?.leadId).toBe("37110");
    expect(lead?.campaignId).toBe("2347");
    expect(lead?.name).toBe("Omar Molina");
  });

  it("accepts string ids and the camelCase aliases", () => {
    const lead = normalizeZenModeLead({
      id: "lead_abc",
      campaignId: "camp_9",
      fullName: "Dana Reyes",
      linkedinUrl: "https://www.linkedin.com/in/dana",
      companyName: "Reyes Group",
      websiteUrl: "https://reyes.example",
      headline: "CEO",
    });
    expect(lead?.leadId).toBe("lead_abc");
    expect(lead?.campaignId).toBe("camp_9");
    expect(lead?.name).toBe("Dana Reyes");
    expect(lead?.title).toBe("CEO");
    expect(lead?.websiteUrl).toBe("https://reyes.example");
  });

  it("drops a record with no id rather than inventing provenance", () => {
    expect(normalizeZenModeLead({ name: "No Id" })).toBeNull();
    expect(normalizeZenModeLead({ lead_id: "   " })).toBeNull();
    expect(normalizeZenModeLead({ lead_id: Number.NaN })).toBeNull();
    expect(normalizeZenModeLead(null)).toBeNull();
    expect(normalizeZenModeLead([1, 2])).toBeNull();
  });

  it("preserves the raw record so nothing observed is silently dropped", () => {
    const entry = { lead_id: 1, unexpected_field: "keep me" };
    expect(normalizeZenModeLead(entry)?.raw).toEqual(entry);
  });

  it("leaves absent optional fields null instead of guessing", () => {
    const lead = normalizeZenModeLead({ lead_id: 5 });
    expect(lead?.linkedinUrl).toBeNull();
    expect(lead?.companyName).toBeNull();
    expect(lead?.campaignId).toBeNull();
  });
});

describe("zenModeListAllLeads", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Serve `total` leads through ZenMode's `{leads, pagination}` envelope,
   * honouring limit/offset, and record every URL requested. */
  function stubLeads(total: number): { urls: string[] } {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      const params = new URL(url).searchParams;
      const limit = Number(params.get("limit") ?? ZENMODE_LEADS_PAGE_SIZE);
      const offset = Number(params.get("offset") ?? 0);
      const leads = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => ({
        id: offset + i + 1,
        linkedin_url: `https://www.linkedin.com/in/p${offset + i + 1}`,
      }));
      const body = JSON.stringify({ leads, pagination: { limit, offset, returned: leads.length } });
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    });
    return { urls };
  }

  it("pages past ZenMode's default cap instead of stopping at 100", async () => {
    const { urls } = stubLeads(114);
    const leads = await zenModeListAllLeads({}, ENABLED);
    expect(leads).toHaveLength(114);
    expect(new Set(leads.map((lead) => lead.leadId)).size).toBe(114);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain("offset=100");
  });

  it("stops after one call when the first page is already short", async () => {
    const { urls } = stubLeads(7);
    expect(await zenModeListAllLeads({}, ENABLED)).toHaveLength(7);
    expect(urls).toHaveLength(1);
  });

  it("stops on an exact page boundary without looping forever", async () => {
    const { urls } = stubLeads(ZENMODE_LEADS_PAGE_SIZE);
    expect(await zenModeListAllLeads({}, ENABLED)).toHaveLength(ZENMODE_LEADS_PAGE_SIZE);
    expect(urls).toHaveLength(2);
  });

  it("carries filters onto every page", async () => {
    const { urls } = stubLeads(150);
    await zenModeListAllLeads({ status: "pending", campaignId: "2347" }, ENABLED);
    expect(urls).toHaveLength(2);
    for (const url of urls) {
      expect(url).toContain("status=pending");
      expect(url).toContain("campaign_id=2347");
    }
  });

  it("stays inert when ZenMode is not configured", async () => {
    const { urls } = stubLeads(50);
    expect(await zenModeListAllLeads({}, { ZENMODE_API_KEY: "zm_test_key" })).toEqual([]);
    expect(urls).toHaveLength(0);
  });
});

describe("zenModeConfig / zenModeStatus", () => {
  it("is inert unless the read flag is explicitly 'true'", () => {
    expect(zenModeConfig({ ZENMODE_API_KEY: "zm_test_key" })).toBeNull();
    expect(zenModeConfig({ ...ENABLED, ZENMODE_READ_ENABLED: "1" })).toBeNull();
  });

  it("is inert without an API key, even when enabled", () => {
    expect(zenModeConfig({ ZENMODE_READ_ENABLED: "true" })).toBeNull();
    expect(zenModeConfig({ ZENMODE_READ_ENABLED: "true", ZENMODE_API_KEY: "  " })).toBeNull();
  });

  it("defaults the base url and strips a trailing slash", () => {
    expect(zenModeConfig(ENABLED)?.baseUrl).toBe(ZENMODE_DEFAULT_BASE_URL);
    expect(
      zenModeConfig({ ...ENABLED, ZENMODE_BASE_URL: "https://example.test/api/v1//" })?.baseUrl,
    ).toBe("https://example.test/api/v1");
  });

  it("reports enabled-but-unconfigured distinctly from configured", () => {
    expect(zenModeStatus({ ZENMODE_READ_ENABLED: "true" })).toEqual({
      configured: false,
      enabled: true,
      baseUrl: null,
    });
    expect(zenModeStatus(ENABLED)).toEqual({
      configured: true,
      enabled: true,
      baseUrl: ZENMODE_DEFAULT_BASE_URL,
    });
  });
});
