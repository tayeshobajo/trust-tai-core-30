import { describe, expect, it, vi } from "vitest";

import {
  buildLookupKeywords,
  linkiFindPerson,
  linkiStatus,
} from "./linki-provider.server";

const ENV = { LINKI_API_KEY: "test-secret", LINKI_BASE_URL: "http://127.0.0.1:3456" };

describe("linki provider config", () => {
  it("fails closed when no API key is configured", () => {
    expect(linkiStatus({}).configured).toBe(false);
  });

  it("is disabled when LINKI_ENABLED=false, even with a key", () => {
    expect(linkiStatus({ ...ENV, LINKI_ENABLED: "false" }).configured).toBe(false);
  });

  it("exposes the base URL but never the key", () => {
    const status = linkiStatus(ENV);
    expect(status.configured).toBe(true);
    expect(status.baseUrl).toBe("http://127.0.0.1:3456");
    expect(JSON.stringify(status)).not.toContain("test-secret");
  });
});

describe("buildLookupKeywords", () => {
  it("joins name, company, and role", () => {
    expect(
      buildLookupKeywords({ fullName: "Isaac Meek", companyName: "Acme", roleTitle: "Founder" }),
    ).toBe("Isaac Meek Acme Founder");
  });

  it("name alone is enough; domain is never included", () => {
    expect(buildLookupKeywords({ fullName: "Isaac Meek", companyDomain: "acme.com" })).toBe(
      "Isaac Meek",
    );
  });

  it("collapses redundant whitespace", () => {
    expect(buildLookupKeywords({ fullName: "  Isaac   Meek " })).toBe("Isaac Meek");
  });
});

describe("linkiFindPerson", () => {
  it("validates candidate shape and drops junk entries", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          candidates: [
            { linkedin_url: "https://www.linkedin.com/in/isaac-meek/", full_name: "Isaac Meek", headline: "Co-founder · Acme", location: null, degree: null },
            { linkedin_url: "https://www.linkedin.com/in/isaac-meek/detail/", full_name: "Sub-route" }, // sub-path — rejected
            { linkedin_url: "https://example.com/in/x/", full_name: "Wrong host" }, // not linkedin.com — rejected
            { linkedin_url: "https://www.linkedin.com/in/no-name/" }, // no name — rejected
            "garbage",
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const found = await linkiFindPerson({ fullName: "Isaac Meek", companyName: "Acme" }, ENV);
    expect(found).toHaveLength(1);
    expect(found[0]?.fullName).toBe("Isaac Meek");
    expect(found[0]?.linkedinUrl).toBe("https://www.linkedin.com/in/isaac-meek/");
    vi.unstubAllGlobals();
  });

  it("throws (never returns empty) on a re-auth signal so the UI can say the session died", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    await expect(linkiFindPerson({ fullName: "Isaac Meek" }, ENV)).rejects.toThrow(/re-authentication/);
    vi.unstubAllGlobals();
  });

  it("throws on secret rejection instead of pretending no routes exist", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    await expect(linkiFindPerson({ fullName: "Isaac Meek" }, ENV)).rejects.toThrow(/internal secret/);
    vi.unstubAllGlobals();
  });

  it("returns [] without calling Linki when unconfigured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(linkiFindPerson({ fullName: "Isaac Meek" }, {})).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
