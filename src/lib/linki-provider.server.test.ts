import { describe, expect, it, vi } from "vitest";

import {
  buildLookupKeywords,
  linkiFindPerson,
  linkiStatus,
  normalizeName,
  rankCandidates,
  NO_CONFIDENT_MATCH_REASON,
  type LinkiCandidate,
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

describe("normalizeName (P1.10: search tokens must be clean)", () => {
  it("maps U+2011 non-breaking hyphen to ASCII hyphen", () => {
    expect(normalizeName("Anne\u2011Marie Dupont")).toBe("Anne-Marie Dupont");
  });

  it("NFKC-normalizes compatibility characters (full-width, ligatures)", () => {
    expect(normalizeName("Ｉｓａａｃ Meek")).toBe("Isaac Meek"); // full-width → ASCII
  });

  it("collapses whitespace runs to single spaces and trims", () => {
    expect(normalizeName("  Isaac \n\t  Meek ")).toBe("Isaac Meek");
  });
});

describe("buildLookupKeywords (P1.10: NAME ONLY)", () => {
  it("uses the name alone; company/title/domain/location are NEVER search tokens", () => {
    expect(
      buildLookupKeywords({
        fullName: "Isaac Meek",
        companyName: "Acme",
        roleTitle: "Founder",
        companyDomain: "acme.com",
        location: "Boston",
      }),
    ).toBe("Isaac Meek");
  });

  it("normalizes the name before search (U+2011, whitespace)", () => {
    expect(
      buildLookupKeywords({ fullName: "Anne\u2011Marie  Dupont", companyName: "Acme" }),
    ).toBe("Anne-Marie Dupont");
  });

  it("name alone is enough", () => {
    expect(buildLookupKeywords({ fullName: "Isaac Meek" })).toBe("Isaac Meek");
  });
});

describe("rankCandidates (P1.10: evidence ranking + fail closed)", () => {
  const person = {
    fullName: "Isaac Meek",
    companyName: "New England Biolabs",
    roleTitle: "Director, Business Development",
    location: "Greater Boston",
  };

  const mk = (over: Partial<LinkiCandidate>): LinkiCandidate => ({
    linkedinUrl: "https://www.linkedin.com/in/x/",
    fullName: "Isaac Meek",
    headline: null,
    location: null,
    degree: null,
    company: null,
    ...over,
  });

  it("ranks the candidate with more evidence on top", () => {
    const strong = mk({
      linkedinUrl: "https://www.linkedin.com/in/strong/",
      headline: "Director, Business Development at New England Biolabs",
      location: "Greater Boston",
      company: "New England Biolabs",
    });
    const weak = mk({
      linkedinUrl: "https://www.linkedin.com/in/weak/",
      headline: "Consultant — New England Biolabs alum",
      location: null,
      company: null,
    });
    const { ranked } = rankCandidates(person, [weak, strong]);
    expect(ranked[0]?.linkedinUrl).toBe("https://www.linkedin.com/in/strong/");
    expect(ranked[1]?.linkedinUrl).toBe("https://www.linkedin.com/in/weak/");
    // The strong candidate must strictly outscore the weak one.
    expect((ranked[0]?.score ?? 0) - (ranked[1]?.score ?? 0)).toBeGreaterThan(0);
  });

  it("emits a why[] evidence trail per offered candidate", () => {
    const { ranked } = rankCandidates(person, [
      mk({ headline: "Director, Business Development at New England Biolabs", company: "New England Biolabs" }),
    ]);
    expect(ranked).toHaveLength(1);
    const why = ranked[0]?.why.join(" ") ?? "";
    expect(why).toMatch(/company/i);
    expect(why).toMatch(/role/i);
    expect(why.length).toBeGreaterThan(0);
  });

  it("drops candidates whose name does not fuzzy-match (wrong-person shield)", () => {
    const { ranked, noMatchReason } = rankCandidates(person, [
      mk({
        fullName: "Murray Spence",
        headline: "Director, Business Development at New England Biolabs",
        company: "New England Biolabs",
      }),
    ]);
    expect(ranked).toHaveLength(0);
    expect(noMatchReason).toBe(NO_CONFIDENT_MATCH_REASON);
  });

  it("fails closed with the explicit no-match reason when nothing clears the bar", () => {
    const { ranked, noMatchReason } = rankCandidates(person, []);
    expect(ranked).toEqual([]);
    expect(noMatchReason).toBe("No confident LinkedIn match found");
  });

  it("a same-name candidate with zero evidence is not offered (score < 1)", () => {
    const { ranked, noMatchReason } = rankCandidates(person, [mk({})]);
    expect(ranked).toHaveLength(0);
    expect(noMatchReason).toBe(NO_CONFIDENT_MATCH_REASON);
  });

  it("matches company via headline when the company field is absent", () => {
    const { ranked } = rankCandidates(person, [
      mk({ headline: "Director of Biz Dev at New England Biolabs" }),
    ]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.why.join(" ")).toMatch(/biolabs/i);
  });

  it("domain root counts as website evidence", () => {
    const { ranked } = rankCandidates(
      { fullName: "Isaac Meek", companyDomain: "neb.com" },
      [mk({ headline: "Business Development at NEB" })],
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.why.join(" ")).toMatch(/website/i);
  });

  it("hyphen/space name variants still fuzzy-match (LinkedIn normalizes them)", () => {
    const { ranked } = rankCandidates(
      { fullName: "Anne-Marie Dupont", companyName: "Acme" },
      [mk({ fullName: "Anne Marie Dupont", headline: "CEO at Acme" })],
    );
    expect(ranked).toHaveLength(1);
  });

  it("rejects near-surname false positives even when role evidence matches", () => {
    const { ranked, noMatchReason } = rankCandidates(
      { fullName: "Jonathan Mull", companyName: "Mull IT", roleTitle: "Founder & CEO" },
      [
        mk({
          fullName: "Jonathan Muller",
          headline: "CEO / Co-Founder @ Gaffos.com | Leadership, Start-ups",
        }),
      ],
    );
    expect(ranked).toHaveLength(0);
    expect(noMatchReason).toBe(NO_CONFIDENT_MATCH_REASON);
  });

  it("rejects fabricated no-match cases that share only one name token", () => {
    const { ranked, noMatchReason } = rankCandidates(
      { fullName: "Zephram Holloway", companyName: "Imaginary Systems", roleTitle: "Founder" },
      [
        mk({
          fullName: "Zephram Carroll",
          headline: "Founder & Tech Lead at Syzlix Software Solutions",
          company: "Syzlix Software Solutions",
        }),
      ],
    );
    expect(ranked).toHaveLength(0);
    expect(noMatchReason).toBe(NO_CONFIDENT_MATCH_REASON);
  });
});

describe("linkiFindPerson", () => {
  it("validates candidate shape and drops junk entries", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          candidates: [
            { linkedin_url: "https://www.linkedin.com/in/isaac-meek/", full_name: "Isaac Meek", headline: "Co-founder · Acme", location: null, degree: null, company: null },
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

  it("sends NAME-ONLY keywords to Linki (P1.10: no pollution)", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await linkiFindPerson(
      { fullName: "Isaac Meek", companyName: "Acme", roleTitle: "Founder" },
      ENV,
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      keywords: string;
    };
    expect(body.keywords).toBe("Isaac Meek");
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
