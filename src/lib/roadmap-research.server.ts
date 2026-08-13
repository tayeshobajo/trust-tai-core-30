/**
 * Roadmap Intelligence — server-side research (server only).
 *
 * Same provider discipline as Scout: keys never leave the server, the provider
 * that answered is recorded truthfully, and if no provider is configured the
 * run fails closed rather than inventing a business.
 *
 * The provider is asked to research the public web and return JSON. Everything
 * it returns is normalised before it is trusted: a claim without a real source
 * URL can never be Observed, and a proposal is never Decided.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { normalizeResearch, type NormalizedResearch } from "@/data/roadmap-research-parse";
import {
  createLovableAiGatewayRunIdFetch,
  LOVABLE_AIG_RUN_ID_HEADER,
} from "./ai-gateway.server";
import { selectScoutProvider } from "./scout-provider.server";

export interface ResearchStage {
  stage: "reading" | "searching" | "composing" | "complete" | "error";
  message: string;
  data?: unknown;
}

function supabaseUrl(): string {
  return (
    process.env["TRUST_TAI_SUPABASE_URL"] ||
    process.env["VITE_SUPABASE_URL"] ||
    "https://okydosoacqdnursmmenf.supabase.co"
  );
}

function supabaseKey(): string {
  return (
    process.env["TRUST_TAI_SUPABASE_PUBLISHABLE_KEY"] ||
    process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
    "sb_publishable_uARvNwZli88tfhOHBwFTsQ_JUpQo-UL"
  );
}

/** A client acting as the signed-in person. RLS applies to every call. */
function clientFor(token: string): SupabaseClient {
  return createClient(supabaseUrl(), supabaseKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey() } },
  });
}

/** Membership is verified server-side; a token alone is never enough. */
async function requireMembership(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("organization_memberships")
    .select("id")
    .eq("organization_id", organizationId)
    .limit(1);
  return !error && (data ?? []).length > 0;
}

/* --------------------------------------------------------------- provider */

async function callProvider(
  instructions: string,
  input: string,
  options: {
    webSearch: boolean;
    gateway?: ReturnType<typeof createLovableAiGatewayRunIdFetch> | undefined;
    initialRunId?: string | undefined;
  },
): Promise<{ raw: string; provider: string; model: string }> {
  const selected = selectScoutProvider();
  if (!selected) {
    throw new Error(
      "No intelligence provider is configured, so Roadmap cannot research. Nothing was changed.",
    );
  }

  const doFetch = options.gateway?.fetch ?? fetch;
  const response = await doFetch(selected.endpoint, {
    method: "POST",
    headers: {
      ...selected.headers,
      ...(selected.provider === "lovable" && options.initialRunId
        ? { [LOVABLE_AIG_RUN_ID_HEADER]: options.initialRunId }
        : {}),
    },
    body: JSON.stringify({
      model: selected.model,
      instructions,
      input,
      stream: true,
      store: false,
      reasoning: { effort: "medium", summary: "auto" },
      ...(options.webSearch ? { tools: [{ type: "web_search" }] } : {}),
      text: { format: { type: "json_object" } },
    }),
  });

  if (!response.ok || !response.body) {
    const detail = await response.text();
    throw new Error(`The research provider refused the request (${response.status}). ${detail.slice(0, 240)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let raw = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        continue;
      }
      const type = String(event["type"] ?? "");
      if (type === "response.output_text.delta" && typeof event["delta"] === "string") {
        raw += event["delta"];
      }
      if (type === "response.failed" || type === "error") {
        throw new Error("The research run failed before returning anything.");
      }
    }
  }

  return { raw, provider: selected.provider, model: selected.model };
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
    "Milestones must be practical assets or capabilities a small senior product studio can credibly build, each with a stated execution boundary.",
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
        company_model: [{ statement: "", confidence: "high|moderate|low", sources: [{ label: "", url: "", checked_at: "" }] }],
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
        horizon: "exactly three bands: 2, 5 and 10 years",
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
 * One research pass. Yields progress so the room can see what is happening
 * during a run that legitimately takes minutes.
 */
export async function* runRoadmapResearch(
  input: ResearchInput,
): AsyncGenerator<ResearchStage> {
  const supabase = clientFor(input.token);
  const allowed = await requireMembership(supabase, input.organizationId);
  if (!allowed) {
    yield { stage: "error", message: "You do not have access to this workspace." };
    return;
  }

  yield { stage: "reading", message: `Reading what we already hold on ${input.subjectLabel}` };
  yield { stage: "searching", message: "Researching the public web" };

  const checkedAt = new Date().toISOString();
  let raw = "";
  let provider = "";
  let model = "";
  try {
    const result = await callProvider(
      researchInstructions(),
      researchInput({
        label: input.subjectLabel,
        website: input.website,
        objective: input.objective,
        known: input.known ?? [],
      }),
      {
        webSearch: true,
        gateway: input.gateway,
        initialRunId: input.initialRunId,
      },
    );
    raw = result.raw;
    provider = result.provider;
    model = result.model;
  } catch (error) {
    yield { stage: "error", message: error instanceof Error ? error.message : String(error) };
    return;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    yield {
      stage: "error",
      message: "Roadmap could not read the research result. Nothing was changed.",
    };
    return;
  }

  yield { stage: "composing", message: "Separating what is observed from what is inferred" };

  const provenance = { provider, model, checkedAt };
  const research = normalizeResearch(parsed["research"] ?? parsed, provenance);
  const strategy = (parsed["strategy"] ?? {}) as Record<string, unknown>;
  const milestones = Array.isArray(parsed["milestones"])
    ? (parsed["milestones"] as Record<string, unknown>[])
    : [];

  const result: RoadmapResearchResult = {
    research,
    strategy,
    milestones,
    provider,
    model,
    checkedAt,
  };

  yield { stage: "complete", message: `Researched ${input.subjectLabel}`, data: result };
}

/* -------------------------------------------------------------------- ask */

export interface AskInput {
  token: string;
  organizationId: string;
  question: string;
  subjectLabel: string;
  /** Everything already stored for this roadmap, as plain evidence. */
  context: unknown;
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
 * Ask Roadmap. Grounded in stored evidence only: no web search, no new facts.
 * Anything the stored evidence does not support comes back as an unknown.
 */
export async function askRoadmap(input: AskInput): Promise<AskResult> {
  const supabase = clientFor(input.token);
  if (!(await requireMembership(supabase, input.organizationId))) {
    throw new Error("You do not have access to this workspace.");
  }

  const instructions = [
    "You answer questions about one business using only the stored evidence provided, and you return json.",
    "Facts must quote or paraphrase a stored statement and repeat its sources.",
    "Anything you reason on top of those facts goes in inferences, clearly separate from facts.",
    "Anything the evidence does not answer goes in unknowns. Never fill a gap with a guess.",
    VOICE,
  ].join(" ");

  const { raw, provider, model } = await callProvider(
    instructions,
    JSON.stringify({
      question: input.question,
      company: input.subjectLabel,
      stored_evidence: input.context,
      json_shape: {
        answer: "",
        facts: [{ statement: "", sources: [{ label: "", url: "", checked_at: "" }] }],
        inferences: [""],
        unknowns: [""],
      },
    }),
    { webSearch: false, gateway: input.gateway, initialRunId: input.initialRunId },
  );

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
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
                checkedAt: String(ref["checked_at"] ?? ref["checkedAt"] ?? new Date().toISOString()),
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
