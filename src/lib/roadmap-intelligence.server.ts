/**
 * Roadmap Intelligence, reasoning entry points (server only).
 *
 * The room's model reasoning flows through the shared runtime boundary: this
 * module composes the prompts, the parsing and the evidence rules, and the
 * boundary (src/lib/intelligence-runtime.server.ts) owns authorization and
 * provider contact. Nothing here imports provider machinery.
 *
 * Everything the model returns is normalised before it is trusted: a claim
 * without a real source URL can never be Observed, and a proposal is never
 * Decided.
 */

import { normalizeResearch, type NormalizedResearch } from "@/data/roadmap-research-parse";
import type { createLovableAiGatewayRunIdFetch } from "@/lib/ai-gateway.server";
import {
  extractJsonObject,
  runtimeModelCaller,
  type RuntimeModelCaller,
} from "@/lib/intelligence-runtime.server";

export interface ResearchStage {
  stage: "reading" | "searching" | "composing" | "complete" | "error";
  message: string;
  data?: unknown;
}

/* --------------------------------------------------------------- prompts */

const VOICE = [
  "Write in company-native language. No generic agency or consulting copy.",
  "Never use em dashes.",
  "Never invent figures, timelines, budgets, internal access, client preferences, or promised outcomes.",
  "If something is not established from a public source, put it in unknowns instead of stating it.",
].join(" ");

function researchInstructions(): string {
  return [
    "You research a real company for Trust Tai and return json only.",
    "Understand the business before proposing anything.",
    "Use web search. Every factual claim must carry at least one source object with a real https url and checked_at.",
    "A claim with no source belongs in unknowns.",
    "Research competitors to understand market direction, not to copy features.",
    "Recognise what leadership has already built; that is anchor proof, not flattery.",
    "Milestones must be practical assets or capabilities a small senior product team can credibly build, each with a stated execution boundary.",
    "Ownership law, never break it: engineering and product delivery (websites, apps, software, dashboards, prototypes, integrations, feature builds) is carried by Projects; maintenance, support and recurring technical work is carried by Ops; only content and creative production (blog, newsletter, LinkedIn, Substack, social, campaign assets, media) is carried by Studio.",
    "Never write that Studio builds software, a website, an app, a dashboard, a prototype, an integration or a feature. Name the owning room explicitly in the execution boundary.",
    "Return more milestone candidates than a final roadmap needs, between 8 and 12.",
    VOICE,
  ].join(" ");
}

function researchInput(subject: {
  label: string;
  website?: string | undefined;
  objective: string;
  known: string[];
}): string {
  return JSON.stringify({
    task: "Research this company and return json with keys research, strategy, milestones.",
    company: subject.label,
    website: subject.website ?? null,
    what_trust_tai_is_trying_to_do: subject.objective,
    already_known_internally: subject.known,
    json_shape: {
      research: {
        company_model: [
          {
            statement: "",
            confidence: "high|moderate|low",
            sources: [{ label: "", url: "", checked_at: "" }],
          },
        ],
        buyers: [],
        strengths: [],
        digital_presence: [],
        competitors: [{ name: "", website: "", positioning: "", confidence: "", sources: [] }],
        market_direction: [],
        unknowns: [""],
      },
      strategy: {
        point_a: [{ statement: "", because: "", confidence: "", sources: [] }],
        anchor_proof: [{ statement: "", because: "", confidence: "", sources: [] }],
        horizon: [{ years: 2, statement: "", confidence: "", sources: [] }],
        point_b: { statement: "", because: "", confidence: "", sources: [] },
        point_c: { statement: "", because: "", confidence: "", sources: [] },
        central_truth: { statement: "", because: "", confidence: "", sources: [] },
        gaps: [{ statement: "", because: "", confidence: "", sources: [] }],
        leverage_point: { statement: "", because: "", confidence: "", sources: [] },
      },
      milestones: [
        {
          name: "",
          what_we_build: "",
          intended_user: "",
          supporting_market_direction: "",
          client_advantage: "",
          current_gap: "",
          immediate_value: "",
          long_term_value: "",
          dependencies: [""],
          execution_boundary: "",
          confidence: "",
          evidence: [{ label: "", url: "", checked_at: "" }],
        },
      ],
      rules: {
        anchor_proof: "one to three items only",
        horizon:
          "exactly three bands: 2, 5 and 10 years. Each band describes where this company's industry and buyers are heading, backed by a source. Never describe what Trust Tai would build, and never write generic futurism.",
      },
    },
  });
}

