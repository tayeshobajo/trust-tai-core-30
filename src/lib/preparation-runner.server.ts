/**
 * The one runner for repeatable preparation (server only).
 *
 * It does not reason and it does not own state. It sequences the rules the
 * contract in `@/domain/preparation-jobs` already defines: access, claim,
 * policy, deterministic figures first, model synthesis second, honest status
 * last. Synthesis goes through the single reasoning boundary; nothing here
 * touches a provider directly.
 *
 * The order matters, and it is deliberate:
 *
 *  1. access is proved before anything is read, returned or written, so an
 *     outsider cannot see a cached answer and cannot leave a mark on someone
 *     else's run,
 *  2. the record is claimed atomically for one attempt, with a bounded lease,
 *     so two copies of the same event call the model at most once and a
 *     crashed worker leaves something recoverable rather than a row that says
 *     "Preparing" for ever,
 *  3. limits are checked before the claim and again after it, so two different
 *     jobs starting together cannot take the workspace past its daily limit,
 *  4. access, policy and the subject's revision are read again at the finish,
 *     so work prepared from something that has since moved, or in a workspace
 *     that has since switched off, never becomes current prepared work,
 *  5. a record that could not be written is never called persisted.
 */

import {
  claimDecision,
  leaseUntil as leaseUntilIso,
  PREPARATION_LEASE_MS,
} from "@/domain/preparation-claim";
import {
  boundedInstructions,
  configGaps,
  jobSpec,
  materialBlock,
  mayRun,
  preparationKey,
  retryDecision,
  type ModelUse,
  type PreparationJobSpec,
  type PreparationOutput,
  type PreparationPolicy,
  type PreparationRequest,
  type PreparationStatus,
} from "@/domain/preparation-jobs";
import {
  ProviderCallFailedError,
  ProviderNotConfiguredError,
  requireRuntimeAccess,
  runtimeModelCaller,
  type RuntimeModelCaller,
} from "@/lib/intelligence-runtime.server";

/** Raised instead of writing anything when the caller has no business here. */
export class PreparationAccessDenied extends Error {
  constructor(message = "You do not have access to this workspace.") {
    super(message);
    this.name = "PreparationAccessDenied";
  }
}

export interface ClaimInput {
  key: string;
  request: PreparationRequest;
  attemptId: string;
  nowIso: string;
  leaseUntil: string;
  maxAttempts: number;
  ownerLabel: string;
}

export interface ClaimResult {
  claimed: boolean;
  /** The record as it stands, claimed or not. Null only when nothing exists. */
  output: PreparationOutput | null;
  because: string;
}

/** One record kind. The owning room keeps its own truth elsewhere. */
export interface PreparationStore {
  /** Always scoped to the request's workspace by the implementation. */
  load(key: string, organizationId: string): Promise<PreparationOutput | null>;
  /**
   * Take the next attempt, atomically. An implementation that cannot do this
   * in one step is not a valid store: two events arriving together must not
   * both be told they claimed it.
   */
  claim(input: ClaimInput): Promise<ClaimResult>;
  /** Write the finished record for a claim this attempt still holds. */
  complete(output: PreparationOutput, attemptId: string): Promise<PreparationOutput>;
  /** Runs recorded today, for the limits. */
  countToday(organizationId: string, jobId?: string): Promise<number>;
}

/** What the room computes in code before a model is involved at all. */
export interface DeterministicRead {
  /** Arithmetic and counts. Never produced by a model. */
  figures: Record<string, number>;
  evidenceRefs: string[];
  ownerLabel: string;
  /** The verified membership behind that label, when the room knows it. */
  ownerMembershipId?: string;
  /** The material the model may see, each piece by reference. */
  material: { ref: string; text: string }[];
  /** Set when code alone already knows a person must decide something. */
  needsDecisionBecause?: string;
  /** Set when code alone knows there is not enough to prepare from. */
  cannotPrepareBecause?: string;
}

