/**
 * Comms message review (server only).
 *
 * A person pastes the communication they received, adds whatever material
 * they have, writes the reply they mean to send, and asks for a review. What
 * comes back is not a rewrite: it is a judgment of the words they wrote,
 * against the words they were sent.
 *
 * What this module guarantees, and does not leave to the model:
 *
 *  - every review is bound to one immutable draft version. Edit the words and
 *    a new version is written; the old run keeps judging the old words,
 *  - every source is either genuinely read or honestly named as unread. A PDF
 *    is never silently treated as understood,
 *  - every question and request in the source is tracked, and an "answered"
 *    verdict only survives if the passage that answers it is really in that
 *    draft version. Anything unverifiable stays uncertain,
 *  - approval is an owner or admin act, recorded against a version and a
 *    context fingerprint, and it goes stale the moment anything moves,
 *  - nothing here sends anything. There is no send path in this file.
 *
 * Every read and write runs with the CALLER'S token, so RLS applies. No
 * service-role key is used.
 */

import { createClient } from "@supabase/supabase-js";

import { trustTaiSupabaseKey, trustTaiSupabaseUrl } from "@/lib/trust-tai-backend.server";
import {
  extractJsonObject,
  ProviderCallFailedError,
  ProviderNotConfiguredError,
  runtimeModelCaller,
} from "@/lib/intelligence-runtime.server";

import {
  classifySource,
  segmentSource,
  sourceCoverageNote,
  type ClassifiedSource,
} from "@/domain/comms-sources";
import {
  lexicalHint,
  obligationsFromSource,
  summarizeObligations,
  verifyObligationVerdicts,
  type Obligation,
  type ObligationCoverage,
  type ObligationVerdict,
  type RawObligationVerdict,
} from "@/domain/comms-obligations";
import {
  canApproveReview,
  contextFingerprint,
  nextVersionNumber,
  readApproval,
  APPROVAL_ROLE_REFUSAL,
  type ApprovalReading,
  type FindingSeverity,
  type ReviewApproval,
  type ReviewFinding,
  type ReviewRun,
  type ReviewSession,
  type ReviewVersion,
} from "@/domain/comms-review";

/** Bumped whenever the instructions or the packet change shape. */
export const REVIEW_PROMPT_VERSION = "comms-review/2026-09-14";

/* -------------------------------------------------------------- failures */

export type ReviewFailureCode =
  | "access_denied"
  | "not_found"
  | "provider_not_configured"
  | "provider_call_failed"
  | "review_unreadable"
  | "stale_version"
  | "approval_forbidden"
  | "write_failed";

export class ReviewFailure extends Error {
  constructor(
    readonly code: ReviewFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "ReviewFailure";
  }
}

/* ---------------------------------------------------------------- client */

