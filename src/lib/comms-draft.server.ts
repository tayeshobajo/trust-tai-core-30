/**
 * Comms drafting boundary (server only).
 *
 * Spirit first. Reason first. Write second. Comms does not generate messages:
 * it makes a relationship-specific communication judgment over the governed
 * evidence — identity and stage, recorded memory, the live thread, open
 * commitments, and the writer's stated purpose — and then writes the one
 * message that judgment requires. The judgment is persisted on the draft's
 * rationale so every draft carries its provenance.
 *
 * Tai's canonical relationship voice (TAI_RELATIONSHIP_VOICE) is the baseline
 * for every message. The org Voice DNA is the editable brand expression and
 * approved/sent examples are living style proof — both influence on top of
 * the baseline, neither replaces it. Website/brand rules enter an ordinary
 * email only when the conversation itself calls for them.
 *
 * Laws enforced here, not left to the model:
 *  - GROUNDING GATE: a real thread plus a known identity grounds a reply; a
 *    known identity plus one real prior interaction plus a reason grounds a
 *    proactive note. Below that bar drafting would mean inventing the reason,
 *    the facts, or the relationship — Comms says what is missing and creates
 *    nothing (assessDraftGrounding),
 *  - only observed facts and human decisions may be cited as fact;
 *    inferences may guide the angle, never appear as claims,
 *  - nothing is sent,
 *  - a sensitive register is always held for human review,
 *  - FAIL CLOSED: with no provider, a failed call, or an unreadable result,
 *    Comms says so and creates nothing. There is no mail-merge fallback —
 *    a fabricated generic draft impersonates intelligence.
 *
 * Every read is made with the CALLER'S token, so RLS and the organization
 * boundary still apply. No service-role key is used.
 */

import {
  trustTaiSupabaseKey,
  trustTaiSupabaseUrl,
} from "@/lib/trust-tai-backend.server";
import { createClient } from "@supabase/supabase-js";

import { checkVoice, requiresHumanReview, type VoiceVerdict } from "@/data/voice-policy";
import {
  DEFAULT_VOICE_DOCUMENT,
  REGISTER_GUIDE,
  TAI_RELATIONSHIP_VOICE,
  type VoiceRegister,
} from "@/domain/voice";
import {
  COMMITMENT_CATEGORY,
} from "@/domain/comms-interactions";
import {
  assessDraftGrounding,
  parseCommunicationJudgment,
  salutationName,
  summarizeDraftGrounding,
  threadContextForJudgment,
  unearnedAskInBody,
  type CommunicationJudgment,
  type DraftGroundingSummary,
} from "@/domain/comms-judgment";
import {
  ProviderCallFailedError,
  ProviderNotConfiguredError,
  runtimeModelCaller,
  runtimeProviderStatus,
  type RuntimeModelCaller,
} from "@/lib/intelligence-runtime.server";

const REGISTERS: VoiceRegister[] = [
  "warm_intro",
  "follow_up",
  "reconnect",
  "logistics",
  "sensitive",
];

/** The calm, honest failure. Nothing is created when this is said. */
export const DRAFT_PREPARATION_FAILED =
  "Comms couldn't prepare a trustworthy draft from the available context. Nothing was created.";

/**
 * Why drafting failed, machine-readable and safe to show a client. The calm
 * sentence stays the same; this code is how operators and logs tell one
 * failure from another instead of every post-grounding failure collapsing
 * into the same shrug. Never carries secrets, provider bodies, or the model's
 * working.
 */
export type DraftFailureCode =
  /** No shared intelligence provider is configured server-side. */
  | "provider_not_configured"
  /** The caller is not an active member of the relationship's workspace. */
  | "access_denied"
  /** The provider refused or the reasoning run failed. */
  | "provider_call_failed"
  /** Pass one answered, but not with a readable judgment. */
  | "judgment_unreadable"
  /** Pass two answered, but not with a readable draft. */
  | "writing_unreadable"
  /** Pass two parsed, but subject or body was empty. */
  | "empty_draft"
  /** The judgment decided no ask; the writing pass snuck one in, twice. */
  | "ask_gate_violated";