export interface PreparationRunInput {
  request: PreparationRequest;
  policy: PreparationPolicy;
  store: PreparationStore;
  /** Bearer token of the person or worker on whose authority this runs. */
  token: string;
  /** The current revision of the subject, read at execution time. */
  currentInputRevision: string;
  deterministic: () => Promise<DeterministicRead> | DeterministicRead;
  now?: () => Date;
  signal?: AbortSignal;
  /** Override the spec timeout. Used by the synthetic sandbox only. */
  timeoutMs?: number;
  /** Override the claim lease. Used by tests only. */
  leaseMs?: number;
  /** Injected in the synthetic sandbox; production resolves the real boundary. */
  verifyAccess?: (token: string, organizationId: string) => Promise<boolean>;
  /** Proves the subject belongs to this workspace. Refusal is fatal, silently safe. */
  verifySubject?: (request: PreparationRequest) => Promise<boolean>;
  callModel?: RuntimeModelCaller;
  /** Read again at the finish. Absent means the policy passed in still holds. */
  reloadPolicy?: () => Promise<PreparationPolicy>;
  /** Read again at the finish. Absent means the revision passed in still holds. */
  reloadRevision?: () => Promise<string>;
  /** Usage/cost when the caller can report it. Absent stays absent. */
  usage?: () => Partial<Pick<ModelUse, "inputTokens" | "outputTokens" | "costCredits">>;
}

function iso(now: () => Date): string {
  return now().toISOString();
}

/** A record the person is shown but nobody claimed, so nobody wrote it down. */
function transient(input: {
  key: string;
  request: PreparationRequest;
  spec: PreparationJobSpec;
  status: PreparationStatus;
  because: string;
  existing: PreparationOutput | null;
  now: () => Date;
}): PreparationOutput {
  const base: PreparationOutput = input.existing ?? {
    key: input.key,
    request: input.request,
    status: "queued",
    summary: "",
    suggestions: [],
    evidenceRefs: [],
    figures: {},
    ownerLabel: input.spec.decisionOwner,
    attempts: 0,
  };
  return {
    ...base,
    status: input.status,
    because: input.because,
    persisted: false,
    finishedAt: iso(input.now),
  };
}

/** Parse the model's plain answer. Malformed output never becomes a result. */
function readSynthesis(raw: string): { summary: string; suggestions: string[] } | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as { summary?: unknown; suggestions?: unknown };
    const summary = typeof record.summary === "string" ? record.summary.trim() : "";
    if (!summary) return null;
    const suggestions = Array.isArray(record.suggestions)
      ? record.suggestions.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0,
        )
      : [];
    return { summary, suggestions };
  } catch {
    return null;
  }
}

/** A stable fingerprint of the exact instructions, so wording drift is visible. */
async function instructionsHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Call the model with a timeout and an abort, and leave nothing running behind
 * on any outcome: the timer is cleared and the abort listener removed whether
 * the answer arrived, failed, timed out or was stopped.
 */
