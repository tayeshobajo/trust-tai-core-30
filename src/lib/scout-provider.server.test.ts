import { describe, expect, it } from "vitest";

import {
  modelForProvider,
  scoutProviderStatus,
  selectScoutProvider,
} from "./scout-provider.server";
import { buildDiscoveryRequestBody, CANDIDATE_SCHEMA } from "./scout-discovery-request";
import { acceptCandidates, discoveryEvaluation } from "@/data/scout-candidate-validation";

describe("scout provider selection", () => {
  it("prefers direct OpenAI when OPENAI_API_KEY is present", () => {
    const selected = selectScoutProvider({ OPENAI_API_KEY: "k", LOVABLE_API_KEY: "l" });
    expect(selected?.provider).toBe("openai");
    expect(selected?.model).toBe("gpt-5-mini");
    expect(selected?.endpoint).toBe("https://api.openai.com/v1/responses");
    expect(selected?.headers["Authorization"]).toBe("Bearer k");
    expect(selected?.headers["Lovable-API-Key"]).toBeUndefined();
  });

  it("falls back to the Lovable gateway with a vendor-prefixed model", () => {
    const selected = selectScoutProvider({ LOVABLE_API_KEY: "l" });
    expect(selected?.provider).toBe("lovable");
    expect(selected?.model).toBe("openai/gpt-5-mini");
    expect(selected?.endpoint).toBe("https://ai.gateway.lovable.dev/v1/responses");
    expect(selected?.headers["Authorization"]).toBeUndefined();
  });

  it("fails closed when nothing is configured", () => {
    expect(selectScoutProvider({})).toBeNull();
    expect(scoutProviderStatus({}).configured).toBe(false);
    expect(scoutProviderStatus({}).provider).toBeNull();
  });

  it("normalizes model overrides per provider", () => {
    expect(modelForProvider("openai", { SCOUT_DISCOVERY_MODEL: "openai/gpt-5" })).toBe("gpt-5");
    expect(modelForProvider("openai", { SCOUT_OPENAI_MODEL: "gpt-5" })).toBe("gpt-5");
    expect(modelForProvider("lovable", { SCOUT_DISCOVERY_MODEL: "gpt-5" })).toBe("openai/gpt-5");
    expect(modelForProvider("lovable", { SCOUT_DISCOVERY_MODEL: "google/gemini-3.6-flash" })).toBe(
      "google/gemini-3.6-flash",
    );
  });

  it("never exposes secrets in the config probe", () => {
    const status = scoutProviderStatus({ OPENAI_API_KEY: "super-secret" });
    expect(JSON.stringify(status)).not.toContain("super-secret");
    expect(status).toMatchObject({ configured: true, provider: "openai", model: "gpt-5-mini" });
    expect(status.capabilities.webSearch).toBe(true);
  });
});

describe("discovery request", () => {
  it("always asks for web_search and strict structured output", () => {
    const body = buildDiscoveryRequestBody({
      model: "gpt-5-mini",
      query: "IT companies in Nashville",
      limit: 10,
      icp: "ICP text",
      calibration: "",
    }) as Record<string, any>;
    expect(body["tools"]).toEqual([{ type: "web_search" }]);
    expect(body["stream"]).toBe(true);
    expect(body["text"].format.strict).toBe(true);
    expect(body["text"].format.schema).toBe(CANDIDATE_SCHEMA);
    expect(body["instructions"]).toContain("ICP text");
    expect(body["input"]).toContain("IT companies in Nashville");
  });
});

/** A mocked provider success path: stream -> parse -> validate -> evaluate. */
function mockedProviderStream(payload: unknown): string {
  const text = JSON.stringify(payload);
  return text
.match(/.{1,40}/g)!
.map((chunk) => `data: ${JSON.stringify({ type: "response.output_text.delta", delta: chunk })}\n`)
.join("") + "data: [DONE]\n";
}

function parseStream(sse: string): string {
  let raw = "";
  for (const line of sse.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const body = line.slice(5).trim();
    if (!body || body === "[DONE]") continue;
    const event = JSON.parse(body) as Record<string, unknown>;
    if (event["type"] === "response.output_text.delta") raw += String(event["delta"]);
  }
  return raw;
}

describe("mocked provider success path", () => {
  const payload = {
    candidates: [
      {
        company_name: "Nashville Managed IT",
        website: "https://www.nashvillemanagedit.com",
        location: "Nashville, TN",
        industry: "Managed IT services",
        summary: "Managed IT provider serving mid-market clients.",
        discovery_reason: "US B2B IT services firm with public services pages.",
        observed_evidence: [
          { statement: "Lists managed IT services", source_url: "https://www.nashvillemanagedit.com/services" },
          { statement: "Based in Nashville, TN", source_url: "https://www.nashvillemanagedit.com/contact" },
        ],
        source_urls: ["https://www.nashvillemanagedit.com/services"],
        unknowns: ["Headcount not published"],
        icp_fit: {
          light: "green",
          score: 78,
          confidence: "moderate",
          reasoning: "Matches services and geography; size unknown.",
          criteria: [
            { name: "B2B services", weight: 30, status: "met", score_contribution: 30, evidence: "Services page", source_urls: [], confidence: "high" },
            { name: "Headcount 10-250", weight: 20, status: "unknown", score_contribution: 0, evidence: "Not published", source_urls: [], confidence: "unknown" },
          ],
        },
      },
      // duplicate root domain (www + path), must be de-duped, not rejected
      { company_name: "Nashville Managed IT (dup)", website: "http://nashvillemanagedit.com/about", source_urls: ["https://x.com"], observed_evidence: [], icp_fit: {} },
      // evidence-free, must be rejected
      { company_name: "No Evidence Co", website: "https://noevidence.com", source_urls: [], observed_evidence: [], icp_fit: {} },
      // malformed website, must be rejected
      { company_name: "Broken", website: "not a url", source_urls: ["https://x.com"], observed_evidence: [], icp_fit: {} },
    ],
  };

  it("parses, validates, dedupes and evaluates without injecting fixtures", () => {
    const raw = parseStream(mockedProviderStream(payload));
    const parsed = JSON.parse(raw) as { candidates: any[] };
    const { accepted, rejected, duplicates } = acceptCandidates(parsed.candidates);

    expect(accepted).toHaveLength(1);
    expect(rejected).toBe(2);
    expect(duplicates).toBe(1);
    expect(accepted[0]!.domain).toBe("nashvillemanagedit.com");
    expect(accepted[0]!.candidate.source_urls!.length).toBeGreaterThan(0);

    const evaluation = discoveryEvaluation(accepted[0]!.candidate, { icpVersion: 3, at: "2026-01-01T00:00:00Z" });
    // Conservative: green claimed with only 2 evidence points is demoted.
    expect(evaluation["light"]).toBe("yellow");
    expect(evaluation["score"]).toBe(78);
    expect(evaluation["confidence"]).toBe("moderate");
    expect(evaluation["icpVersion"]).toBe(3);

    // Unknown evidence must never read as a mismatch.
    const criteria = evaluation["criteria"] as Array<Record<string, unknown>>;
    const unknown = criteria.find((c) => c["label"] === "Headcount 10-250");
    expect(unknown?.["state"]).toBe("missing");
    expect(unknown?.["state"]).not.toBe("mismatch");
  });
});