export class DraftFailure extends Error {
  constructor(
    readonly code: DraftFailureCode,
    message: string = DRAFT_PREPARATION_FAILED,
  ) {
    super(message);
    this.name = "DraftFailure";
  }
}

/** The runtime boundary refuses with a bare "forbidden"; map it honestly. */
export function classifyDraftAccessError(error: unknown): DraftFailure | null {
  return error instanceof Error && error.message === "forbidden"
    ? new DraftFailure(
        "access_denied",
        "You don't have access to draft in this workspace. Nothing was created.",
      )
    : null;
}

/**
 * Map a transport failure to a typed draft failure, logging the safe detail
 * (the code and the provider's HTTP status — never keys, never bodies) so
 * production logs can tell a missing key from a provider refusal.
 */
function toDraftFailure(error: unknown, stage: string): DraftFailure {
  if (error instanceof ProviderNotConfiguredError) {
    console.error(`[comms-draft] provider_not_configured during ${stage}`);
    return new DraftFailure("provider_not_configured");
  }
  const status = error instanceof ProviderCallFailedError ? error.status : undefined;
  console.error(
    `[comms-draft] provider_call_failed during ${stage}${status ? ` (provider status ${status})` : ""}`,
  );
  return new DraftFailure("provider_call_failed");
}

/**
 * The honest refusal when drafting would require invention. Names the gaps
 * in plain language so the person knows exactly what to add — a real prior
 * interaction, a reason to write — instead of receiving a fabricated draft.
 */
export function draftUngroundedMessage(missing: string[]): string {
  return `Comms can't draft this message without inventing ${missing.join(
    " and ",
  )}. Nothing was created.`;
}

function supabaseUrl(): string {
  return trustTaiSupabaseUrl();
}

function supabaseKey(): string {
  return trustTaiSupabaseKey();
}

/** The caller-scoped client. Every read runs as the caller, so RLS applies. */
function callerClient(token: string) {
  return createClient(supabaseUrl(), supabaseKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

type CallerClient = ReturnType<typeof callerClient>;

export interface DraftRequest {
  relationshipId: string;
  register: VoiceRegister;
  /** What this message is for, in the writer's own words. Optional. */
  purpose?: string;
}

export interface DraftResult {
  subject: string;
  body: string;
  register: VoiceRegister;
  reviewState: "draft" | "needs_human_review";
  violations: VoiceVerdict["violations"];
  /** The evidence lines the draft was allowed to draw on. */
  usedEvidence: { label: string; value: string; tier: string }[];
  /** The communication judgment the prose was written from. */
  judgment: CommunicationJudgment;
  /** What the draft stands on, and what would sharpen it. Shown before send. */
  grounding: DraftGroundingSummary;
  provider: string;
  model: string;
}

export function parseRegister(value: unknown): VoiceRegister {
  return REGISTERS.includes(value as VoiceRegister) ? (value as VoiceRegister) : "follow_up";
}

interface MemoryRow {
  label?: unknown;
  value?: unknown;
  tier?: unknown;
  category?: unknown;
  status?: unknown;
  owner?: unknown;
  due?: unknown;
}

function memoryLines(value: unknown, tier: string): { label: string; value: string; tier: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is MemoryRow => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      label: String(entry.label ?? "Note"),
      value: String(entry.value ?? ""),
      tier,
    }))
    .filter((entry) => entry.value.length > 0);
}

/** Open promises on record: decided memory carrying the commitment category. */
function openCommitmentLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is MemoryRow => Boolean(entry) && typeof entry === "object")
    .filter(
      (entry) =>
        entry.category === COMMITMENT_CATEGORY &&
        (entry.status === undefined || entry.status === "open"),
    )
    .map((entry) => {
      const text = String(entry.value ?? "").trim();
      if (!text) return "";
      const owner = entry.owner === "them" ? "they owe" : "we owe";
      const due = typeof entry.due === "string" && entry.due ? `, due ${entry.due}` : "";
      return `${text} (${owner}${due})`;
    })
    .filter(Boolean);
}