async function callWithDeadline(
  caller: RuntimeModelCaller,
  args: { instructions: string; input: string },
  timeoutMs: number,
  signal: AbortSignal | undefined,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      caller(args),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
        if (signal) {
          onAbort = () => reject(new Error("cancelled"));
          signal.addEventListener("abort", onAbort, { once: true });
        }
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Run one preparation job. Returns a record in every case, including refusal:
 * the person always gets a state and a reason, never silence. Only a record
 * carrying `persisted: true` was written down.
 */
export async function runPreparation(input: PreparationRunInput): Promise<PreparationOutput> {
  const now = input.now ?? (() => new Date());
  const spec = jobSpec(input.request.jobId);
  const key = preparationKey(input.request);
  const refuse = (
    status: PreparationStatus,
    because: string,
    existing: PreparationOutput | null,
  ) => transient({ key, request: input.request, spec, status, because, existing, now });

  /* 1. Access first. Nothing is read, returned or written before this, so an
        unauthorised attempt cannot see a cached answer and cannot mark another
        person's run with a refusal of its own. */
  const verify = input.verifyAccess ?? requireRuntimeAccess;
  if (!(await verify(input.token, input.request.organizationId))) {
    throw new PreparationAccessDenied();
  }
  if (input.verifySubject && !(await input.verifySubject(input.request))) {
    throw new PreparationAccessDenied("That subject does not belong to this workspace.");
  }

  const existing = await input.store.load(key, input.request.organizationId);

  // The revision that armed the trigger may already be out of date.
  if (input.request.inputRevision !== input.currentInputRevision) {
    return refuse(
      "could_not_finish",
      "The subject changed before this started. It will be prepared from the current version.",
      existing,
    );
  }

  const nowIso = iso(now);
  const decision = claimDecision({
    existing: existing
      ? {
          status: existing.status,
          attempts: existing.attempts,
          leaseUntil: existing.leaseUntil ?? null,
          attemptId: existing.attemptId ?? null,
          supersededBecause: existing.supersededBecause ?? null,
        }
      : null,
    nowIso,
    maxAttempts: spec.maxAttempts,
  });
  if (decision.act === "return_existing") {
    // The rule only says this when a record exists, but say so rather than assume.
    if (existing) return existing;
    return refuse("could_not_finish", "That record moved while it was being read.", null);
  }

  if (decision.act === "refuse") return refuse(decision.status, decision.because, existing);

  // 2. Limits before the claim.
  const [runsForJob, runsForWorkspace] = await Promise.all([
    input.store.countToday(input.request.organizationId, spec.id),
    input.store.countToday(input.request.organizationId),
  ]);
  const permission = mayRun({
    spec,
    policy: input.policy,
    runsTodayForJob: runsForJob,
    runsTodayForWorkspace: runsForWorkspace,
  });
  if (!permission.allowed) {
    const gaps = configGaps(spec, input.policy);
    return refuse(
      "could_not_finish",
      gaps.length > 0 ? `${permission.because} Missing: ${gaps.join(", ")}.` : permission.because,
      existing,
    );
  }

  if (input.signal?.aborted) {
    return refuse("cancelled", "Someone stopped this run.", existing);
  }

  // 3. One claim, one attempt identity, one bounded lease.
  const attemptId = crypto.randomUUID();
  const claim = await input.store.claim({
    key,
    request: input.request,
    attemptId,
    nowIso,
    leaseUntil: leaseUntilIso(nowIso, input.leaseMs ?? PREPARATION_LEASE_MS),
    maxAttempts: spec.maxAttempts,
    ownerLabel: spec.decisionOwner,
  });
  if (!claim.claimed) {
    if (
      claim.output &&
      (claim.output.status === "prepared" || claim.output.status === "needs_decision")
    ) {
      return claim.output;
    }
    return refuse("running", claim.because, claim.output);
  }
  const running: PreparationOutput = claim.output ?? {
    key,
    request: input.request,
    status: "running",
    summary: "",
    suggestions: [],
    evidenceRefs: [],
    figures: {},
    ownerLabel: spec.decisionOwner,
    attempts: decision.attempts,
    attemptId,
    startedAt: nowIso,
    persisted: true,
  };

  /* Write the finished record for the claim this attempt holds. A save that
     fails is reported as a save that failed, never as prepared work. */
  const settle = async (output: PreparationOutput): Promise<PreparationOutput> => {
    const finished: PreparationOutput = { ...output, finishedAt: iso(now), attemptId };
    try {
      return { ...(await input.store.complete(finished, attemptId)), persisted: true };
    } catch (error) {
      return {
        ...finished,
        persisted: false,
        because: `${finished.because ?? ""} This could not be saved, so it is not recorded: ${(error as Error).message}`.trim(),
      };
    }
  };

  // 4. Limits again, now that this attempt is counted. Concurrency cannot overrun.
  const [afterJob, afterWorkspace] = await Promise.all([
    input.store.countToday(input.request.organizationId, spec.id),
    input.store.countToday(input.request.organizationId),
  ]);
  if (
    afterWorkspace > input.policy.workspaceDailyLimit ||
    afterJob > input.policy.perJobDailyLimit
  ) {
    return settle({
      ...running,
      status: "could_not_finish",
      because: "This workspace reached its preparation limit while this was starting.",
    });
  }

  let read: DeterministicRead;
  try {
    read = await input.deterministic();
  } catch (error) {
    return settle({
      ...running,
      status: "could_not_finish",
      because: `We could not read what this needs: ${(error as Error).message}`,
    });
  }

  const withFigures: PreparationOutput = {
    ...running,
    figures: read.figures,
    evidenceRefs: read.evidenceRefs,
    ownerLabel: read.ownerLabel || spec.decisionOwner,
    ...(read.ownerMembershipId ? { ownerMembershipId: read.ownerMembershipId } : {}),
  };

  if (read.cannotPrepareBecause) {
    return settle({
      ...withFigures,
      status: "could_not_finish",
      because: read.cannotPrepareBecause,
    });
  }
  if (read.material.length === 0) {
    return settle({
      ...withFigures,
      status: "could_not_finish",
      because: "There is nothing recorded to prepare from.",
    });
  }

  let caller = input.callModel;
  if (!caller) {
    try {
      caller = await runtimeModelCaller({
        token: input.token,
        organizationId: input.request.organizationId,
        room: spec.owningApp as never,
        purpose: "research",
      });
    } catch {
      return settle({
        ...withFigures,
        status: "could_not_finish",
        because: "The reasoning service is not available.",
      });
    }
  }

  const instructions = boundedInstructions(spec);
  const material = materialBlock(read.material);

  let raw: string;
  let provider: string;
  let model: string;
  try {
    const answer = await callWithDeadline(
      caller,
      { instructions, input: material },
      input.timeoutMs ?? spec.timeoutMs,
      input.signal,
    );
    raw = answer.raw;
    provider = answer.provider;
    model = answer.model;
  } catch (error) {
    const message = (error as Error).message;
    if (message === "cancelled") {
      return settle({ ...withFigures, status: "cancelled", because: "Someone stopped this run." });
    }
    if (message === "timeout") {
      // We cannot tell whether the provider finished. Never retried by code.
      return settle({
        ...withFigures,
        status: "uncertain",
        because:
          "This took too long and we cannot tell whether it finished. Check before running it again.",
      });
    }
    if (error instanceof ProviderNotConfiguredError) {
      return settle({
        ...withFigures,
        status: "could_not_finish",
        because: "The reasoning service is not set up.",
      });
    }
    if (error instanceof ProviderCallFailedError) {
      return settle({
        ...withFigures,
        status: "could_not_finish",
        because: "The reasoning service did not answer.",
      });
    }
    return settle({
      ...withFigures,
      status: "could_not_finish",
      because: `It could not finish: ${message}`,
    });
  }

  const synthesis = readSynthesis(raw);
  const usage = input.usage?.() ?? {};
  const modelUse: ModelUse = {
    provider,
    model,
    instructionsRef: `preparation:${spec.id}`,
    instructionsHash: await instructionsHash(instructions),
    inputRevision: input.request.inputRevision,
    inputRefs: read.material.map((entry) => entry.ref),
    ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
    ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
    ...(usage.costCredits === undefined ? {} : { costCredits: usage.costCredits }),
  };

  if (!synthesis) {
    return settle({
      ...withFigures,
      modelUse,
      status: "could_not_finish",
      because: "The answer came back in a shape we could not read.",
    });
  }

  /* 5. The finish boundary. Access, policy and the subject are read again:
        what was true when this started may not be true now, and stale work
        must not become current prepared work. */
  if (!(await verify(input.token, input.request.organizationId))) {
    return settle({
      ...withFigures,
      modelUse,
      status: "could_not_finish",
      because: "Access to this workspace ended while this was being prepared.",
    });
  }
  const finalPolicy = input.reloadPolicy ? await input.reloadPolicy() : input.policy;
  if (finalPolicy.stopSwitch || !finalPolicy.enabledJobs.includes(spec.id)) {
    return settle({
      ...withFigures,
      modelUse,
      status: "cancelled",
      because: "Preparation was switched off while this was running.",
    });
  }
  const finalRevision = input.reloadRevision
    ? await input.reloadRevision()
    : input.currentInputRevision;
  if (finalRevision !== input.request.inputRevision) {
    return settle({
      ...withFigures,
      modelUse,
      status: "could_not_finish",
      because: "The subject changed while this was being prepared, so this was not kept.",
    });
  }

  const status: PreparationStatus = read.needsDecisionBecause ? "needs_decision" : "prepared";
  return settle({
    ...withFigures,
    modelUse,
    status,
    summary: synthesis.summary,
    suggestions: synthesis.suggestions,
    because:
      read.needsDecisionBecause ??
      "Prepared for you to check. Nothing has been sent, changed or agreed.",
  });
}

/** Operator recovery: decide whether a failed run may be tried again. */
export function recoveryDecision(
  output: PreparationOutput,
  policy: PreparationPolicy,
  transientFailure: boolean,
) {
  return retryDecision({
    spec: jobSpec(output.request.jobId),
    status: output.status,
    attempts: output.attempts,
    transient: transientFailure,
    stopSwitch: policy.stopSwitch,
  });
}
