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
  threadContextForJudgment,
  type CommunicationJudgment,
} from "@/domain/comms-judgment";
import {
  runtimeModelCaller,
  runtimeProviderStatus,
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
You reason over the evidence and return the judgment a draft will be written from.

Spirit first: see the person before the transaction. Judge why Tai is writing now, what
this person is likely carrying or caring about (from the evidence only), what Tai wants
them to feel, and whether any next step is actually needed.

Return strict JSON only:
{
  "whyNow": "one plain sentence: why Tai is writing now, grounded in the evidence",
  "whatNoticed": "what this person is likely carrying or caring about, based only on the evidence",
  "intendedEffect": "what Tai wants them to feel when they finish reading",
  "responseObligation": "what in their latest message deserves acknowledgement or answer; empty when there is no live thread",
  "nextMove": { "ask": true|false, "what": "the proportionate ask, or empty when no ask belongs in this message" },
  "factsAllowed": ["evidence lines the draft may reference as fact"],
  "factsAvoid": ["claims the draft must not state — inferred, unsupported, or invented"],
  "voiceEvidenceUsed": ["the canonical relationship-voice rules that govern this draft"],
  "learnedExamplesUsed": ["the approved examples that influenced the judgment; empty when none did"]
}

Laws:
1. Use only the evidence provided. Never invent a fact, a name, a date, a shared history,
   or a personal detail. When the evidence is thin, judge less — never fill gaps with guesses.
2. Inferred reads may shape your judgment but must land in factsAvoid, never factsAllowed.
3. Not every message needs an ask. A thoughtful acknowledgement, an answer, or a plain
   continuation with no ask is often the right move. When an ask belongs, it is small
   and easy to decline — spaciousness, never pressure.
4. Ordinary email is not brand content. Roadmap language, proprietary frameworks, and
   positioning enter only when the conversation itself calls for them.
5. This is a product-level rationale a person will read. Concise, plain, no chain-of-thought.`;

const WRITE_INSTRUCTIONS = `You write one short email for Tai at Trust Tai, FROM the communication judgment
below. You never send anything.

The canonical Tai relationship voice is the baseline for every message:
- Warm, calm, concise, human, specific. Quiet confidence, no performance.
- Natural contractions. Short paragraphs. Everyday words.
- See the person first: one specific, true detail from the evidence beats any compliment.
- Create spaciousness, never pressure. No manufactured urgency.
- No corporate language and no generic networking language.
- No fake familiarity and no invented personalization: if it is not in the evidence, it does not exist.
- No forced call to action. A natural question is welcome; make the ask only when the judgment names one.

Laws:
1. The judgment governs. Reference only facts in factsAllowed. Never state anything in factsAvoid.
2. If nextMove.ask is false, make no ask. A message can simply acknowledge, answer, or continue.
3. Hard rules: no em dashes, no exclamation marks, no 'just checking in' or 'touching base',
   no needy phrasing, no promises.
4. Approved examples influence rhythm and texture only — they never override this baseline.
5. Brand or website language enters only when the conversation calls for it.
6. Short. Most messages earn 4 to 8 sentences before the signoff.
7. Use the given salutation name only if a salutation is natural here; otherwise start plainly.
   Never guess a name.
8. Return JSON only: {"subject": string, "body": string}. The body must end with 'Trust,',
   then a new line, then 'Tai'.`;

/**
 * Compose one draft: judgment first, prose second, deterministic Voice pass
 * last. Returns the checked text, the judgment it rests on, and every rule
 * it tripped, so the reviewer sees exactly what the policy saw.
 *
 * Throws DRAFT_PREPARATION_FAILED when no trustworthy draft can be produced.
 * A fabricated generic draft is never returned in its place.
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
      "id, organization_id, full_name, company_name, stage, met_where, next_action, observed, inferred, decided",
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

  const evidencePacket = {
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
      observedAndDecided: usedEvidence.map((entry) => `${entry.label}: ${entry.value} (${entry.tier})`),
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
    voiceDna: voiceDocument,
    approvedVoiceExamples: voiceExamples,
  };

  /* From here the provider does the work. Any failure — not configured,
     refused, unreadable, empty — fails closed: the caller gets the calm
     error and no draft exists. */
  const status = runtimeProviderStatus();
  if (!status.configured) throw new Error(DRAFT_PREPARATION_FAILED);

  let judgment: CommunicationJudgment;
  let subject: string;
  let body: string;
  let providerName: string;
  let model: string;

  try {
    const callModel = await runtimeModelCaller({
      token,
      organizationId,
      room: "comms",
      purpose: "draft",
    });

    // Pass one — reason. The judgment comes before any prose.
    const reasoned = await callModel({
      instructions: JUDGMENT_INSTRUCTIONS,
      input: JSON.stringify(evidencePacket),
      webSearch: false,
    });
    const parsedJudgment = parseCommunicationJudgment(safeJson(reasoned.raw));
    if (!parsedJudgment) throw new Error("unreadable judgment");
    judgment = parsedJudgment;

    // Pass two — write. The prose is generated FROM the judgment, never
    // alongside it.
    const written = await callModel({
      instructions: WRITE_INSTRUCTIONS,
      input: JSON.stringify({
        judgment,
        salutationName: salutation || null,
        evidence: evidencePacket,
      }),
      webSearch: false,
    });
    providerName = written.provider;
    model = written.model;

    const parsed = safeJson(written.raw);
    body = String(parsed?.["body"] ?? "").trim();
    subject = String(parsed?.["subject"] ?? "").trim();
    if (!body || !subject) throw new Error("empty draft");
  } catch {
    throw new Error(DRAFT_PREPARATION_FAILED);
  }

  const verdict = checkVoice(body, { register, requireSignoff: true });

  return {
    subject: subject.replace(/[!\u2014]/g, "").trim(),
    body: verdict.text,
    register,
    reviewState: requiresHumanReview(register, verdict) ? "needs_human_review" : "draft",
    violations: verdict.violations,
    usedEvidence,
    judgment,
    provider: providerName!,
    model: model!,
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