interface ThreadRow {
  direction?: unknown;
  subject?: unknown;
  snippet?: unknown;
  body_text?: unknown;
  occurred_at?: unknown;
}

/**
 * The recent conversation for this relationship, read with the caller's
 * token. Drafting blind to the thread is the failure this removes. The
 * message-fidelity columns are preferred; an older schema sheds body_text
 * and retries with snippets.
 */
async function loadThread(
  supabase: CallerClient,
  relationshipId: string,
): Promise<ReturnType<typeof threadContextForJudgment>> {
  const variants = [
    "direction, subject, body_text, snippet, occurred_at",
    "direction, subject, snippet, occurred_at",
  ];
  for (const columns of variants) {
    const { data, error } = await supabase
      .from("comms_messages")
      .select(columns)
      .eq("relationship_id", relationshipId)
      .order("occurred_at", { ascending: true })
      .limit(40);
    if (error) continue;
    const rows = ((data ?? []) as unknown as ThreadRow[])
      .filter((row) => row.direction === "inbound" || row.direction === "outbound")
      .map((row) => ({
        direction: row.direction as "inbound" | "outbound",
        ...(typeof row.subject === "string" && row.subject.trim()
          ? { subject: row.subject }
          : {}),
        ...(typeof row.snippet === "string" ? { snippet: row.snippet } : {}),
        ...(typeof row.body_text === "string" ? { bodyText: row.body_text } : {}),
        occurredAt: String(row.occurred_at ?? ""),
      }))
      .filter((row) => row.occurredAt);
    return threadContextForJudgment(rows);
  }
  return [];
}

/**
 * Voice evidence from how Tai actually communicated: the drafts a person
 * approved or sent, newest first. Real wording outranks style labels — this
 * is the Voice DNA's living proof, reused from the drafts table rather than
 * a parallel store.
 */
