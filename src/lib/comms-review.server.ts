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
 * Authority in this file, exactly:
 *
 *   - every READ runs with the caller's own token, under RLS, and always
 *     carries the requested organization as an explicit filter, because a
 *     person may belong to more than one workspace,
 *   - every WRITE runs with the server's service credentials, and only after
 *     this module has itself proved the caller: a real session, an ACTIVE
 *     membership of that exact organization, and, for approval, an approving
 *     role. Members cannot write these tables directly; the database grants
 *     them SELECT only, so a review run, a finding or an approval can never
 *     be forged from the browser,
 *   - if the service credentials are absent, writes fail honestly and loudly.
 *     There is no fallback to the browser key.
 *
 * Nothing here sends anything. There is no send path in this file.
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
  approvalReadiness,
  APPROVAL_SCOPE_NOTE,
  canApproveReview,
  contextFingerprint,
  reviewRunIsCurrent,
  nextVersionNumber,
  readApproval,
  APPROVAL_ROLE_REFUSAL,
  type ApprovalReadiness,
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
  | "not_ready"
  | "server_not_configured"
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

/**
 * The writer. Service credentials, server side only, never returned, never
 * logged, never handed to the browser. Absent credentials are an honest
 * failure, not a quiet downgrade to the caller's key: a review record that
 * ordinary members could write would not be worth keeping.
 */