function callerClient(token: string) {
  return createClient(trustTaiSupabaseUrl(), trustTaiSupabaseKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

type CallerClient = ReturnType<typeof callerClient>;

interface Caller {
  client: CallerClient;
  userId: string;
  role: string;
}

/**
 * Who is asking, and what they are allowed to do here. Fail-closed: no valid
 * session, or no active membership, and nothing proceeds.
 */
async function identify(token: string, organizationId: string): Promise<Caller> {
  const client = callerClient(token);
  const { data: auth } = await client.auth.getUser();
  const userId = auth?.user?.id ?? "";
  if (!userId) {
    throw new ReviewFailure("access_denied", "Your session has expired. Sign in again.");
  }
  const { data, error } = await client
    .from("organization_memberships")
    .select("role, status")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  const row = (data ?? null) as { role?: string; status?: string } | null;
  if (error || !row || (row.status && row.status !== "active")) {
    throw new ReviewFailure(
      "access_denied",
      "You don't have access to this workspace. Nothing was changed.",
    );
  }
  return { client, userId, role: String(row.role ?? "") };
}

/* ------------------------------------------------------------ row mapping */

type Row = Record<string, unknown>;

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const nullableStr = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;
const num = (value: unknown): number | null => (typeof value === "number" ? value : null);
const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

function toSession(row: Row): ReviewSession {
  return {
    id: str(row["id"]),
    organizationId: str(row["organization_id"]),
    relationshipId: nullableStr(row["relationship_id"]),
    threadId: nullableStr(row["thread_id"]),
    title: str(row["title"]),
    situation: nullableStr(row["situation"]),
    goal: nullableStr(row["goal"]),
    recipientName: nullableStr(row["recipient_name"]),
    recipientEmail: nullableStr(row["recipient_email"]),
    status: (str(row["status"]) || "open") as ReviewSession["status"],
    createdBy: nullableStr(row["created_by"]),
    createdAt: str(row["created_at"]),
    updatedAt: str(row["updated_at"]),
  };
}

function toVersion(row: Row): ReviewVersion {
  return {
    id: str(row["id"]),
    sessionId: str(row["session_id"]),
    version: typeof row["version"] === "number" ? (row["version"] as number) : 1,
    subject: nullableStr(row["subject"]),
    body: str(row["body"]),
    origin: (str(row["origin"]) || "intake") as ReviewVersion["origin"],
    authorUserId: nullableStr(row["author_user_id"]),
    createdAt: str(row["created_at"]),
  };
}

function toRun(row: Row): ReviewRun {
  return {
    id: str(row["id"]),
    sessionId: str(row["session_id"]),
    versionId: str(row["version_id"]),
    status: (str(row["status"]) || "running") as ReviewRun["status"],
    provider: nullableStr(row["provider"]),
    model: nullableStr(row["model"]),
    promptVersion: nullableStr(row["prompt_version"]),
    contextFingerprint: nullableStr(row["context_fingerprint"]),
    stages: list(row["stages"]),
    latencyMs: num(row["latency_ms"]),
    errorCode: nullableStr(row["error_code"]),
    summary: nullableStr(row["summary"]),
    goalRead: nullableStr(row["goal_read"]),
    coverage: (row["coverage"] as Record<string, unknown>) ?? {},
    limitations: list(row["limitations"]),
    startedAt: str(row["started_at"]),
    completedAt: nullableStr(row["completed_at"]),
  };
}

function toFinding(row: Row): ReviewFinding {
  return {
    id: str(row["id"]),
    runId: str(row["run_id"]),
    versionId: str(row["version_id"]),
    kind: str(row["kind"]),
    severity: (str(row["severity"]) || "note") as FindingSeverity,
    excerpt: nullableStr(row["excerpt"]),
    excerptStart: num(row["excerpt_start"]),
    excerptEnd: num(row["excerpt_end"]),
    why: str(row["why"]),
    suggestion: nullableStr(row["suggestion"]),
    state: (str(row["state"]) || "open") as ReviewFinding["state"],
    position: typeof row["position"] === "number" ? (row["position"] as number) : 0,
  };
}

function toApproval(row: Row): ReviewApproval {
  return {
    id: str(row["id"]),
    sessionId: str(row["session_id"]),
    versionId: str(row["version_id"]),
    runId: nullableStr(row["run_id"]),
    contextFingerprint: str(row["context_fingerprint"]),
    approvedBy: str(row["approved_by"]),
    approvedAt: str(row["approved_at"]),
    approverRole: nullableStr(row["approver_role"]),
    reason: nullableStr(row["reason"]),
  };
}

function toObligation(row: Row): ObligationVerdict {
  const start = num(row["excerpt_start"]) ?? 0;
  const excerpt = str(row["excerpt"]);
  const answerQuote = nullableStr(row["answer_excerpt"]);
  return {
    obligationId: str(row["obligation_key"]) || str(row["id"]),
    kind: (str(row["kind"]) || "question") as ObligationVerdict["kind"],
    excerpt,
    anchor: {
      sourceId: str(row["source_id"]),
      start,
      end: num(row["excerpt_end"]) ?? start + excerpt.length,
      quote: excerpt,
    },
    status: (str(row["status"]) || "uncertain") as ObligationVerdict["status"],
    method: (str(row["method"]) || "semantic") as ObligationVerdict["method"],
    confidence: (str(row["confidence"]) || "low") as ObligationVerdict["confidence"],
    answer: answerQuote
      ? {
          versionId: str(row["version_id"]),
          start: num(row["answer_start"]) ?? 0,
          end: num(row["answer_end"]) ?? 0,
          quote: answerQuote,
        }
      : null,
    because: str(row["because"]),
  };
}

/* ---------------------------------------------------------------- intake */

export interface SourceInput {
  label?: string;
  filename?: string;
  mediaType?: string;
  text?: string;
}

export interface CreateReviewInput {
  organizationId: string;
  title: string;
  situation?: string;
  goal?: string;
  recipientName?: string;
  recipientEmail?: string;
  relationshipId?: string;
  threadId?: string;
  subject?: string;
  body: string;
  sources: SourceInput[];
}

function fail(message: string): never {
  throw new ReviewFailure("write_failed", message);
}

/**
 * Open a review: the session, the first immutable version, and the source
 * material classified honestly. No model runs here.
 */
export async function createReviewSession(
  token: string,
  input: CreateReviewInput,
): Promise<{ sessionId: string; versionId: string; sources: ClassifiedSource[] }> {
  const caller = await identify(token, input.organizationId);
  const now = new Date().toISOString();

  const { data: sessionRow, error: sessionError } = await caller.client
    .from("comms_review_sessions")
    .insert({
      organization_id: input.organizationId,
      relationship_id: input.relationshipId ?? null,
      thread_id: input.threadId ?? null,
      title: input.title.trim() || "Message review",
      situation: input.situation?.trim() || null,
      goal: input.goal?.trim() || null,
      recipient_name: input.recipientName?.trim() || null,
      recipient_email: input.recipientEmail?.trim().toLowerCase() || null,
      status: "open",
      created_by: caller.userId,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .maybeSingle();
  if (sessionError || !sessionRow) fail("That review could not be opened. Nothing was saved.");
  const session = toSession(sessionRow as Row);

  const { data: versionRow, error: versionError } = await caller.client
    .from("comms_review_versions")
    .insert({
      organization_id: input.organizationId,
      session_id: session.id,
      version: 1,
      subject: input.subject?.trim() || null,
      body: input.body,
      origin: "intake",
      author_user_id: caller.userId,
      created_at: now,
    })
    .select("*")
    .maybeSingle();
  if (versionError || !versionRow) fail("Your draft could not be saved. Nothing was recorded.");

  const classified = input.sources.map((source) => classifySource(source));
  if (classified.length > 0) {
    const { error } = await caller.client.from("comms_review_sources").insert(
      classified.map((source) => ({
        organization_id: input.organizationId,
        session_id: session.id,
        label: source.label,
        kind: source.kind,
        filename: source.filename,
        media_type: source.mediaType,
        status: source.status,
        status_note: source.statusNote,
        content: source.content,
        char_count: source.charCount,
        checksum: source.checksum,
        created_by: caller.userId,
        created_at: now,
      })),
    );
    // A duplicate checksum is the same material offered twice; that is fine.
    if (error && !/duplicate key/i.test(error.message)) {
      fail("The source material could not be saved. Nothing was recorded.");
    }
  }

  return {
    sessionId: session.id,
    versionId: toVersion(versionRow as Row).id,
    sources: classified,
  };
}

/** Record an edit as a new immutable version. The previous one is untouched. */
export async function reviseDraft(
  token: string,
  input: { organizationId: string; sessionId: string; subject?: string; body: string },
): Promise<ReviewVersion> {
  const caller = await identify(token, input.organizationId);
  const { data } = await caller.client
    .from("comms_review_versions")
    .select("version")
    .eq("session_id", input.sessionId)
    .order("version", { ascending: false });
  const version = nextVersionNumber(((data ?? []) as Row[]).map((row) => toVersion(row)));

  const { data: row, error } = await caller.client
    .from("comms_review_versions")
    .insert({
      organization_id: input.organizationId,
      session_id: input.sessionId,
      version,
      subject: input.subject?.trim() || null,
      body: input.body,
      origin: "edit",
      author_user_id: caller.userId,
      created_at: new Date().toISOString(),
    })
    .select("*")
    .maybeSingle();
  if (error || !row) fail("That edit could not be saved. Your previous version is unchanged.");
  return toVersion(row as Row);
}

/* -------------------------------------------------------------- the read */

const REVIEW_INSTRUCTIONS = `You are the reviewer inside Trust Tai OS, an operating system for a
small services business. A person has written a reply and is asking whether it is fit to send.
You are reviewing THEIR words. You are not rewriting the message and you are not the author.

You are given: the communication they received (in full, or with its gaps named), any further
source material that could be read, what they say they are trying to achieve, and the exact draft
they intend to send.

Laws you must obey:
1. Judge only what is in the packet. Never introduce a date, price, name, commitment or fact that
   is not there. If the draft needs one, that is a finding, not something for you to supply.
2. Every finding must quote the exact words in the draft it is about, copied character for
   character from the draft. A finding you cannot quote must not be returned.
3. For every obligation listed in the packet, say whether the draft answers it. If you say it is
   answered, partly answered, or pending confirmation, you must quote the passage OF THE DRAFT
   that does so, character for character. Repeating the question is never an answer.
4. If you cannot tell, say "uncertain". Uncertain is a good answer. Guessing is not.
5. Never comment on the writer as a person. Judge the message.
6. Name what you could not read in "limitations", using only the source statuses in the packet.

Return strict JSON only:
{
 "summary": "one or two sentences on whether this is fit to send",
 "goalRead": "what you understand they are trying to achieve, in their terms",
 "findings": [{"kind":"ambiguity|unsupported_claim|conflict|omission|tone|structure|identity",
   "severity":"must_fix|consider|note","excerpt":"exact words from the draft",
   "why":"one sentence","suggestion":"a concrete replacement, or null"}],
 "obligations": [{"obligationId":"...","status":"answered|partly_answered|pending_confirmation|missing|uncertain",
   "answerQuote":"exact words from the draft, or null","because":"one sentence",
   "confidence":"high|medium|low"}],
 "limitations": ["..."]
}`;

interface ReviewPacketSource {
  label: string;
  status: string;
  note: string;
  segments?: string[];
}

export interface ReviewRunResult {
  runId: string;
  summary: string;
  goalRead: string;
  findings: ReviewFinding[];
  obligations: ObligationCoverage;
  limitations: string[];
  provider: string;
  model: string;
}

/**
 * Run one review over one exact version. The run is recorded before the model
 * is called, so a failure leaves an honest record rather than silence.
 */
export async function runReview(
  token: string,
  input: { organizationId: string; sessionId: string; versionId: string },
): Promise<ReviewRunResult> {
  const caller = await identify(token, input.organizationId);
  const started = Date.now();

  const [sessionRes, versionRes, sourceRes] = await Promise.all([
    caller.client.from("comms_review_sessions").select("*").eq("id", input.sessionId).maybeSingle(),
    caller.client.from("comms_review_versions").select("*").eq("id", input.versionId).maybeSingle(),
    caller.client.from("comms_review_sources").select("*").eq("session_id", input.sessionId),
  ]);
  if (!sessionRes.data || !versionRes.data) {
    throw new ReviewFailure("not_found", "That review could not be found.");
  }
  const session = toSession(sessionRes.data as Row);
  const version = toVersion(versionRes.data as Row);
  const sourceRows = (sourceRes.data ?? []) as Row[];

  /* Obligations come from the sources we genuinely read. A source we could
     not read contributes no obligations, and says so in limitations. */
  const obligations: Obligation[] = [];
  const packetSources: ReviewPacketSource[] = [];
  for (const row of sourceRows) {
    const content = nullableStr(row["content"]);
    const label = str(row["label"]) || "Source";
    packetSources.push({
      label,
      status: str(row["status"]),
      note: str(row["status_note"]),
      ...(content ? { segments: segmentSource(content).map((segment) => segment.text) } : {}),
    });
    if (!content) continue;
    for (const obligation of obligationsFromSource({
      sourceId: str(row["id"]),
      text: content,
      label,
    })) {
      obligations.push(lexicalHint(obligation, version.body));
    }
  }

  const fingerprint = contextFingerprint({
    versionId: version.id,
    subject: version.subject,
    body: version.body,
    recipientEmail: session.recipientEmail,
    recipientName: session.recipientName,
    goal: session.goal,
    sourceChecksums: sourceRows.map((row) => str(row["checksum"])),
    senderName: null,
  });

  const { data: runRow, error: runError } = await caller.client
    .from("comms_review_runs")
    .insert({
      organization_id: input.organizationId,
      session_id: input.sessionId,
      version_id: input.versionId,
      status: "running",
      prompt_version: REVIEW_PROMPT_VERSION,
      context_fingerprint: fingerprint,
      stages: ["packet"],
      started_at: new Date().toISOString(),
      created_by: caller.userId,
    })
    .select("*")
    .maybeSingle();
  if (runError || !runRow) fail("That review could not be started. Nothing was recorded.");
  const runId = toRun(runRow as Row).id;

  const packet = {
    situation: session.situation,
    goal: session.goal,
    recipient: { name: session.recipientName, email: session.recipientEmail },
    sources: packetSources,
    sourceCoverage: sourceCoverageNote(
      sourceRows.map((row) => ({
        status: str(row["status"]) as ClassifiedSource["status"],
      })) as ClassifiedSource[],
    ),
    obligations: obligations.map((obligation) => ({
      obligationId: obligation.id,
      kind: obligation.kind,
      text: obligation.excerpt,
    })),
    draft: { subject: version.subject, body: version.body, version: version.version },
  };

  let raw = "";
  let provider = "none";
  let model = "none";
  try {
    const callModel = await runtimeModelCaller({
      token,
      organizationId: input.organizationId,
      room: "comms",
      purpose: "comms_review",
    });
    const answer = await callModel({
      instructions: REVIEW_INSTRUCTIONS,
      input: JSON.stringify(packet),
      webSearch: false,
    });
    raw = answer.raw;
    provider = answer.provider;
    model = answer.model;
  } catch (error) {
    const code: ReviewFailureCode =
      error instanceof ProviderNotConfiguredError
        ? "provider_not_configured"
        : error instanceof ProviderCallFailedError
          ? "provider_call_failed"
          : error instanceof Error && error.message === "forbidden"
            ? "access_denied"
            : "provider_call_failed";
    await caller.client
      .from("comms_review_runs")
      .update({
        status: "failed",
        error_code: code,
        completed_at: new Date().toISOString(),
        latency_ms: Date.now() - started,
      })
      .eq("id", runId);
    throw new ReviewFailure(
      code,
      code === "provider_not_configured"
        ? "Reviewing isn't available right now. Nothing was judged and your draft is untouched."
        : "The review couldn't be completed. Nothing was judged and your draft is untouched.",
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = extractJsonObject(raw);
  } catch {
    await caller.client
      .from("comms_review_runs")
      .update({
        status: "failed",
        error_code: "review_unreadable",
        provider,
        model,
        completed_at: new Date().toISOString(),
        latency_ms: Date.now() - started,
      })
      .eq("id", runId);
    throw new ReviewFailure(
      "review_unreadable",
      "The review came back in a form Comms couldn't read. Nothing was judged.",
    );
  }

  /* Findings are kept only when their quote is really in this draft. A
     finding about words the person did not write is worse than no finding. */
  const rawFindings = Array.isArray(parsed["findings"]) ? (parsed["findings"] as Row[]) : [];
  const findingRows = rawFindings
    .map((finding, index) => {
      const excerpt = str(finding["excerpt"]);
      const at = excerpt ? version.body.indexOf(excerpt) : -1;
      if (excerpt && at < 0) return null;
      const why = str(finding["why"]).trim();
      if (!why) return null;
      const severity = (["must_fix", "consider", "note"] as const).find(
        (candidate) => candidate === finding["severity"],
      );
      return {
        organization_id: input.organizationId,
        session_id: input.sessionId,
        run_id: runId,
        version_id: input.versionId,
        kind: str(finding["kind"]) || "note",
        severity: severity ?? "note",
        excerpt: excerpt || null,
        excerpt_start: at >= 0 ? at : null,
        excerpt_end: at >= 0 ? at + excerpt.length : null,
        why,
        suggestion: nullableStr(finding["suggestion"]),
        state: "open",
        position: index,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const verdicts = verifyObligationVerdicts({
    obligations,
    draftText: version.body,
    versionId: version.id,
    raw: Array.isArray(parsed["obligations"])
      ? (parsed["obligations"] as RawObligationVerdict[])
      : [],
  });
  const coverage = summarizeObligations(verdicts);

  const obligationRows = verdicts.map((verdict) => ({
    organization_id: input.organizationId,
    session_id: input.sessionId,
    run_id: runId,
    version_id: input.versionId,
    source_id: verdict.anchor.sourceId,
    obligation_key: verdict.obligationId,
    kind: verdict.kind,
    excerpt: verdict.excerpt,
    excerpt_start: verdict.anchor.start,
    excerpt_end: verdict.anchor.end,
    status: verdict.status,
    method: verdict.method,
    confidence: verdict.confidence,
    answer_excerpt: verdict.answer?.quote ?? null,
    answer_start: verdict.answer?.start ?? null,
    answer_end: verdict.answer?.end ?? null,
    because: verdict.because,
  }));

  const limitations = list(parsed["limitations"]);
  if (findingRows.length > 0) await caller.client.from("comms_review_findings").insert(findingRows);
  if (obligationRows.length > 0) {
    await caller.client.from("comms_review_obligations").insert(obligationRows);
  }

  await caller.client
    .from("comms_review_runs")
    .update({
      status: "complete",
      provider,
      model,
      stages: ["packet", "judgment", "verification"],
      summary: str(parsed["summary"]) || null,
      goal_read: str(parsed["goalRead"]) || null,
      coverage: {
        answered: coverage.answered,
        outstanding: coverage.outstanding,
        uncertain: coverage.uncertain,
        total: coverage.verdicts.length,
        complete: coverage.complete,
        note: coverage.note,
      },
      limitations,
      completed_at: new Date().toISOString(),
      latency_ms: Date.now() - started,
    })
    .eq("id", runId);

  const { data: savedFindings } = await caller.client
    .from("comms_review_findings")
    .select("*")
    .eq("run_id", runId)
    .order("position", { ascending: true });

  return {
    runId,
    summary: str(parsed["summary"]),
    goalRead: str(parsed["goalRead"]),
    findings: ((savedFindings ?? []) as Row[]).map(toFinding),
    obligations: coverage,
    limitations,
    provider,
    model,
  };
}

/* -------------------------------------------------------------- findings */

/** Accept, keep, or mark a finding handled. The judgment itself never moves. */
export async function decideFinding(
  token: string,
  input: {
    organizationId: string;
    findingId: string;
    state: "accepted" | "kept" | "edited" | "open";
  },
): Promise<void> {
  const caller = await identify(token, input.organizationId);
  const { error } = await caller.client
    .from("comms_review_findings")
    .update({ state: input.state })
    .eq("id", input.findingId)
    .eq("organization_id", input.organizationId);
  if (error) fail("That decision could not be recorded.");
}

/* -------------------------------------------------------------- approval */

/**
 * Approve one exact version. An owner or admin act, bound to the words and
 * the context in front of them. This records a decision; it sends nothing,
 * and no send path reads it yet.
 */
export async function approveVersion(
  token: string,
  input: {
    organizationId: string;
    sessionId: string;
    versionId: string;
    runId?: string;
    reason?: string;
  },
): Promise<ReviewApproval> {
  const caller = await identify(token, input.organizationId);
  if (!canApproveReview(caller.role)) {
    throw new ReviewFailure("approval_forbidden", APPROVAL_ROLE_REFUSAL);
  }

  const state = await loadReview(token, {
    organizationId: input.organizationId,
    sessionId: input.sessionId,
  });
  if (state.currentVersion?.id !== input.versionId) {
    throw new ReviewFailure(
      "stale_version",
      "The draft changed while you were reading it. Review the current version before approving.",
    );
  }

  const { data, error } = await caller.client
    .from("comms_review_approvals")
    .insert({
      organization_id: input.organizationId,
      session_id: input.sessionId,
      version_id: input.versionId,
      run_id: input.runId ?? null,
      context_fingerprint: state.fingerprint,
      approved_by: caller.userId,
      approved_at: new Date().toISOString(),
      approver_role: caller.role,
      reason: input.reason?.trim() || null,
    })
    .select("*")
    .maybeSingle();
  if (error || !data) {
    throw new ReviewFailure(
      "approval_forbidden",
      "That approval was refused. Approving is an owner or admin decision.",
    );
  }
  await caller.client
    .from("comms_review_sessions")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("id", input.sessionId);
  return toApproval(data as Row);
}

/* ----------------------------------------------------------------- reads */

export interface ReviewState {
  session: ReviewSession;
  versions: ReviewVersion[];
  currentVersion: ReviewVersion | null;
  sources: {
    id: string;
    label: string;
    status: string;
    statusNote: string;
    charCount: number;
  }[];
  latestRun: ReviewRun | null;
  findings: ReviewFinding[];
  obligations: ObligationCoverage;
  approval: ApprovalReading;
  fingerprint: string;
  /** True when the latest run judged the words on screen. */
  runIsCurrent: boolean;
  coverageNote: string;
}

export async function loadReview(
  token: string,
  input: { organizationId: string; sessionId: string },
): Promise<ReviewState> {
  const caller = await identify(token, input.organizationId);
  const [sessionRes, versionRes, sourceRes, runRes, approvalRes] = await Promise.all([
    caller.client.from("comms_review_sessions").select("*").eq("id", input.sessionId).maybeSingle(),
    caller.client
      .from("comms_review_versions")
      .select("*")
      .eq("session_id", input.sessionId)
      .order("version", { ascending: true }),
    caller.client.from("comms_review_sources").select("*").eq("session_id", input.sessionId),
    caller.client
      .from("comms_review_runs")
      .select("*")
      .eq("session_id", input.sessionId)
      .order("started_at", { ascending: false })
      .limit(1),
    caller.client.from("comms_review_approvals").select("*").eq("session_id", input.sessionId),
  ]);
  if (!sessionRes.data) throw new ReviewFailure("not_found", "That review could not be found.");

  const session = toSession(sessionRes.data as Row);
  const versions = ((versionRes.data ?? []) as Row[]).map(toVersion);
  const currentVersion = versions.at(-1) ?? null;
  const sourceRows = (sourceRes.data ?? []) as Row[];
  const latestRun = ((runRes.data ?? []) as Row[]).map(toRun)[0] ?? null;

  const fingerprint = currentVersion
    ? contextFingerprint({
        versionId: currentVersion.id,
        subject: currentVersion.subject,
        body: currentVersion.body,
        recipientEmail: session.recipientEmail,
        recipientName: session.recipientName,
        goal: session.goal,
        sourceChecksums: sourceRows.map((row) => str(row["checksum"])),
        senderName: null,
      })
    : "";

  let findings: ReviewFinding[] = [];
  let verdicts: ObligationVerdict[] = [];
  if (latestRun) {
    const [findingRes, obligationRes] = await Promise.all([
      caller.client
        .from("comms_review_findings")
        .select("*")
        .eq("run_id", latestRun.id)
        .order("position", { ascending: true }),
      caller.client.from("comms_review_obligations").select("*").eq("run_id", latestRun.id),
    ]);
    findings = ((findingRes.data ?? []) as Row[]).map(toFinding);
    verdicts = ((obligationRes.data ?? []) as Row[]).map(toObligation);
  }

  return {
    session,
    versions,
    currentVersion,
    sources: sourceRows.map((row) => ({
      id: str(row["id"]),
      label: str(row["label"]),
      status: str(row["status"]),
      statusNote: str(row["status_note"]),
      charCount: num(row["char_count"]) ?? 0,
    })),
    latestRun,
    findings,
    obligations: summarizeObligations(verdicts),
    approval: readApproval({
      approvals: ((approvalRes.data ?? []) as Row[]).map(toApproval),
      currentVersionId: currentVersion?.id ?? "",
      currentFingerprint: fingerprint,
    }),
    fingerprint,
    runIsCurrent: Boolean(latestRun && currentVersion && latestRun.versionId === currentVersion.id),
    coverageNote: sourceCoverageNote(
      sourceRows.map((row) => ({
        status: str(row["status"]) as ClassifiedSource["status"],
      })) as ClassifiedSource[],
    ),
  };
}

/** The reviews open in this workspace, newest first. */
export async function listReviews(token: string, organizationId: string): Promise<ReviewSession[]> {
  const caller = await identify(token, organizationId);
  const { data } = await caller.client
    .from("comms_review_sessions")
    .select("*")
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false })
    .limit(50);
  return ((data ?? []) as Row[]).map(toSession);
}