async function loadVoiceExamples(
  supabase: CallerClient,
  organizationId: string,
): Promise<{ subject: string; excerpt: string }[]> {
  const { data, error } = await supabase
    .from("comms_drafts")
    .select("subject, body, created_at")
    .eq("organization_id", organizationId)
    .in("review_state", ["approved", "sent"])
    .order("created_at", { ascending: false })
    .limit(3);
  if (error) return [];
  return ((data ?? []) as { subject?: unknown; body?: unknown }[])
    .map((row) => ({
      subject: String(row.subject ?? "").trim(),
      excerpt: String(row.body ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
    }))
    .filter((row) => row.excerpt.length > 0);
}

const JUDGMENT_INSTRUCTIONS = `You are the communication judgment of Trust Tai. You do NOT write the message.
You read the conversation the way a perceptive person would, then return the
judgment a draft will be written from.

Spirit first, the operational law: do not look for the fastest way to the next
step. Look for the most human thing worth responding to.

Reason in this order — Notice, Understand, Reflect, Build, then Decide:
1. NOTICE the human signal in their latest message: generosity, pride, curiosity,
   relief, excitement, care, vulnerability, ambition, humor, frustration.
2. UNDERSTAND what that signal says about them as a person.
3. REFLECT: name the specific thing that deserves acknowledgment, in a way that
   would feel earned rather than flattering.
4. BUILD: identify the most interesting thread they just offered to continue.
5. DECIDE whether any ask belongs at all. Only now, never earlier.

The ask gate. An ask is allowed ONLY when one of these is true, and whyNatural
must say which one:
- they explicitly suggested talking or meeting,
- something genuinely requires live discussion,
- there is active reciprocal exploration underway,
- there is clear reciprocal curiosity,
- a meeting would make their life easier right now,
- the conversation has naturally arrived at that point.
"Maintaining momentum", "building the relationship", and "staying connected"
are NOT reasons — an ask whose only grounds is one of those fails the gate.
When no condition holds, shouldAsk is false. A warm acknowledgment, a specific
observation, a natural question, or no ask at all is often the best move. A
relationship can be moving even when there is no ask. Never treat "would you
be open to a call" as a default.

Return strict JSON only:
{
  "whyNow": "one plain sentence: why Tai is writing now, grounded in the evidence",
  "latestHumanSignal": "the human signal in their latest message — what they just revealed, quoted or closely paraphrased",
  "whatThisSaysAboutThem": "the quality or meaning underneath that signal",
  "whatDeservesAcknowledgment": "the specific thing to reflect back so they feel recognized, not praised",
  "threadToBuildOn": "the most interesting thing they just said that the reply can build on; empty when the right move is simply to close warmly",
  "intendedEffect": "what Tai wants them to feel when they finish reading",
  "responseObligation": "any question or point in their latest message that plainly requires an answer; empty when none",
  "askDecision": {
    "shouldAsk": true|false,
    "whyNatural": "when true: why this ask would feel natural to them right now, naming the gate condition. When false: why no ask belongs",
    "what": "the proportionate ask, small and easy to decline; empty when shouldAsk is false"
  },
  "factsAllowed": ["evidence lines the draft may reference as fact"],
  "factsAvoid": ["claims the draft must not state — inferred, unsupported, or invented"],
  "voiceEvidenceUsed": ["the canonical relationship-voice rules that govern this draft"],
  "learnedExamplesUsed": ["the approved examples that influenced the judgment; empty when none did"]
}

Laws:
1. Conversation before conversion. Do not advance the relationship because
   advancement is possible. Respond first to what the person just gave us.
2. Make the person feel interesting, not merely praised. Generic compliments
   fail; recognition is specific — something they revealed almost casually,
   caught. They should feel recognized, never targeted.
3. Use only the evidence provided. Never invent a fact, a name, a date, a
   shared history, or a personal detail. Thin evidence means a smaller
   judgment, never a guessed one.
4. Inferred reads may shape your judgment but must land in factsAvoid, never
   factsAllowed.
5. No forced momentum. When an ask does belong, it is small and easy to
   decline — spaciousness, never pressure.
6. Ordinary email is not brand content. Roadmap language, proprietary
   frameworks, and positioning enter only when the conversation itself calls
   for them.
7. This is a product-level rationale a person will read. Concise, plain, no
   chain-of-thought.`;

const WRITE_INSTRUCTIONS = `You write one short email for Tai at Trust Tai, FROM the communication judgment
below. You never send anything.

The canonical Tai relationship voice is the baseline for every message:
- Warm, calm, concise, human, specific. Quiet confidence, no performance.
- Natural contractions. Short paragraphs. Everyday words.
- See the person first: reflect the human signal the judgment named, with
  specific recognition rather than generic praise. Sometimes the most
  spirit-first response is the shortest truthful one.
- Create spaciousness, never pressure. No manufactured urgency.
- No corporate language and no generic networking language.
- No fake familiarity and no invented personalization: if it is not in the evidence, it does not exist.
- No forced call to action. A natural question is welcome; make an ask only when the judgment names one.

Laws:
1. The judgment governs. Reference only facts in factsAllowed. Never state anything in factsAvoid.
2. If askDecision.shouldAsk is false, make no ask — no call, coffee, meeting,
   "finding time", or scheduling nudge of any kind, however soft. The message
   acknowledges, answers, reflects, or continues; that is enough.
3. Build on threadToBuildOn when it names one. When it is empty, a clean,
   warm close is the right shape.
4. Hard rules: no em dashes, no exclamation marks, no 'just checking in' or 'touching base',
   no needy phrasing, no promises.
5. Approved examples influence rhythm and texture only — they never override this baseline.
6. Brand or website language enters only when the conversation calls for it.
7. Short. Most messages earn 4 to 8 sentences before the signoff.
8. Use the given salutation name only if a salutation is natural here; otherwise start plainly.
   Never guess a name.
9. Return JSON only: {"subject": string, "body": string}. The body must end with 'Trust,',
   then a new line, then 'Tai'.`;

/**
 * Strict response formats for both passes. Pinning the schema server-side is
 * what makes a reply readable: without one the provider is asked for generic
 * json mode, which it may refuse outright — and every refusal used to
 * collapse into the same generic failure. Schemas follow the strict contract:
 * every property required, no optional keys, objects closed.
 */
const JUDGMENT_RESPONSE_FORMAT: Record<string, unknown> = {
  type: "json_schema",
  name: "communication_judgment",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      whyNow: { type: "string" },
      latestHumanSignal: { type: "string" },
      whatThisSaysAboutThem: { type: "string" },
      whatDeservesAcknowledgment: { type: "string" },
      threadToBuildOn: { type: "string" },
      intendedEffect: { type: "string" },
      responseObligation: { type: "string" },
      askDecision: {
        type: "object",
        additionalProperties: false,
        properties: {
          shouldAsk: { type: "boolean" },
          whyNatural: { type: "string" },
          what: { type: "string" },
        },
        required: ["shouldAsk", "whyNatural", "what"],
      },
      factsAllowed: { type: "array", items: { type: "string" } },
      factsAvoid: { type: "array", items: { type: "string" } },
      voiceEvidenceUsed: { type: "array", items: { type: "string" } },
      learnedExamplesUsed: { type: "array", items: { type: "string" } },
    },
    required: [
      "whyNow",
      "latestHumanSignal",
      "whatThisSaysAboutThem",
      "whatDeservesAcknowledgment",
      "threadToBuildOn",
      "intendedEffect",
      "responseObligation",
      "askDecision",
      "factsAllowed",
      "factsAvoid",
      "voiceEvidenceUsed",
      "learnedExamplesUsed",
    ],
  },
};

