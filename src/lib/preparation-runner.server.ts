/**
 * The one runner for repeatable preparation (server only).
 *
 * It does not reason and it does not own state. It sequences the rules the
 * contract in `@/domain/preparation-jobs` already defines: access, policy,
 * idempotency, deterministic figures first, model synthesis second, honest
 * status last. Synthesis goes through the single reasoning boundary; nothing
 * here touches a provider directly.
 *
 * It writes one kind of record, through an injected store, so the owning room
 * keeps its state and no parallel business-data store appears.
 */

import {
  boundedInstructions,
  configGaps,
  jobSpec,
  materialBlock,
  mayRun,
  outputIsCurrent,
  preparationKey,
  retryDecision,
  type ModelUse,
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

/** One record kind. The owning room keeps its own truth elsewhere. */
export interface PreparationStore {
  load(key: string): Promise<PreparationOutput | null>;
  save(output: PreparationOutput): Promise<PreparationOutput>;
  /** Runs recorded today, for the limits. */
  countToday(organizationId: string, jobId?: string): Promise<number>;
}

/** What the room computes in code before a model is involved at all. */
export interface DeterministicRead {
  /** Arithmetic and counts. Never produced by a model. */
  figures: Record<string, number>;
  evidenceRefs: string[];
  ownerLabel: string;
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
  /** Injected in the synthetic sandbox; production resolves the real boundary. */
  verifyAccess?: (token: string, organizationId: string) => Promise<boolean>;
  callModel?: RuntimeModelCaller;
  /** Usage/cost when the caller can report it. Absent stays absent. */
  usage?: () => Partial<Pick<ModelUse, "inputTokens" | "outputTokens" | "costCredits">>;
}

function iso(now: () => Date): string {
  return now().toISOString();
}

function finish(
  base: PreparationOutput,
  status: PreparationStatus,
  because: string,
  now: () => Date,
): PreparationOutput {
  return {
    ...base,
    status,
    because,
    finishedAt: iso(now),
    ...(status === "prepared" ? {} : { summary: base.summary }),
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
      ? record.suggestions.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    return { summary, suggestions };
  } catch {
    return null;
  }
}

/**
 * Run one preparation job. Returns the stored record in every case, including
 * refusal: the person always gets a state and a reason, never silence.
 */
export async function runPreparation(input: PreparationRunInput): Promise<PreparationOutput> {
  const now = input.now ?? (() => new Date());
  const spec = jobSpec(input.request.jobId);
  const key = preparationKey(input.request);

  const existing = await input.store.load(key);
  const base: PreparationOutput = existing ?? {
    key,
    request: input.request,
    status: "queued",
    summary: "",
    suggestions: [],
    evidenceRefs: [],
    figures: {},
    ownerLabel: spec.decisionOwner,
    attempts: 0,
  };

  // A duplicate event for a revision already prepared does the work zero times.
  if (existing && (existing.status === "prepared" || existing.status === "needs_decision")) {
    const current = outputIsCurrent(existing, input.currentInputRevision);
    if (current.current) return existing;
  }
  if (existing && existing.status === "running") {
    return existing;
  }
  if (existing && existing.status === "uncertain") {
    return existing;
  }

  // Access is checked here, at execution, not only when the trigger was armed.
  const verify = input.verifyAccess ?? requireRuntimeAccess;
  const allowed = await verify(input.token, input.request.organizationId);
  if (!allowed) {
    return input.store.save(
      finish(base, "could_not_finish", "You do not have access to this workspace.", now),
    );
  }

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
    return input.store.save(
      finish(
        base,
        "could_not_finish",
        gaps.length > 0 ? `${permission.because} Missing: ${gaps.join(", ")}.` : permission.because,
        now,
      ),
    );
  }

  // The revision that armed the trigger may already be out of date.
  if (input.request.inputRevision !== input.currentInputRevision) {
    return input.store.save(
      finish(
        base,
        "could_not_finish",
        "The subject changed before this started. It will be prepared from the current version.",
        now,
      ),
    );
  }

  if (input.signal?.aborted) {
    return input.store.save(finish(base, "cancelled", "Someone stopped this run.", now));
  }

  const running = await input.store.save({
    ...base,
    status: "running",
    attempts: base.attempts + 1,
    startedAt: iso(now),
    ownerLabel: spec.decisionOwner,
  });

  let read: DeterministicRead;
  try {
    read = await input.deterministic();
  } catch (error) {
    return input.store.save(
      finish(
        running,
        "could_not_finish",
        `We could not read what this needs: ${(error as Error).message}`,
        now,
      ),
    );
  }

  const withFigures: PreparationOutput = {
    ...running,
    figures: read.figures,
    evidenceRefs: read.evidenceRefs,
    ownerLabel: read.ownerLabel || spec.decisionOwner,
  };

  if (read.cannotPrepareBecause) {
    return input.store.save(
      finish(withFigures, "could_not_finish", read.cannotPrepareBecause, now),
    );
  }
  if (read.material.length === 0) {
    return input.store.save(
      finish(withFigures, "could_not_finish", "There is nothing recorded to prepare from.", now),
    );
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
      return input.store.save(
        finish(withFigures, "could_not_finish", "The reasoning service is not available.", now),
      );
    }
  }

  const instructions = boundedInstructions(spec);
  const material = materialBlock(read.material);

  let raw: string;
  let provider: string;
  let model: string;
  try {
    const answer = await Promise.race([
      caller({ instructions, input: material }),
      new Promise<never>((_resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("timeout")),
          input.timeoutMs ?? spec.timeoutMs,
        );
        input.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("cancelled"));
        });
      }),
    ]);
    raw = answer.raw;
    provider = answer.provider;
    model = answer.model;
  } catch (error) {
    const message = (error as Error).message;
    if (message === "cancelled") {
      return input.store.save(finish(withFigures, "cancelled", "Someone stopped this run.", now));
    }
    if (message === "timeout") {
      // We cannot tell whether the provider finished. Never retried by code.
      return input.store.save(
        finish(
          withFigures,
          "uncertain",
          "This took too long and we cannot tell whether it finished. Check before running it again.",
          now,
        ),
      );
    }
    if (error instanceof ProviderNotConfiguredError) {
      return input.store.save(
        finish(withFigures, "could_not_finish", "The reasoning service is not set up.", now),
      );
    }
    if (error instanceof ProviderCallFailedError) {
      return input.store.save(
        finish(withFigures, "could_not_finish", "The reasoning service did not answer.", now),
      );
    }
    return input.store.save(
      finish(withFigures, "could_not_finish", `It could not finish: ${message}`, now),
    );
  }

  const synthesis = readSynthesis(raw);
  const usage = input.usage?.() ?? {};
  const modelUse: ModelUse = {
    provider,
    model,
    instructionsRef: `preparation:${spec.id}`,
    inputRefs: read.material.map((entry) => entry.ref),
    ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
    ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
    ...(usage.costCredits === undefined ? {} : { costCredits: usage.costCredits }),
  };

  if (!synthesis) {
    return input.store.save(
      finish(
        { ...withFigures, modelUse },
        "could_not_finish",
        "The answer came back in a shape we could not read.",
        now,
      ),
    );
  }

  const status: PreparationStatus = read.needsDecisionBecause ? "needs_decision" : "prepared";
  return input.store.save({
    ...withFigures,
    modelUse,
    status,
    summary: synthesis.summary,
    suggestions: synthesis.suggestions,
    because:
      read.needsDecisionBecause ??
      "Prepared for you to check. Nothing has been sent, changed or agreed.",
    finishedAt: iso(now),
  });
}

/** Operator recovery: decide whether a failed run may be tried again. */
export function recoveryDecision(
  output: PreparationOutput,
  policy: PreparationPolicy,
  transient: boolean,
) {
  return retryDecision({
    spec: jobSpec(output.request.jobId),
    status: output.status,
    attempts: output.attempts,
    transient,
    stopSwitch: policy.stopSwitch,
  });
}