function writerClient() {
  const key =
    process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"] || process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!key) {
    throw new ReviewFailure(
      "server_not_configured",
      "Comms review is not configured on this server, so nothing was saved. Ask an administrator to finish the setup.",
    );
  }
  return createClient(trustTaiSupabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

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
    contextRevision:
      typeof row["context_revision"] === "number" ? (row["context_revision"] as number) : 1,
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
    contextRevision: num(row["context_revision"]),
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
    contextRevision: num(row["context_revision"]),
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
 * Load a session as the caller, inside the organization they named. The
 * organization filter is not decoration: a person can belong to several
 * workspaces, and a session id alone must never be enough to reach across.
 */
async function requireSession(
  caller: Caller,
  organizationId: string,
  sessionId: string,
): Promise<ReviewSession> {
  const { data } = await caller.client
    .from("comms_review_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!data) throw new ReviewFailure("not_found", "That review could not be found.");
  return toSession(data as Row);
}

/** Load a version and prove it belongs to that session and organization. */
async function requireVersion(
  caller: Caller,
  organizationId: string,
  sessionId: string,
  versionId: string,
): Promise<ReviewVersion> {
  const { data } = await caller.client
    .from("comms_review_versions")
    .select("*")
    .eq("id", versionId)
    .eq("organization_id", organizationId)
    .eq("session_id", sessionId)
    .maybeSingle();
  if (!data) {
    throw new ReviewFailure("not_found", "That version of the draft could not be found.");
  }
  return toVersion(data as Row);
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
  const writer = writerClient();
  const now = new Date().toISOString();

  const { data: sessionRow, error: sessionError } = await writer
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

  const { data: versionRow, error: versionError } = await writer
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
    const { error } = await writer.from("comms_review_sources").insert(
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
      fail("The source material could not be saved, so this review has no material to read.");
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
  const session = await requireSession(caller, input.organizationId, input.sessionId);
  const writer = writerClient();

  const { data } = await caller.client
    .from("comms_review_versions")
    .select("version")
    .eq("organization_id", input.organizationId)
    .eq("session_id", session.id)
    .order("version", { ascending: false });
  const version = nextVersionNumber(
    ((data ?? []) as Row[]).map((row) => ({
      version: typeof row["version"] === "number" ? (row["version"] as number) : 0,
    })),
  );

  const { data: row, error } = await writer
    .from("comms_review_versions")
    .insert({
      organization_id: input.organizationId,
      session_id: session.id,
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

/**
 * What actually happens in a run, named truthfully. There is ONE model call.
 * The stages either side of it are ordinary code: building the packet, and
 * checking the model's claims against the real text. Nothing here is three
 * AI passes, and the record must never imply that it is.
 */
const RUN_STAGES = {
  packet: "packet_built (code)",
  call: "single_model_call",
  verify: "verification (code)",
  persist: "findings_and_coverage_saved (code)",
} as const;

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
 * Run one review over one exact version. The run row is written before the
 * model is called, so a failure leaves an honest record rather than silence,
 * and a run only reaches "complete" when everything it produced is actually
 * stored. A partial save is a failed run, not a quiet success.
 */
export async function runReview(
  token: string,
  input: { organizationId: string; sessionId: string; versionId: string },
): Promise<ReviewRunResult> {
  const caller = await identify(token, input.organizationId);
  const writer = writerClient();
  const started = Date.now();

  const session = await requireSession(caller, input.organizationId, input.sessionId);
  const version = await requireVersion(
    caller,
    input.organizationId,
    input.sessionId,
    input.versionId,
  );
  const { data: sourceData } = await caller.client
    .from("comms_review_sources")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("session_id", input.sessionId);
  const sourceRows = (sourceData ?? []) as Row[];

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

  const { data: runRow, error: runError } = await writer
    .from("comms_review_runs")
    .insert({
      organization_id: input.organizationId,
      session_id: input.sessionId,
      version_id: input.versionId,
      status: "running",
      prompt_version: REVIEW_PROMPT_VERSION,
      context_fingerprint: fingerprint,
      context_revision: session.contextRevision,
      stages: [RUN_STAGES.packet],
      started_at: new Date().toISOString(),
      created_by: caller.userId,
    })
    .select("*")
    .maybeSingle();
  if (runError || !runRow) fail("That review could not be started. Nothing was recorded.");
  const runId = toRun(runRow as Row).id;

  /** Close a run honestly when it could not finish. */
  const markFailed = async (code: string, stages: string[], provider?: string, model?: string) => {
    await writer
      .from("comms_review_runs")
      .update({
        status: "failed",
        error_code: code,
        stages,
        ...(provider ? { provider } : {}),
        ...(model ? { model } : {}),
        completed_at: new Date().toISOString(),
        latency_ms: Date.now() - started,
      })
      .eq("id", runId)
      .eq("organization_id", input.organizationId);
  };

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
    await markFailed(code, [RUN_STAGES.packet]);
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
    await markFailed("review_unreadable", [RUN_STAGES.packet, RUN_STAGES.call], provider, model);
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

  /* A review that could not store its findings or its coverage has not been
     done. It is recorded as failed, and the person is told plainly. */
  if (findingRows.length > 0) {
    const { error } = await writer.from("comms_review_findings").insert(findingRows);
    if (error) {
      await markFailed(
        "write_failed",
        [RUN_STAGES.packet, RUN_STAGES.call, RUN_STAGES.verify],
        provider,
        model,
      );
      throw new ReviewFailure(
        "write_failed",
        "The review ran but its findings could not be saved, so it is recorded as failed. Nothing was approved and your draft is untouched.",
      );
    }
  }
  if (obligationRows.length > 0) {
    const { error } = await writer.from("comms_review_obligations").insert(obligationRows);
    if (error) {
      await markFailed(
        "write_failed",
        [RUN_STAGES.packet, RUN_STAGES.call, RUN_STAGES.verify],
        provider,
        model,
      );
      throw new ReviewFailure(
        "write_failed",
        "The review ran but its question coverage could not be saved, so it is recorded as failed. Nothing was approved and your draft is untouched.",
      );
    }
  }

  const { error: completeError } = await writer
    .from("comms_review_runs")
    .update({
      status: "complete",
      provider,
      model,
      stages: [RUN_STAGES.packet, RUN_STAGES.call, RUN_STAGES.verify, RUN_STAGES.persist],
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
    .eq("id", runId)
    .eq("organization_id", input.organizationId);
  if (completeError) {
    throw new ReviewFailure(
      "write_failed",
      "The review ran but could not be closed off in the record, so it is not shown as complete. Run it again.",
    );
  }

  const { data: savedFindings } = await caller.client
    .from("comms_review_findings")
    .select("*")
    .eq("organization_id", input.organizationId)
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
  // Prove the finding is this workspace's before the writer touches it.
  const { data: existing } = await caller.client
    .from("comms_review_findings")
    .select("id")
    .eq("id", input.findingId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (!existing) throw new ReviewFailure("not_found", "That finding could not be found.");

  const { error } = await writerClient()
    .from("comms_review_findings")
    .update({ state: input.state })
    .eq("id", input.findingId)
    .eq("organization_id", input.organizationId);
  if (error) fail("That decision could not be recorded.");
}

/* -------------------------------------------------------------- approval */

/**
 * Approve one exact version. An owner or admin act, bound to the words, the
 * context and the review in front of them.
 *
 * This records a review decision. It is NOT permission to send: no Comms send
 * path reads this approval yet, and this slice adds none.
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
  if (!state.readiness.ready) {
    throw new ReviewFailure("not_ready", state.readiness.blockers.join(" "));
  }
  const run = state.latestRun;
  if (!run) {
    throw new ReviewFailure(
      "not_ready",
      "This draft has not been reviewed yet. Run a review before approving it.",
    );
  }
  if (input.runId && input.runId !== run.id) {
    throw new ReviewFailure(
      "stale_version",
      "A newer review has finished since you opened this. Read it before approving.",
    );
  }

  const { data, error } = await writerClient()
    .from("comms_review_approvals")
    .insert({
      organization_id: input.organizationId,
      session_id: input.sessionId,
      version_id: input.versionId,
      run_id: run.id,
      context_fingerprint: state.fingerprint,
      context_revision: state.session.contextRevision,
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
      "That approval was refused, so nothing was recorded. Either the draft moved while you were reading it, or approving is not yours to do here.",
    );
  }
  await writerClient()
    .from("comms_review_sessions")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("id", input.sessionId)
    .eq("organization_id", input.organizationId);
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
  readiness: ApprovalReadiness;
  fingerprint: string;
  /** True when the latest run judged exactly the words and context on screen. */
  runIsCurrent: boolean;
  coverageNote: string;
  /** What approving here does, and does not, mean. */
  approvalScopeNote: string;
}

export async function loadReview(
  token: string,
  input: { organizationId: string; sessionId: string },
): Promise<ReviewState> {
  const caller = await identify(token, input.organizationId);
  const session = await requireSession(caller, input.organizationId, input.sessionId);

  const [versionRes, sourceRes, runRes, approvalRes] = await Promise.all([
    caller.client
      .from("comms_review_versions")
      .select("*")
      .eq("organization_id", input.organizationId)
      .eq("session_id", input.sessionId)
      .order("version", { ascending: true }),
    caller.client
      .from("comms_review_sources")
      .select("*")
      .eq("organization_id", input.organizationId)
      .eq("session_id", input.sessionId),
    caller.client
      .from("comms_review_runs")
      .select("*")
      .eq("organization_id", input.organizationId)
      .eq("session_id", input.sessionId)
      .order("started_at", { ascending: false })
      .limit(1),
    caller.client
      .from("comms_review_approvals")
      .select("*")
      .eq("organization_id", input.organizationId)
      .eq("session_id", input.sessionId),
  ]);

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
        .eq("organization_id", input.organizationId)
        .eq("run_id", latestRun.id)
        .order("position", { ascending: true }),
      caller.client
        .from("comms_review_obligations")
        .select("*")
        .eq("organization_id", input.organizationId)
        .eq("run_id", latestRun.id),
    ]);
    findings = ((findingRes.data ?? []) as Row[]).map(toFinding);
    verdicts = ((obligationRes.data ?? []) as Row[]).map(toObligation);
  }

  const sources = sourceRows.map((row) => ({
    id: str(row["id"]),
    label: str(row["label"]),
    status: str(row["status"]),
    statusNote: str(row["status_note"]),
    charCount: num(row["char_count"]) ?? 0,
  }));
  const coverage = summarizeObligations(verdicts);

  return {
    session,
    versions,
    currentVersion,
    sources,
    latestRun,
    findings,
    obligations: coverage,
    approval: readApproval({
      approvals: ((approvalRes.data ?? []) as Row[]).map(toApproval),
      currentVersionId: currentVersion?.id ?? "",
      currentFingerprint: fingerprint,
      currentRevision: session.contextRevision,
    }),
    readiness: approvalReadiness({
      run: latestRun,
      currentVersionId: currentVersion?.id ?? "",
      currentFingerprint: fingerprint,
      currentRevision: session.contextRevision,
      findings,
      sources,
      coverage,
    }),
    fingerprint,
    runIsCurrent: reviewRunIsCurrent({
      run: latestRun,
      currentVersionId: currentVersion?.id ?? "",
      currentFingerprint: fingerprint,
      currentRevision: session.contextRevision,
    }),
    coverageNote: sourceCoverageNote(
      sourceRows.map((row) => ({
        status: str(row["status"]) as ClassifiedSource["status"],
      })) as ClassifiedSource[],
    ),
    approvalScopeNote: APPROVAL_SCOPE_NOTE,
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