const WRITE_RESPONSE_FORMAT: Record<string, unknown> = {
  type: "json_schema",
  name: "relationship_draft",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      subject: { type: "string" },
      body: { type: "string" },
    },
    required: ["subject", "body"],
  },
};

/**
 * Compose one draft: grounding gate first, judgment second, prose third,
 * deterministic Voice pass last. Returns the checked text, the judgment it
 * rests on, and every rule it tripped, so the reviewer sees exactly what the
 * policy saw.
 *
 * Throws draftUngroundedMessage when the evidence is below the grounding bar,
 * and a DraftFailure with a machine-readable code for every post-grounding
 * failure. A fabricated generic draft is never returned in either case.
 */
export async function draftMessage(
  token: string,
  request: DraftRequest,
): Promise<DraftResult> {
  const supabase = callerClient(token);

  const { data: user, error: userError } = await supabase.auth.getUser();
  if (userError || !user?.user) throw new Error("Sign in to draft a message.");

  const { data: relationship, error } = await supabase
    .from("comms_relationships")
    .select(
      "id, organization_id, full_name, email, company_name, stage, met_where, next_action, observed, inferred, decided",
    )
    .eq("id", request.relationshipId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!relationship) throw new Error("That relationship is not in your workspace.");

  const row = relationship as Record<string, unknown>;
  const organizationId = String(row["organization_id"]);

  const { data: voice } = await supabase
    .from("comms_voice_profiles")
    .select("content_markdown, version")
    .eq("organization_id", organizationId)
    .maybeSingle();
  const voiceDocument =
    (voice as { content_markdown?: string } | null)?.content_markdown?.trim() ||
    DEFAULT_VOICE_DOCUMENT;

  // Only observed facts and human decisions may be cited. Inferences inform
  // the angle; they never become a claim in the message.
  const usedEvidence = [
    ...memoryLines(row["observed"], "observed"),
    ...memoryLines(row["decided"], "decided"),
  ];
  const inferred = memoryLines(row["inferred"], "inferred");
  const commitments = openCommitmentLines(row["decided"]);

  const fullName = String(row["full_name"] ?? "").trim();
  const salutation = salutationName(fullName);
  const metWhere = (row["met_where"] as string | null) ?? null;
  const register = request.register;

  // The governed evidence packet both passes reason over.
  const [thread, voiceExamples] = await Promise.all([
    loadThread(supabase, request.relationshipId),
    loadVoiceExamples(supabase, organizationId),
  ]);

  /* The grounding gate. A real thread plus a known identity grounds a reply;
     identity plus one real prior interaction plus a reason grounds a
     proactive note. Below that bar the only honest outcome is no draft —
     producing one would require inventing the reason, the facts, or the
     relationship itself. Extra memory, commitments, and examples improve a
     grounded draft; they are never mandatory. */
  const grounding = assessDraftGrounding({
    hasIdentity: Boolean(
      fullName || String(row["email"] ?? "").trim() || String(row["company_name"] ?? "").trim(),
    ),
    threadHasInbound: thread.some((entry) => entry.direction === "inbound"),
    priorInteractionCount:
      thread.length + usedEvidence.length + (metWhere?.trim() ? 1 : 0),
    hasReason: Boolean(
      request.purpose?.trim() ||
        String(row["next_action"] ?? "").trim() ||
        commitments.length > 0,
    ),
  });
  if (!grounding.grounded) throw new Error(draftUngroundedMessage(grounding.missing));

  /* The grounding confidence a person sees before sending: what the draft
     stands on, and what would sharpen it. Persisted with the rationale. */
  const groundingSummary = summarizeDraftGrounding({
    kind: grounding.kind ?? "proactive",
    threadCount: thread.length,
    recordedFactCount: usedEvidence.length,
    openCommitmentCount: commitments.length,
    voiceExampleCount: voiceExamples.length,
    hasPurpose: Boolean(request.purpose?.trim()),
  });

  /* The evidence packet keeps its provenance explicit: the canonical
     relationship voice is the baseline, relationship evidence is what may be
     said, the org Voice DNA is the editable brand expression, and approved
     examples are learned style influence — layered, never merged. */
  const evidencePacket = {
    draftKind: grounding.kind,
    canonicalRelationshipVoice: [...TAI_RELATIONSHIP_VOICE],
    relationshipEvidence: {
      recipient: {
        name: fullName || "Unknown",
        salutationName: salutation || null,
        company: (row["company_name"] as string | null) ?? null,
        stage: (row["stage"] as string | null) ?? null,
        metWhere,
      },
      intent: {
        register,
        registerGuide: REGISTER_GUIDE[register],
        nextAction: (row["next_action"] as string | null) ?? null,
        purpose: request.purpose?.trim() || null,
      },
      memory: {
        observedAndDecided: usedEvidence.map(
          (entry) => `${entry.label}: ${entry.value} (${entry.tier})`,
        ),
        inferredGuideOnly: inferred.map((entry) => entry.value),
        openCommitments: commitments,
      },
      thread: thread.map((entry) => ({
        direction: entry.direction,
        subject: entry.subject ?? null,
        text: entry.text,
        at: entry.occurredAt,
        latestFromThisSide: entry.latestForSide,
      })),
    },
    brandVoiceDna: voiceDocument,
    learnedStyleExamples: voiceExamples,
  };

  /* From here the provider does the work, through the shared runtime
     boundary. Every post-grounding failure is typed — the person keeps the
     calm sentence, the operator gets a machine-readable code in the response
     and the safe detail in the server log. Fail closed in all cases: a
     fabricated generic draft impersonates intelligence. */
  if (!runtimeProviderStatus().configured) {
    console.error("[comms-draft] provider_not_configured: no shared intelligence provider is set");
    throw new DraftFailure("provider_not_configured");
  }

  let callModel: RuntimeModelCaller;
  try {
    callModel = await runtimeModelCaller({
      token,
      organizationId,
      room: "comms",
      purpose: "draft",
    });
  } catch (error) {
    const access = classifyDraftAccessError(error);
    if (access) throw access;
    throw toDraftFailure(error, "the access check");
  }

  return executeDraftPasses(callModel, {
    evidencePacket,
    salutation: salutation || null,
    register,
    usedEvidence,
    groundingSummary,
  });
}