/* ----------------------------------------------------------------- output */

export interface RawStrategyItem {
  statement: string;
  because: string;
  confidence: string;
  sources: unknown;
}

export interface RoadmapResearchResult {
  research: NormalizedResearch;
  strategy: Record<string, unknown>;
  milestones: Record<string, unknown>[];
  provider: string;
  model: string;
  checkedAt: string;
}

export interface ResearchInput {
  token: string;
  organizationId: string;
  subjectLabel: string;
  objective: string;
  website?: string | undefined;
  known?: string[] | undefined;
  gateway?: ReturnType<typeof createLovableAiGatewayRunIdFetch> | undefined;
  initialRunId?: string | undefined;
}

/**
 * One research pass, authorized at the runtime boundary. Yields progress so
 * the room can see what is happening during a run that legitimately takes
 * minutes.
 */
export async function* runRoadmapResearch(
  input: ResearchInput,
): AsyncGenerator<ResearchStage> {
  let callModel: RuntimeModelCaller;
  try {
    callModel = await runtimeModelCaller({
      token: input.token,
      organizationId: input.organizationId,
      room: "roadmap",
      purpose: "research",
    });
  } catch {
    yield { stage: "error", message: "You do not have access to this workspace." };
    return;
  }
  yield* researchSubject(input, callModel);
}

/**
 * The research pass itself, with the model caller supplied by whoever holds
 * authorization: the guarded entry point above, or an offline acceptance
 * harness that builds a caller from the transport. Exported so the harness
 * exercises the exact prompting, parsing and evidence rules the live route
 * uses, without a database.
 */
export async function* researchSubject(
  input: Omit<ResearchInput, "token" | "organizationId"> &
    Partial<Pick<ResearchInput, "token" | "organizationId">>,
  callModel: RuntimeModelCaller,
): AsyncGenerator<ResearchStage> {
  yield { stage: "reading", message: `Reading what we already know about ${input.subjectLabel}` };

  yield { stage: "searching", message: `Researching ${input.subjectLabel}` };
  yield { stage: "searching", message: "Studying the market and competitors" };

  const checkedAt = new Date().toISOString();
  let raw = "";
  let provider = "";
  let model = "";
  try {
    const result = await callModel({
      instructions: researchInstructions(),
      input: researchInput({
        label: input.subjectLabel,
        website: input.website,
        objective: input.objective,
        known: input.known ?? [],
      }),
      webSearch: true,
      gateway: input.gateway,
      initialRunId: input.initialRunId,
    });
    raw = result.raw;
    provider = result.provider;
    model = result.model;
  } catch (error) {
    yield { stage: "error", message: error instanceof Error ? error.message : String(error) };
    return;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = extractJsonObject(raw);
  } catch {
    yield {
      stage: "error",
      message: "Roadmap could not read the research result. Nothing was changed.",
    };
    return;
  }

  yield { stage: "composing", message: "Synthesising a strategy from what was found" };

  const provenance = { provider, model, checkedAt };
  const research = normalizeResearch(parsed["research"] ?? parsed, provenance);
  const strategy = (parsed["strategy"] ?? {}) as Record<string, unknown>;
  const milestones = Array.isArray(parsed["milestones"])
    ? (parsed["milestones"] as Record<string, unknown>[])
    : [];

  yield {
    stage: "composing",
    message: `Generating candidate milestones (${milestones.length} considered)`,
  };

  const result: RoadmapResearchResult = {
    research,
    strategy,
    milestones,
    provider,
    model,
    checkedAt,
  };

  yield {
    stage: "complete",
    message: `Complete. ${research.sources.length} sources, ${research.unknowns.length} unknowns.`,
    data: result,
  };
}

/* -------------------------------------------------------------------- ask */

