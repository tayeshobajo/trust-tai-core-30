/**
 * Scout — discovery request building.
 *
 * Pure and provider-agnostic: the strict JSON schema, the analyst instructions
 * and the Responses API body are built here so the live server boundary, the
 * unit tests and the QA harness all exercise EXACTLY the same request.
 */

export const CANDIDATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "company_name",
          "website",
          "location",
          "industry",
          "summary",
          "discovery_reason",
          "observed_evidence",
          "buying_signals",
          "digital_opportunities",
          "people",
          "source_urls",
          "unknowns",
          "icp_fit",
        ],
        properties: {
          company_name: { type: "string" },
          website: { type: "string" },
          location: { type: ["string", "null"] },
          industry: { type: ["string", "null"] },
          summary: { type: "string" },
          discovery_reason: { type: "string" },
          observed_evidence: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["statement", "source_url"],
              properties: {
                statement: { type: "string" },
                source_url: { type: ["string", "null"] },
              },
            },
          },
          // Public, dated reasons this company might be buying now.
          buying_signals: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["type", "statement", "source_url", "observed_at"],
              properties: {
                type: {
                  type: "string",
                  enum: [
                    "hiring",
                    "funding",
                    "expansion",
                    "leadership_change",
                    "rebrand",
                    "product_launch",
                    "award_or_press",
                    "other",
                  ],
                },
                statement: { type: "string" },
                source_url: { type: ["string", "null"] },
                observed_at: { type: ["string", "null"] },
              },
            },
          },
          // Evidence-backed digital problems Trust Tai could realistically fix.
          digital_opportunities: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["area", "statement", "evidence", "source_url"],
              properties: {
                area: {
                  type: "string",
                  enum: [
                    "ux",
                    "accessibility",
                    "performance",
                    "broken_functionality",
                    "conversion",
                    "technology_age",
                    "security",
                    "content_freshness",
                    "operational_friction",
                  ],
                },
                statement: { type: "string" },
                evidence: { type: "string" },
                source_url: { type: ["string", "null"] },
              },
            },
          },
          // Named people found on PUBLIC pages only. Never guessed.
          people: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "full_name",
                "role_title",
                "linkedin_url",
                "email",
                "source_url",
                "decision_maker_likelihood",
              ],
              properties: {
                full_name: { type: "string" },
                role_title: { type: ["string", "null"] },
                linkedin_url: { type: ["string", "null"] },
                email: { type: ["string", "null"] },
                source_url: { type: ["string", "null"] },
                decision_maker_likelihood: {
                  type: "string",
                  enum: ["high", "moderate", "low", "unknown"],
                },
              },
            },
          },
          source_urls: { type: "array", items: { type: "string" } },
          unknowns: { type: "array", items: { type: "string" } },
          icp_fit: {
            type: "object",
            additionalProperties: false,
            required: ["light", "score", "confidence", "reasoning", "criteria"],
            properties: {
              light: { type: "string", enum: ["green", "yellow", "red"] },
              score: { type: "integer" },
              confidence: { type: "string", enum: ["high", "moderate", "low", "unknown"] },
              reasoning: { type: "string" },
              criteria: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "name",
                    "weight",
                    "status",
                    "score_contribution",
                    "evidence",
                    "source_urls",
                    "confidence",
                  ],
                  properties: {
                    name: { type: "string" },
                    weight: { type: "number" },
                    status: {
                      type: "string",
                      enum: ["met", "partial", "unknown", "missed", "disqualifier"],
                    },
                    score_contribution: { type: "number" },
                    evidence: { type: "string" },
                    source_urls: { type: "array", items: { type: "string" } },
                    confidence: { type: "string", enum: ["high", "moderate", "low", "unknown"] },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

export function discoveryInstructions(icp: string, calibration: string, limit: number): string {
  return [
    "You are Trust Tai Scout, a conservative B2B sourcing analyst.",
    "",
    "GOVERNING RUBRIC — the Ideal Client Profile below is the source of truth.",
    "Judge every company against it. Never substitute your own idea of a good client.",
    "",
    "=== ACTIVE ICP ===",
    icp || "No ICP has been saved. Score every company yellow with low confidence.",
    "=== END ICP ===",
    "",
    calibration,
    "",
    "RULES",
    `1. Use web_search. Return only REAL companies with current public web evidence. Aim for ${limit}.`,
    "2. Never fabricate a company, person, email, LinkedIn profile, revenue, headcount, budget or technology stack.",
    "3. Every company needs a real website URL you saw plus at least one source URL.",
    "4. Anything you could not establish goes in `unknowns`. Unknown is NOT negative — never score it as a mismatch.",
    "5. Traffic lights describe ICP FIT only: green = strong fit with sufficient evidence; yellow = plausible, mixed or thin evidence needing human review; red = material mismatch with the ICP.",
    "6. A hard disqualifier stated in the ICP sets that criterion to `disqualifier` and forces red.",
    "7. Thin public evidence lowers confidence and can never be green.",
    "8. Give a concise reasoning summary of the conclusion and its evidence. Do not output step-by-step deliberation.",
    "9. Do not judge how reachable a decision maker is; reachability is assessed separately from fit.",
  ].join("\n");
}

export interface DiscoveryRequestInput {
  model: string;
  query: string;
  limit: number;
  icp: string;
  calibration: string;
}

/** The exact Responses API body Scout sends, for any provider. */
export function buildDiscoveryRequestBody(input: DiscoveryRequestInput): Record<string, unknown> {
  return {
    model: input.model,
    stream: true,
    instructions: discoveryInstructions(input.icp, input.calibration, input.limit),
    input: `Find up to ${input.limit} real companies matching: ${input.query}`,
    tools: [{ type: "web_search" }],
    text: {
      format: {
        type: "json_schema",
        name: "scout_candidates",
        strict: true,
        schema: CANDIDATE_SCHEMA,
      },
    },
  };
}
