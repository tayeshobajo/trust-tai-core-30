import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

import { fetchCompanyIdentity, toStoredIdentity } from "./company-identity";
import { mergeProspectMetadata } from "./prospects";
import { readCompanyIdentity } from "@/lib/company-identity";
import { companyIconSources } from "@/lib/company-identity";

describe("company-identity edge function client", () => {
  beforeEach(() => invoke.mockReset());

  it("keeps only real declared values", () => {
    expect(
      toStoredIdentity({
        theme_color: "#1D54C1",
        logo_url: "https://teamsynerg.com/logo.svg",
        logo_source: "json_ld",
        fetched_at: "2026-08-13T00:00:00.000Z",
      }),
    ).toEqual({
      theme_color: "#1d54c1",
      logo_url: "https://teamsynerg.com/logo.svg",
      logo_source: "json_ld",
      fetched_at: "2026-08-13T00:00:00.000Z",
    });
  });

  it("returns null when the site declared nothing usable", () => {
    expect(toStoredIdentity({ theme_color: "brandish", logo_url: "http://x/logo.png" })).toBeNull();
    expect(toStoredIdentity({ error: "unreachable" })).toBeNull();
    expect(toStoredIdentity(null)).toBeNull();
  });

  it("never throws when the function fails", async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(fetchCompanyIdentity("https://teamsynerg.com")).resolves.toBeNull();

    invoke.mockRejectedValueOnce(new Error("network"));
    await expect(fetchCompanyIdentity("https://teamsynerg.com")).resolves.toBeNull();
  });

  it("returns the stored shape on success", async () => {
    invoke.mockResolvedValueOnce({
      data: { theme_color: "#0a7d55", logo_source: "link_icon" },
      error: null,
    });
    const identity = await fetchCompanyIdentity("https://teamsynerg.com");
    expect(identity?.theme_color).toBe("#0a7d55");
    expect(identity?.logo_url).toBeUndefined();
  });
});

describe("prospect metadata merge", () => {
  const fit = { light: "yellow", score: 61 };
  const override = { light: "green", by: "user-1", at: "2026-08-01T00:00:00.000Z" };

  it("preserves scout_fit and override when identity is added", () => {
    const merged = mergeProspectMetadata(
      { scout_fit: fit, scout_fit_override: override, unrelated: true },
      { scout_fit: { light: "green", score: 80 }, identity: { theme_color: "#1d54c1" } },
    );
    expect(merged["scout_fit_override"]).toEqual(override);
    expect(merged["unrelated"]).toBe(true);
    expect(merged["identity"]).toEqual({ theme_color: "#1d54c1" });
    expect(merged["scout_fit"]).toEqual({ light: "green", score: 80 });
  });

  it("leaves existing identity untouched when a research run has none", () => {
    const merged = mergeProspectMetadata(
      { identity: { theme_color: "#1d54c1" }, scout_fit: fit },
      { scout_fit: fit },
    );
    expect(merged["identity"]).toEqual({ theme_color: "#1d54c1" });
  });
});

describe("reading persisted identity", () => {
  const metadata = {
    scout_fit: { light: "red", score: 12 },
    identity: {
      theme_color: "#1d54c1",
      logo_url: "https://teamsynerg.com/logo.svg",
      logo_source: "json_ld",
      fetched_at: "2026-08-13T00:00:00.000Z",
    },
  };

  it("consumes metadata.identity exactly as persisted", () => {
    expect(readCompanyIdentity({ metadata })).toEqual({
      themeColor: "#1d54c1",
      logoUrl: "https://teamsynerg.com/logo.svg",
      logoSource: "json_ld",
      fetchedAt: "2026-08-13T00:00:00.000Z",
    });
  });

  it("prefers the persisted logo over favicon paths, keeping the chain", () => {
    const identity = readCompanyIdentity({ metadata });
    const sources = companyIconSources("https://teamsynerg.com", identity.logoUrl);
    expect(sources[0]).toBe("https://teamsynerg.com/logo.svg");
    expect(sources.slice(1)).toEqual([
      "https://teamsynerg.com/apple-touch-icon.png",
      "https://teamsynerg.com/favicon.png",
      "https://teamsynerg.com/favicon.svg",
      "https://teamsynerg.com/favicon.ico",
    ]);
  });

  it("renders exactly as before when no identity was persisted", () => {
    expect(readCompanyIdentity({ metadata: { scout_fit: { light: "red" } } })).toEqual({});
  });

  it("keeps theme colour out of fit semantics", () => {
    const identity = readCompanyIdentity({ metadata });
    expect(identity.themeColor).toBe("#1d54c1");
    // Fit state is read from scout_fit alone; identity carries no fit keys.
    expect(Object.keys(identity)).not.toContain("light");
    expect(metadata.scout_fit.light).toBe("red");
  });
});
