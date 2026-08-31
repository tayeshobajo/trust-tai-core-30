import { describe, expect, it, vi } from "vitest";

import {
  buildLookupKeywords,
  linkiFindPerson,
  linkiEnrichProfiles,
  linkiStatus,
  normalizeName,
  rankCandidates,
  NO_CONFIDENT_MATCH_REASON,
  type LinkiCandidate,
} from "./linki-provider.server";

const ENV = { LINKI_API_KEY: "test-secret", LINKI_BASE_URL: "http://127.0.0.1:3456" };
// Non-local base so the /api/tt/* adapter routes are exercised as in production.
const ENV_TT = { LINKI_API_KEY: "test-secret", LINKI_BASE_URL: "https://linki.trusttai.com" };

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

describe("linkiFindPerson — pages param (enrichment pipeline)", () => {
  it("sends pages: 3 in the lookup body", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await linkiFindPerson({ fullName: "Isaac Meek", companyName: "Acme" }, ENV);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      keywords: string;
      pages?: number;
    };
    expect(body.keywords).toBe("Isaac Meek");
    expect(body.pages).toBe(3);
    vi.unstubAllGlobals();
  });
});

describe("linkiFindPerson — enrichment flow", () => {
  const BAKERY_PERSON = {
    fullName: "David Andrews",
    companyName: "D'Andrews Bakery & Cafe",
    roleTitle: "Owner",
  };

  // Name-shielded shortlist: all pass the first/last-name shield on "David
  // Andrews", but none carries search-snippet evidence above the 1.5 bar —
  // exactly the live false-negative the enrichment pipeline exists to fix.
  const SHORTLIST = [
    { linkedin_url: "https://www.linkedin.com/in/david-andrews-0868a2132/", full_name: "David Andrews", headline: null, location: null, degree: null, company: null },
    { linkedin_url: "https://www.linkedin.com/in/david-andrews-1/", full_name: "David Andrews", headline: null, location: null, degree: null, company: null },
    { linkedin_url: "https://www.linkedin.com/in/david-andrews-2/", full_name: "David Andrews", headline: null, location: null, degree: null, company: null },
  ];

  const lookupResponse = () =>
    new Response(JSON.stringify({ candidates: SHORTLIST }), { status: 200 });

  const enrichResponse = () =>
    new Response(
      JSON.stringify({
        profiles: [
          {
            url: "https://www.linkedin.com/in/david-andrews-0868a2132/",
            full_name: "David Andrews",
            headline: "Owner at D'Andrews Bakery & Cafe",
            company: "D'Andrews Bakery & Cafe",
            title: "Owner",
            location: "Nashville, Tennessee",
          },
        ],
      }),
      { status: 200 },
    );

  it("short-circuits: no enrich call when a confident hit already exists (fetch called once)", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              linkedin_url: "https://www.linkedin.com/in/isaac-meek/",
              full_name: "Isaac Meek",
              headline: "Director, Business Development at New England Biolabs",
              company: "New England Biolabs",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await linkiFindPerson(
      {
        fullName: "Isaac Meek",
        companyName: "New England Biolabs",
        roleTitle: "Director, Business Development",
      },
      ENV,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("enrich merge produces a confident card for the bakery owner over a name-shielded shortlist", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => lookupResponse())
      .mockImplementationOnce(async () => enrichResponse());
    vi.stubGlobal("fetch", fetchMock);

    const candidates = await linkiFindPerson(BAKERY_PERSON, ENV_TT);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const enrichCall = fetchMock.mock.calls[1];
    expect(String(enrichCall?.[0])).toContain("/api/tt/enrich");
    const enrichBody = JSON.parse(String(enrichCall?.[1]?.body)) as { urls: string[] };
    // All three name-matching candidates tie at similarity 1.0 → all enter the top-5 shortlist.
    expect(enrichBody.urls).toEqual([
      "https://www.linkedin.com/in/david-andrews-0868a2132/",
      "https://www.linkedin.com/in/david-andrews-1/",
      "https://www.linkedin.com/in/david-andrews-2/",
    ]);

    const { ranked } = rankCandidates(BAKERY_PERSON, candidates);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.linkedinUrl).toBe("https://www.linkedin.com/in/david-andrews-0868a2132/");
    expect(ranked[0]?.company).toBe("D'Andrews Bakery & Cafe");
    expect(ranked[0]?.why.join(" ")).toMatch(/company/i);
    vi.unstubAllGlobals();
  });

  it("falls back to unenriched (empty confident result) when enrich fails — no throw", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => lookupResponse())
      .mockImplementationOnce(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const candidates = await linkiFindPerson(BAKERY_PERSON, ENV_TT);
    expect(Array.isArray(candidates)).toBe(true);
    const { ranked, noMatchReason } = rankCandidates(BAKERY_PERSON, candidates);
    expect(ranked).toHaveLength(0);
    expect(noMatchReason).toBe(NO_CONFIDENT_MATCH_REASON);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe("linkiEnrichProfiles", () => {
  it("mirrors the Linki envelope and validates /in/ urls client-side", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            profiles: [
              {
                url: "https://www.linkedin.com/in/david-andrews-0868a2132/",
                full_name: "David Andrews",
                headline: "Owner at D'Andrews Bakery & Cafe",
                company: "D'Andrews Bakery & Cafe",
                title: "Owner",
                location: "Nashville, Tennessee",
              },
              { url: "https://example.com/in/x/", full_name: "Wrong host" },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const profiles = await linkiEnrichProfiles(
      { urls: ["https://www.linkedin.com/in/david-andrews-0868a2132/"] },
      ENV,
    );
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.full_name).toBe("David Andrews");
    expect(profiles[0]?.company).toBe("D'Andrews Bakery & Cafe");
    vi.unstubAllGlobals();
  });

  it("rejects non-/in/ urls before any network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const profiles = await linkiEnrichProfiles(
      {
        urls: [
          "https://www.linkedin.com/company/dandrews-bakery/",
          "https://example.com/in/x/",
          "https://www.linkedin.com/in/someone/detail/",
          "not-a-url",
        ],
      },
      ENV,
    );
    expect(profiles).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("includes search_name in the body when searchName is provided (nav-first)", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ profiles: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await linkiEnrichProfiles(
      {
        urls: ["https://www.linkedin.com/in/david-andrews-0868a2132/"],
        searchName: "David Andrews",
      },
      ENV_TT,
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      urls: string[];
      search_name?: string;
    };
    expect(body.urls).toEqual(["https://www.linkedin.com/in/david-andrews-0868a2132/"]);
    expect(body.search_name).toBe("David Andrews");
    vi.unstubAllGlobals();
  });

  it("omits search_name when searchName is absent (legacy contract unchanged)", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ profiles: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await linkiEnrichProfiles(
      { urls: ["https://www.linkedin.com/in/david-andrews-0868a2132/"] },
      ENV_TT,
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body["urls"]).toEqual(["https://www.linkedin.com/in/david-andrews-0868a2132/"]);
    expect("search_name" in body).toBe(false);
    vi.unstubAllGlobals();
  });

  it("merges partial profiles when Linki reports stopped_reason (fail-soft, informational)", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            profiles: [
              {
                url: "https://www.linkedin.com/in/david-andrews-0868a2132/",
                full_name: "David Andrews",
                headline: "Owner at D'Andrews Bakery & Cafe",
                company: "D'Andrews Bakery & Cafe",
                title: "Owner",
                location: "Nashville, Tennessee",
              },
            ],
            stopped_reason: "risk_wall",
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const profiles = await linkiEnrichProfiles(
      { urls: ["https://www.linkedin.com/in/david-andrews-0868a2132/"], searchName: "David Andrews" },
      ENV_TT,
    );
    // Partial profiles still flow through — stopped_reason never throws.
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.full_name).toBe("David Andrews");
    expect(info).toHaveBeenCalled();
    info.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe("linkiFindPerson — nav-first searchName passthrough", () => {
  const SHORTLIST = [
    { linkedin_url: "https://www.linkedin.com/in/david-andrews-0868a2132/", full_name: "David Andrews", headline: null, location: null, degree: null, company: null },
    { linkedin_url: "https://www.linkedin.com/in/david-andrews-1/", full_name: "David Andrews", headline: null, location: null, degree: null, company: null },
  ];

  it("sends the person's fullName as search_name on the enrich call", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () =>
        new Response(JSON.stringify({ candidates: SHORTLIST }), { status: 200 }))
      .mockImplementationOnce(async () =>
        new Response(JSON.stringify({ profiles: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await linkiFindPerson({ fullName: "David Andrews", companyName: "D'Andrews Bakery" }, ENV_TT);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const enrichCall = fetchMock.mock.calls[1];
    expect(String(enrichCall?.[0])).toContain("/api/tt/enrich");
    const enrichBody = JSON.parse(String(enrichCall?.[1]?.body)) as {
      urls: string[];
      search_name?: string;
    };
    expect(enrichBody.search_name).toBe("David Andrews");
    // Shortlist stays at ≤5 — Linki enforces its own cap of 3 nav-first.
    expect(enrichBody.urls.length).toBeLessThanOrEqual(5);
    vi.unstubAllGlobals();
  });
});
