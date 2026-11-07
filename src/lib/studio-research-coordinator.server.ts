import { cliAccountingSchema, type CliAccounting } from "./studio-research-coordinator-contracts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  COORDINATOR,
  LINUX_PREVIEW_POLICY,
  LINUX_PREVIEW_POLICY_SHA256,
  checkApproval,
  coordinatorPrompt,
  digest,
  profileSchema,
  validateBrief,
  type Approval,
  type ExecutionProfile,
} from "./studio-research-coordinator-contracts";
import { CoordinatorStore, type Job } from "./studio-research-coordinator-store.server";
import { readCapturedText, receiptSchema } from "./studio-research-output.server";
import { validateSourceReceipt } from "./studio-research-manual-test.server";
import { SOURCE_LIMITS, type SourceEvidence } from "./studio-research-source-evidence.server";
export type Action = "approve" | "run" | "read" | "cancel" | "review";
/** Produced only by a trusted Studio session/approval adapter, never plugin actor fields or request JSON. */
export type Authority = {
  subjectId: string;
  organizationId: string;
  requestId: string;
  approvalDigest: string;
  expiresAt: number;
  actions: Action[];
};
export type ExecutionInput = {
  profile: ExecutionProfile;
  prompt: string;
  requestId: string;
  issueId: string;
  runId: string;
  sessionId: string;
  nonce: string;
  launchDeadline: number;
  completionDeadline: number;
  signal: AbortSignal;
};
export type Capture = {
  stdout: string;
  receipt: unknown;
  nonce: string;
  providerRequests: null;
  accounting: CliAccounting;
};
export type ExecutionHandle = { completion: Promise<Capture>; stop(): Promise<boolean> };
export type CoordinatorDeps = {
  store: CoordinatorStore;
  now(): number;
  authority(context: unknown, action: Action, approval: Approval): Promise<Authority | null>;
  reader(urls: readonly string[], approved: readonly string[]): Promise<SourceEvidence[]>;
  /** Trusted existing-record admission acknowledgement; no execution on ambiguous write. */
  admit?(job: Job): Promise<void>;
  executor?: {
    profile(): Promise<unknown>;
    start(input: ExecutionInput): Promise<ExecutionHandle>;
  };
};
const reviewSchema = z
  .object({
    decision: z.enum(["use", "edit", "save", "skip"]),
    editedText: z.string().min(1).max(5000).optional(),
  })
  .strict()
  .refine((v) => (v.decision === "edit") === Boolean(v.editedText), "edit_requires_text");