export interface AskInput {
  token: string;
  organizationId: string;
  question: string;
  subjectLabel: string;
  /** Everything already stored for this roadmap, as plain evidence. */
  context: unknown;
  /** Opt in, per question. Off by default: Roadmap does not silently search. */
  research?: boolean | undefined;
  gateway?: ReturnType<typeof createLovableAiGatewayRunIdFetch> | undefined;
  initialRunId?: string | undefined;
}

export interface AskResult {
  answer: string;
  facts: { statement: string; sources: { label: string; url: string; checkedAt: string }[] }[];
  inferences: string[];
  unknowns: string[];
  provider: string;
  model: string;
}

/**
 * Ask Roadmap, authorized at the runtime boundary. Grounded in stored
 * evidence by default: no web search, no new facts, and anything the stored
 * evidence does not support comes back as an unknown. A person can opt one
 * question into fresh research, and when they do the new claims still have to
 * carry real source urls.
 */
export async function askRoadmap(input: AskInput): Promise<AskResult> {
  let callModel: RuntimeModelCaller;
  try {
    callModel = await runtimeModelCaller({
      token: input.token,
      organizationId: input.organizationId,
      room: "roadmap",
      purpose: "research",
    });
  } catch {
    throw new Error("You do not have access to this workspace.");
  }
  return answerRoadmapQuestion(input, callModel);
}

/** The answering itself, once authorization has been cleared. */
export async function answerRoadmapQuestion(
  input: Omit<AskInput, "token" | "organizationId"> &
    Partial<Pick<AskInput, "token" | "organizationId">>,
  callModel: RuntimeModelCaller,
): Promise<AskResult> {
  const fresh = input.research === true;

  const instructions = [
    "You answer questions about one business and you return json.",
    fresh
      ? "Start from the stored evidence, then use web search to answer what the stored evidence cannot. Every new fact needs a real https source url."
      : "Use only the stored evidence provided. Do not search the web.",
    "Facts must quote or paraphrase a sourced statement and repeat its sources.",
    "Anything you reason on top of those facts goes in inferences, clearly separate from facts.",
    "Anything the evidence does not answer goes in unknowns. Never fill a gap with a guess.",
    VOICE,
  ].join(" ");

  const { raw, provider, model } = await callModel({
    instructions,
    input: JSON.stringify({
      question: input.question,
      company: input.subjectLabel,
      stored_evidence: input.context,
      fresh_research_allowed: fresh,
      json_shape: {
        answer: "",
        facts: [{ statement: "", sources: [{ label: "", url: "", checked_at: "" }] }],
        inferences: [""],
        unknowns: [""],
      },
    }),
    webSearch: fresh,
    gateway: input.gateway,
    initialRunId: input.initialRunId,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = extractJsonObject(raw);
  } catch {
    throw new Error("Roadmap could not read the answer. Nothing was stored.");
  }

  const facts = Array.isArray(parsed["facts"])
    ? (parsed["facts"] as Record<string, unknown>[]).map((entry) => ({
        statement: String(entry["statement"] ?? ""),
        sources: Array.isArray(entry["sources"])
          ? (entry["sources"] as Record<string, unknown>[])
              .map((ref) => ({
                label: String(ref["label"] ?? "Source"),
                url: String(ref["url"] ?? ""),
                checkedAt: String(
                  ref["checked_at"] ?? ref["checkedAt"] ?? new Date().toISOString(),
                ),
              }))
              .filter((ref) => /^https?:\/\//i.test(ref.url))
          : [],
      }))
    : [];

  return {
    answer: String(parsed["answer"] ?? ""),
    // A "fact" with no source is not a fact. It is demoted to an inference.
    facts: facts.filter((fact) => fact.statement && fact.sources.length > 0),
    inferences: [
      ...(Array.isArray(parsed["inferences"]) ? parsed["inferences"].map(String) : []),
      ...facts.filter((fact) => fact.sources.length === 0).map((fact) => fact.statement),
    ].filter(Boolean),
    unknowns: Array.isArray(parsed["unknowns"]) ? parsed["unknowns"].map(String) : [],
    provider,
    model,
  };
}