export interface DraftPassInput {
  /** The governed evidence packet both passes reason over. */
  evidencePacket: Record<string, unknown>;
  salutation: string | null;
  register: VoiceRegister;
  usedEvidence: { label: string; value: string; tier: string }[];
  groundingSummary: DraftGroundingSummary;
}

/**
 * Judgment first, write second, deterministic voice pass last — over the
 * caller the runtime boundary issued. Exported so the contract is testable
 * with a fake provider; production reaches it only through draftMessage,
 * after the grounding gate.
 */
export async function executeDraftPasses(
  callModel: RuntimeModelCaller,
  input: DraftPassInput,
): Promise<DraftResult> {
  // Pass one — reason. The judgment comes before any prose.
  let reasoned: { raw: string; provider: string; model: string };
  try {
    reasoned = await callModel({
      instructions: JUDGMENT_INSTRUCTIONS,
      input: JSON.stringify(input.evidencePacket),
      webSearch: false,
      responseFormat: JUDGMENT_RESPONSE_FORMAT,
    });
  } catch (error) {
    throw toDraftFailure(error, "the judgment pass");
  }
  const judgment = parseCommunicationJudgment(safeJson(reasoned.raw));
  if (!judgment) {
    console.error("[comms-draft] judgment_unreadable: pass one returned no readable judgment");
    throw new DraftFailure("judgment_unreadable");
  }

  // Pass two — write. The prose is generated FROM the judgment, never
  // alongside it.
  const writeInput = JSON.stringify({
    judgment,
    salutationName: input.salutation,
    evidence: input.evidencePacket,
  });

  const write = async (instructions: string) => {
    try {
      return await callModel({
        instructions,
        input: writeInput,
        webSearch: false,
        responseFormat: WRITE_RESPONSE_FORMAT,
      });
    } catch (error) {
      throw toDraftFailure(error, "the writing pass");
    }
  };

  const readWritten = (
    written: { raw: string },
  ): { subject: string; body: string } => {
    const parsed = safeJson(written.raw);
    if (!parsed) {
      console.error("[comms-draft] writing_unreadable: pass two returned no readable draft");
      throw new DraftFailure("writing_unreadable");
    }
    const subject = String(parsed["subject"] ?? "").trim();
    const body = String(parsed["body"] ?? "").trim();
    if (!body || !subject) {
      console.error("[comms-draft] empty_draft: pass two returned an empty subject or body");
      throw new DraftFailure("empty_draft");
    }
    return { subject, body };
  };

  const first = await write(WRITE_INSTRUCTIONS);
  let { subject, body } = readWritten(first);
  const provider = first.provider;
  const model = first.model;

  /* Ask-gate enforcement, deterministic. The judgment decided whether the
     conversation earned an ask; the model is never trusted to police itself.
     When it snuck one in anyway, correct it once in plain language — and if
     it still cannot honor the judgment, fail honestly rather than return a
     draft that reads the room worse than the judgment did. */
  if (!judgment.askDecision.shouldAsk) {
    const snuck = unearnedAskInBody(body);
    if (snuck) {
      console.error(
        `[comms-draft] ask gate: writing pass snuck an ask ("${snuck}") against a no-ask judgment; rewriting once`,
      );
      const retry = await write(
        `${WRITE_INSTRUCTIONS}

Correction: the judgment decided NO ask belongs in this message, but the previous
attempt asked for time ("${snuck}"). Write again with no ask of any kind — no call,
coffee, meeting, or finding time, however softly phrased. Acknowledge, reflect, build
on the thread, and close.`,
      );
      const rewritten = readWritten(retry);
      const stillSnuck = unearnedAskInBody(rewritten.body);
      if (stillSnuck) {
        console.error(
          `[comms-draft] ask_gate_violated: retry still asked ("${stillSnuck}") against a no-ask judgment`,
        );
        throw new DraftFailure("ask_gate_violated");
      }
      subject = rewritten.subject;
      body = rewritten.body;
    }
  }

  const verdict = checkVoice(body, { register: input.register, requireSignoff: true });

  return {
    subject: subject.replace(/[!\u2014]/g, "").trim(),
    body: verdict.text,
    register: input.register,
    reviewState: requiresHumanReview(input.register, verdict) ? "needs_human_review" : "draft",
    violations: verdict.violations,
    usedEvidence: input.usedEvidence,
    judgment,
    grounding: input.groundingSummary,
    provider: written.provider,
    model: written.model,
  };
}

function safeJson(raw: string): Record<string, unknown> | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}