export function createCoordinator(d: CoordinatorDeps) {
  const active = new Map<string, { handle: ExecutionHandle; cancel(): void }>();
  async function authorize(context: unknown, action: Action, a: Approval) {
    const candidate = await d.authority(context, action, structuredClone(a));
    const parsed = z
      .object({
        subjectId: z.string().uuid(),
        organizationId: z.string().uuid(),
        requestId: z.string().uuid(),
        approvalDigest: z.string().regex(/^[a-f0-9]{64}$/),
        expiresAt: z.number().finite(),
        actions: z.array(z.enum(["approve", "run", "read", "cancel", "review"])),
      })
      .strict()
      .safeParse(candidate);
    const p = parsed.success ? parsed.data : null;
    if (
      !p ||
      p.subjectId !== a.approvedBy ||
      p.organizationId !== a.request.organizationId ||
      p.requestId !== a.request.requestId ||
      p.approvalDigest !== digest(a) ||
      p.expiresAt <= d.now() ||
      !p.actions.includes(action)
    )
      throw Error("not_authorized");
    return p;
  }
  async function owned(context: unknown, action: Action, id: string) {
    z.string().uuid().parse(id);
    const job = d.store.read(id);
    if (!job) throw Error("not_found");
    await authorize(context, action, job.approval);
    return job;
  }
  function state(id: string) {
    const j = d.store.read(id)!;
    return {
      requestId: id,
      state: j.state,
      revision: j.revision,
      result: j.data.result ?? null,
      review: j.data.review ?? null,
    };
  }
  function terminalFailure(id: string, reason: string) {
    const j = d.store.read(id)!;
    if (j.state === "collecting") d.store.transition(j, "failed", { reason });
    else if (j.state === "running") d.store.transition(j, "uncertain", { reason });
  }
  async function cancel(context: unknown, id: string) {
    const authorized = await owned(context, "cancel", id);
    let pending: Job | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const j = d.store.read(id);
      if (!j || j.approvalDigest !== authorized.approvalDigest) throw Error("not_authorized");
      if (j.state === "cancel_requested") {
        pending = j;
        break;
      }
      if (j.state === "approved") {
        if (d.store.transition(j, "cancelled", { reason: "cancelled_before_claim" }))
          return state(id);
      } else if (j.state === "collecting" || j.state === "running") {
        pending = d.store.transition(j, "cancel_requested", {});
        if (pending) break;
      } else return state(id);
    }
    if (!pending) throw Error("cancellation_conflict");
    const execution = active.get(id);
    if (execution) {
      execution.cancel();
      const stopped = await bounded(execution.handle.stop(), 5000).catch(() => false);
      const latest = d.store.read(id)!;
      if (latest.state === "cancel_requested")
        d.store.transition(latest, stopped ? "cancelled" : "uncertain", {
          reason: stopped ? "stop_acknowledged" : "stop_unconfirmed",
        });
    }
    return state(id);
  }
  async function run(context: unknown, id: string) {
    const initial = await owned(context, "run", id);
    if (initial.state !== "approved") return state(id);
    checkApproval(initial.approval, d.now());
    if (!d.executor) throw Error("execution_unavailable");
    const profile = profileSchema.parse(await d.executor.profile());
    checkApproval(initial.approval, d.now());
    await authorize(context, "run", initial.approval);
    checkApproval(initial.approval, d.now());
    const claimed = d.store.transition(initial, "collecting", {});
    if (!claimed) return state(id);
    let handle: ExecutionHandle | undefined;
    let cancellationPoll: ReturnType<typeof setInterval> | undefined;
    const abort = new AbortController();
    try {
      const evidence = await bounded(
        d.reader(claimed.approval.approvedUrls, claimed.approval.approvedUrls),
        SOURCE_LIMITS.timeoutMs,
      );
      validateSourceReceipt(claimed.approval, evidence);
      const current = d.store.read(id)!;
      if (current.state === "cancel_requested") {
        d.store.transition(current, "cancelled", { reason: "cancelled_before_execution" });
        return state(id);
      }
      if (current.state !== "collecting") return state(id);
      checkApproval(current.approval, d.now());
      const launchAuthority = await authorize(context, "run", current.approval);
      checkApproval(current.approval, d.now());
      const runId = randomUUID(),
        sessionId = `ses_${randomUUID()}`,
        nonce = randomUUID();
      const prompt = coordinatorPrompt(current.approval, evidence);
      const startedAt = d.now(),
        launchDeadline = Math.min(
          current.approval.expiresAt,
          launchAuthority.expiresAt,
          startedAt + 5000,
        ),
        completionDeadline = startedAt + COORDINATOR.timeoutMs;
      const running = d.store.transition(current, "running", {
        evidence,
        runId,
        sessionId,
        promptDigest: digest(prompt),
        evidenceDigest: digest(evidence),
        launch: { nonce, profile, startedAt, launchDeadline, completionDeadline },
      });
      if (!running) return state(id);
      // Durable cancellation is observed by the owning process even when requested elsewhere.
      cancellationPoll = setInterval(() => {
        try {
          if (d.store.read(id)?.state !== "running") abort.abort();
        } catch {
          abort.abort();
        }
      }, 25);
      // Durable running receipt precedes the only allowed start. No automatic retry.
      if (d.admit)
        await bounded(d.admit(structuredClone(running)), Math.max(1, launchDeadline - d.now()));
      if (d.store.read(id)?.state !== "running") throw Error("admission_cancelled");
      checkApproval(running.approval, d.now());
      if (d.now() >= launchDeadline) throw Error("launch_expired");
      const launch = d.executor.start({
        profile,
        prompt,
        requestId: id,
        issueId: running.approval.issueId,
        runId,
        sessionId,
        nonce,
        launchDeadline,
        completionDeadline,
        signal: abort.signal,
      });
      // If launch resolves after timeout, stop it; never accept its output or launch again.
      let abandoned = false;
      launch
        .then(async (late) => {
          if (abandoned) {
            late.completion.catch(() => undefined);
            await late.stop().catch(() => false);
          }
        })
        .catch(() => undefined);
      try {
        handle = await bounded(launch, Math.max(1, launchDeadline - d.now()));
      } catch (e) {
        abandoned = true;
        abort.abort();
        throw e;
      }
      const acquired = handle;
      let stopOnce: Promise<boolean> | undefined;
      handle = { completion: acquired.completion, stop: () => (stopOnce ??= acquired.stop()) };
      handle.completion.catch(() => undefined);
      if (d.now() >= launchDeadline) {
        abort.abort();
        await bounded(handle.stop(), 5000).catch(() => false);
        throw Error("launch_expired");
      }
      let interrupt!: () => void;
      const cancelled = new Promise<never>((_, reject) => {
        interrupt = () => reject(Error("cancel_requested"));
      });
      cancelled.catch(() => undefined);
      active.set(id, { handle, cancel: interrupt });
      abort.signal.addEventListener("abort", interrupt, { once: true });
      if (abort.signal.aborted) interrupt();
      if (d.store.read(id)!.state !== "running") {
        const stopped = await bounded(handle.stop(), 5000).catch(() => false);
        const pending = d.store.read(id)!;
        if (pending.state === "cancel_requested")
          d.store.transition(pending, stopped ? "cancelled" : "uncertain", {
            reason: stopped ? "stop_acknowledged" : "stop_unconfirmed",
          });
        return state(id);
      }
      let capture: Capture;
      try {
        capture = await bounded(
          Promise.race([handle.completion, cancelled]),
          Math.max(1, completionDeadline - d.now()),
        );
      } catch {
        const stopped = await bounded(handle.stop(), 5000).catch(() => false);
        const pending = d.store.read(id);
        if (pending?.state === "cancel_requested")
          d.store.transition(pending, stopped ? "cancelled" : "uncertain", {
            reason: stopped ? "stop_acknowledged" : "stop_unconfirmed",
          });
        throw Error("execution_failed");
      }
      if (d.now() >= completionDeadline) throw Error("completion_expired");
      if (capture.nonce !== nonce || capture.providerRequests !== null)
        throw Error("capture_mismatch");
      const accounting = cliAccountingSchema.parse(capture.accounting);
      const receipt = receiptSchema.parse(capture.receipt);
      if (running.approval.executionPolicySha256 === LINUX_PREVIEW_POLICY_SHA256) {
        const bindingDigest = digest({ requestId: id, issueId: running.approval.issueId, runId, coordinatorSessionId: sessionId, nonce, promptDigest: digest(prompt), profileDigest: digest(profile), executableSha256: LINUX_PREVIEW_POLICY.executableSha256, packageVersion: "1.18.18" });
        if (!receipt.nativeSession || receipt.nativeSession.bindingDigest !== bindingDigest) throw Error("native_session_binding_invalid");
      } else if (receipt.nativeSession) throw Error("native_session_policy_mismatch");
      const body = readCapturedText({
        ticket: running.approval,
        evidence,
        expected: { issueId: running.approval.issueId, runId, sessionId },
        receipt: capture.receipt,
        stdout: capture.stdout,
      });
      const result = validateBrief(body, running.approval, evidence);
      const latest = d.store.read(id)!;
      if (latest.state === "running")
        d.store.transition(latest, "ready", {
          result,
          resultDigest: digest(result),
          completion: {
            receipt: receiptSchema.parse(capture.receipt),
            outputDigest: digest(capture.stdout),
            providerRequests: capture.providerRequests,
            accounting,
            completedAt: d.now(),
          },
        });
      else if (latest.state === "cancel_requested")
        d.store.transition(latest, "cancelled", { reason: "completed_after_cancellation" });
      // A late result never wins over cancellation or recovery.
    } catch {
      const current = d.store.read(id);
      if (current?.state === "cancel_requested" && !current.data.runId)
        d.store.transition(current, "cancelled", { reason: "cancelled_before_execution" });
      else if (current?.state === "cancel_requested")
        d.store.transition(current, "uncertain", {
          reason: "cancelled_launch_outcome_unconfirmed",
        });
      else terminalFailure(id, "job_failed_requires_review");
    } finally {
      clearInterval(cancellationPoll);
      active.delete(id);
    }
    return state(id);
  }
  return {
    /** Internal approval-import method, deliberately not exposed as a plugin API route. */
    async approve(context: unknown, raw: unknown) {
      const a = checkApproval(raw, d.now());
      await authorize(context, "approve", a);
      checkApproval(a, d.now());
      return d.store.create(a);
    },
    run,
    cancel,
    async read(context: unknown, id: string) {
      await owned(context, "read", id);
      return state(id);
    },
    async review(context: unknown, id: string, raw: unknown) {
      const input = reviewSchema.parse(raw);
      const job = await owned(context, "review", id);
      if (job.state !== "ready") throw Error("review_not_ready");
      const by = job.approval.approvedBy;
      d.store.transition(job, "reviewed", {
        review: {
          decision: input.decision,
          ...(input.editedText ? { editedText: input.editedText } : {}),
          by,
          at: d.now(),
        },
      });
      return state(id);
    },
  };
}
async function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error("deadline")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
