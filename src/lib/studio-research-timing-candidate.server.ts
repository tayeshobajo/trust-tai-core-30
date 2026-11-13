/** Versioned timing engine, selected only through explicit pinned v2/v4 source adapters.
 * Deployment and a separately provisioned immutable approval are required before use.
 */
import { sign, type KeyObject } from "node:crypto";
import { z } from "zod";
import { digest, LINUX_PREVIEW_POLICY } from "./studio-research-coordinator-contracts";
export const TIMING_POLICY = Object.freeze({
  version: 2,
  totalMs: 60000,
  preflightMs: 20000,
  launchMs: 5000,
  providerMs: 60000,
  cleanupMs: 5000,
  settlementReserveMs: 5000,
  retries: 0,
});
export const TIMING_POLICY_DIGEST = digest({ ...LINUX_PREVIEW_POLICY, timing: TIMING_POLICY });
export const timingBindingSchema = z
  .object({
    attemptId: z.string().uuid(),
    priorRunId: z.string().uuid(),
    subjectId: z.string().uuid(),
    organizationId: z.string().uuid(),
    companyId: z.string().uuid(),
    projectId: z.string().uuid(),
    agentId: z.string().uuid(),
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    requestId: z.string().uuid(),
    issueId: z.string().uuid(),
    runId: z.string().uuid(),
    approvalDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type TimingBinding = z.infer<typeof timingBindingSchema>;
type Phase = "prepare" | "admission" | "final_authority" | "launch" | "provider" | "cleanup";
type Code =
  "deadline" | "cancelled" | "authority_rejected" | "phase_failed" | "evidence_unavailable";
export type StopEvidence = "not_attempted" | "immediate_child_closed" | "unverified";
export type TimingEvent = {
  phase: Phase;
  event: "begin" | "complete" | "spawn_intent" | "spawn_observed" | "failed" | "stop_observed";
  at: number;
  totalDeadline: number;
  phaseDeadline: number;
  code?: Code;
  stopEvidence?: StopEvidence;
  providerRequests: null;
};
export const timingEventSchema = z
  .object({
    phase: z.enum(["prepare", "admission", "final_authority", "launch", "provider", "cleanup"]),
    event: z.enum([
      "begin",
      "complete",
      "spawn_intent",
      "spawn_observed",
      "failed",
      "stop_observed",
    ]),
    at: z.number().int().nonnegative(),
    totalDeadline: z.number().int().nonnegative(),
    phaseDeadline: z.number().int().nonnegative(),
    code: z
      .enum(["deadline", "cancelled", "authority_rejected", "phase_failed", "evidence_unavailable"])
      .optional(),
    stopEvidence: z.enum(["not_attempted", "immediate_child_closed", "unverified"]).optional(),
    providerRequests: z.null(),
  })
  .strict();
export class TimingFailure extends Error {
  constructor(
    readonly phase: Phase,
    readonly code: Code,
    readonly spawnAttempted: boolean,
    readonly stopEvidence: StopEvidence,
    readonly evidenceRecorded: boolean,
  ) {
    super("execution_timing_failed");
  }
}
class GateFailure extends Error {
  constructor(readonly code: Code) {
    super(code);
  }
}
/** Append must synchronously persist the signed receipt or throw. Never log raw errors or hook values. */
export function createTimingRecorder(
  key: KeyObject,
  raw: TimingBinding,
  append: (token: string) => void,
) {
  const binding = timingBindingSchema.parse(raw);
  if (key.type !== "private" || key.asymmetricKeyType !== "ed25519")
    throw Error("timing_signer_invalid");
  let sequence = 0,
    previousDigest: string | null = null,
    lastAt = -1;
  return (rawEvent: TimingEvent) => {
    const event = timingEventSchema.parse(rawEvent);
    if (event.at < lastAt || event.phaseDeadline > event.totalDeadline)
      throw Error("timing_evidence_invalid");
    const payload = {
      domain: "studio-execution-phase/v2",
      binding,
      policyDigest: TIMING_POLICY_DIGEST,
      sequence,
      previousDigest,
      ...event,
    };
    const bytes = Buffer.from(JSON.stringify(payload));
    const token = bytes.toString("base64url") + "." + sign(null, bytes, key).toString("base64url");
    append(token);
    previousDigest = digest(token);
    sequence++;
    lastAt = event.at;
  };
}
type SpawnHandle<T> = {
  started: Promise<void>;
  completion: Promise<{ value: T; immediateChildClosed: true }>;
  stop(): Promise<{ immediateChildClosed: boolean }>;
};
export type TimingDependencies<P, T> = {
  now(): number;
  /** Durable compare-and-swap, keyed by approved attempt identity. Never reset on failure. */
  claim(binding: TimingBinding): void;
  record(event: TimingEvent): void;
  /** Collect sources, inspect policy/executable, resolve credentials and prepare private files. No spawn/provider call. */
  prepare(signal: AbortSignal): Promise<P>;
  dispose(prepared: P): void;
  /** Persist and verify the versioned admission receipt. No provider call. */
  admit(
    prepared: P,
    signal: AbortSignal,
    deadlines: { preflightDeadline: number; totalDeadline: number },
  ): Promise<void>;
  /** Query current remote authority and host key/membership/paused-target status; no cached grants. */
  authorize(
    prepared: P,
    signal: AbortSignal,
  ): Promise<{ approvalDigest: string; checkedAt: number; expiresAt: number }>;
  /** Synchronous exact-process spawn; recheck local executable and signal. No asynchronous authorization hidden here. */
  spawn(
    prepared: P,
    signal: AbortSignal,
    deadlines: { launchDeadline: number; providerDeadline: number },
  ): SpawnHandle<T>;
};
/** Uses one total budget. Preflight never consumes the separate five-second spawn acknowledgement budget.
 * It does consume total time, so no check, cancellation or delay extends provider/settlement authority.
 */
export function createTimedExecutionCandidate<P, T>(d: TimingDependencies<P, T>) {
  let consumed = false;
  return async (
    input: TimingBinding & {
      policyDigest: string;
      approvalExpiresAt: number;
      invocationDeadline: number;
      signal: AbortSignal;
    },
  ) => {
    const binding = timingBindingSchema.parse({
      attemptId: input.attemptId,
      priorRunId: input.priorRunId,
      subjectId: input.subjectId,
      organizationId: input.organizationId,
      companyId: input.companyId,
      projectId: input.projectId,
      agentId: input.agentId,
      sourceDigest: input.sourceDigest,
      requestId: input.requestId,
      issueId: input.issueId,
      runId: input.runId,
      approvalDigest: input.approvalDigest,
    });
    if (input.policyDigest !== TIMING_POLICY_DIGEST) throw Error("timing_policy_not_approved");
    const started = d.now();
    for (const n of [started, input.approvalExpiresAt, input.invocationDeadline])
      if (!Number.isSafeInteger(n) || n < 0) throw Error("timing_invalid");
    const totalDeadline = Math.min(
      started + TIMING_POLICY.totalMs,
      input.approvalExpiresAt,
      input.invocationDeadline - TIMING_POLICY.settlementReserveMs,
    );
    const preflightDeadline = Math.min(started + TIMING_POLICY.preflightMs, totalDeadline);
    if (consumed) throw Error("attempt_consumed");
    if (input.signal.aborted || started >= preflightDeadline) throw Error("attempt_not_current");
    // Local flag and durable claim both precede all external side effects. A failed/ambiguous claim remains consumed.
    consumed = true;
    try {
      d.claim(binding);
    } catch {
      throw Error("attempt_claim_unconfirmed");
    }
    const abort = new AbortController();
    const cancel = () => abort.abort(new GateFailure("cancelled"));
    const totalTimer = setTimeout(
      () => abort.abort(new GateFailure("deadline")),
      totalDeadline - started,
    );
    input.signal.addEventListener("abort", cancel, { once: true });
    if (input.signal.aborted) abort.abort();
    let phase: Phase = "prepare",
      phaseDeadline = preflightDeadline,
      prepared: P | undefined,
      hasPrepared = false,
      handle: SpawnHandle<T> | undefined,
      spawnAttempted = false;
    let stopEvidence: StopEvidence = "not_attempted",
      evidenceRecorded = true;
    const check = (deadline: number) => {
      if (abort.signal.aborted)
        throw abort.signal.reason instanceof GateFailure
          ? abort.signal.reason
          : new GateFailure("cancelled");
      if (d.now() >= deadline || d.now() >= totalDeadline) throw new GateFailure("deadline");
    };
    const record = (event: TimingEvent["event"], code?: Code) => {
      try {
        d.record({
          phase,
          event,
          at: d.now(),
          totalDeadline,
          phaseDeadline,
          providerRequests: null,
          ...(code ? { code } : {}),
          ...(event === "stop_observed" ? { stopEvidence } : {}),
        });
      } catch {
        evidenceRecorded = false;
        throw new GateFailure("evidence_unavailable");
      }
    };
    async function bounded<R>(promise: Promise<R>, deadline: number): Promise<R> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: () => void = () => {};
      const gate = new Promise<never>((_, reject) => {
        onAbort = () =>
          reject(
            abort.signal.reason instanceof GateFailure
              ? abort.signal.reason
              : new GateFailure("cancelled"),
          );
        abort.signal.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(
          () => reject(new GateFailure("deadline")),
          Math.max(0, Math.min(deadline, totalDeadline) - d.now()),
        );
        if (abort.signal.aborted) onAbort();
      });
      try {
        const value = await Promise.race([promise, gate]);
        check(deadline);
        return value;
      } finally {
        clearTimeout(timer);
        abort.signal.removeEventListener("abort", onAbort);
      }
    }
    let latePrepare = false,
      prepareResolved = false,
      prepareValue: P | undefined;
    const dispose = (value: P) => {
      hasPrepared = false;
      d.dispose(value);
    };
    try {
      record("begin");
      check(preflightDeadline);
      const pending = d.prepare(abort.signal);
      pending.then(
        (p) => {
          prepareResolved = true;
          prepareValue = p;
          if (latePrepare) {
            try {
              dispose(p);
            } catch {
              try {
                phase = "cleanup";
                record("failed", "phase_failed");
              } catch {}
            }
          }
        },
        () => {},
      );
      try {
        prepared = await bounded(pending, preflightDeadline);
        hasPrepared = true;
      } catch (e) {
        latePrepare = true;
        if (prepareResolved) {
          dispose(prepareValue as P);
        }
        throw e;
      }
      record("complete");
      phase = "admission";
      record("begin");
      check(preflightDeadline);
      await bounded(
        d.admit(prepared, abort.signal, { preflightDeadline, totalDeadline }),
        preflightDeadline,
      );
      record("complete");
      phase = "final_authority";
      record("begin");
      check(preflightDeadline);
      const authorityStarted = d.now();
      const authority = await bounded(d.authorize(prepared, abort.signal), preflightDeadline);
      if (
        authority.approvalDigest !== binding.approvalDigest ||
        !Number.isSafeInteger(authority.checkedAt) ||
        !Number.isSafeInteger(authority.expiresAt) ||
        authority.checkedAt < authorityStarted ||
        authority.checkedAt > d.now() ||
        authority.expiresAt <= d.now()
      )
        throw new GateFailure("authority_rejected");
      record("complete");
      phase = "launch";
      phaseDeadline = Math.min(
        d.now() + TIMING_POLICY.launchMs,
        totalDeadline,
        authority.expiresAt,
      );
      const providerDeadline = Math.min(
        d.now() + TIMING_POLICY.providerMs,
        totalDeadline,
        authority.expiresAt,
      );
      record("spawn_intent");
      check(phaseDeadline);
      // No await between the fresh authority check, deadline checks and this exact spawn.
      spawnAttempted = true;
      handle = d.spawn(prepared, abort.signal, { launchDeadline: phaseDeadline, providerDeadline });
      // Attach rejection handling immediately: completion may reject while spawn acknowledgement is pending.
      void handle.completion.catch(() => {});
      await bounded(handle.started, phaseDeadline);
      record("spawn_observed");
      phase = "provider";
      phaseDeadline = providerDeadline;
      record("begin");
      const result = await bounded(handle.completion, providerDeadline);
      if (result.immediateChildClosed !== true) throw new GateFailure("phase_failed");
      stopEvidence = "immediate_child_closed";
      record("complete");
      phase = "cleanup";
      record("begin");
      dispose(prepared);
      check(phaseDeadline);
      record("complete");
      check(phaseDeadline);
      return { value: result.value, providerRequests: null as null, stopEvidence };
    } catch (error) {
      const code = error instanceof GateFailure ? error.code : "phase_failed";
      abort.abort();
      if (spawnAttempted && stopEvidence !== "immediate_child_closed") stopEvidence = "unverified";
      if (handle) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const stopped = await Promise.race([
            handle.stop(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(Error()),
                Math.max(0, Math.min(TIMING_POLICY.cleanupMs, input.invocationDeadline - d.now())),
              );
            }),
          ]);
          if (stopped.immediateChildClosed) stopEvidence = "immediate_child_closed";
        } catch {
        } finally {
          clearTimeout(timer);
        }
      }
      try {
        record("failed", code);
        if (spawnAttempted) record("stop_observed");
      } catch {}
      if (hasPrepared && (!spawnAttempted || stopEvidence === "immediate_child_closed")) {
        try {
          dispose(prepared as P);
        } catch {
          try {
            record("failed", "phase_failed");
          } catch {}
        }
      }
      throw new TimingFailure(phase, code, spawnAttempted, stopEvidence, evidenceRecorded);
    } finally {
      clearTimeout(totalTimer);
      input.signal.removeEventListener("abort", cancel);
    }
  };
}
