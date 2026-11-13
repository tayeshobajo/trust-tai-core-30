/** v2 callback reducer. Persistence must atomically compare revision and append the signed packet. */
import { z } from "zod";
import { sign, type KeyObject } from "node:crypto";
import { digest, coordinatorPrompt, validateBrief } from "./studio-research-coordinator-contracts";
import { verifySignedJson } from "./studio-research-coordinator-authority.server";
import {
  assertAttemptCurrent,
  attemptBinding,
  verifyPhaseChain,
  type AttemptApproval,
} from "./studio-research-attempt-contracts.server";
import { timingBindingSchema } from "./studio-research-timing-candidate.server";
import { validateSourceReceipt } from "./studio-research-manual-test.server";
import { attemptViewSchema, type AttemptView } from "../domain/studio-attempt-wire";
const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const admissionV2Schema = z
  .object({
    evidence: z
      .array(
        z
          .object({
            url: z.string().url(),
            title: z.string().max(160),
            text: z.string().min(1).max(3000),
            sha256: sha,
            retrievedAt: z.string().datetime(),
            publishedAt: z.null(),
          })
          .strict(),
      )
      .length(1),
    promptDigest: sha,
    runtimeBindingDigest: sha,
    preflightDeadline: z.number().int(),
    totalDeadline: z.number().int(),
  })
  .strict();
export type AdmissionV2 = z.infer<typeof admissionV2Schema>;
export const packetV2Schema = z
  .object({
    domain: z.literal("studio-attempt-callback/v2"),
    binding: timingBindingSchema,
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    operation: z.enum(["admission", "result"]),
    tokens: z.array(z.string().max(8192)).max(64),
    admission: admissionV2Schema,
    result: z
      .object({
        text: z.string().max(100000),
        nativeSessionId: z.string().min(1).max(200),
        bindingDigest: sha,
      })
      .strict()
      .nullable(),
  })
  .strict();
export type AttemptPacket = z.infer<typeof packetV2Schema>;
export function signAttemptPacket(raw: AttemptPacket, key: KeyObject) {
  const p = packetV2Schema.parse(raw);
  if (key.type !== "private" || key.asymmetricKeyType !== "ed25519")
    throw Error("attempt_signer_invalid");
  const bytes = Buffer.from(JSON.stringify(p));
  return bytes.toString("base64url") + "." + sign(null, bytes, key).toString("base64url");
}
export type CallbackAttemptState = {
  revision: number;
  admission: AdmissionV2 | null;
  tokens: string[];
  terminal: "ready" | "uncertain" | null;
  cancelled: boolean;
  packetDigests: string[];
  result: ReturnType<typeof validateBrief> | null;
};
export const initialAttemptState = (): CallbackAttemptState => ({
  revision: 0,
  admission: null,
  tokens: [],
  terminal: null,
  cancelled: false,
  packetDigests: [],
  result: null,
});
export function reduceAttemptPacket(
  approval: AttemptApproval,
  state: CallbackAttemptState,
  token: string,
  key: KeyObject,
  now: number,
): CallbackAttemptState {
  const p = packetV2Schema.parse(verifySignedJson(key, token));
  if (digest(p.binding) !== digest(attemptBinding(approval)))
    throw Error("attempt_callback_binding");
  // Exact signed packet duplication is idempotent; all other terminal changes are forbidden.
  const packetDigest = digest(token);
  if (state.packetDigests.includes(packetDigest)) return state;
  if (
    state.terminal ||
    (state.cancelled && (p.operation === "admission" || p.result !== null)) ||
    p.issuedAt > now ||
    p.expiresAt <= now ||
    p.expiresAt <= p.issuedAt ||
    p.expiresAt - p.issuedAt > 30000
  )
    throw Error("attempt_callback_expired");
  if (p.operation === "admission" || p.result !== null) assertAttemptCurrent(approval, now);
  const chain = verifyPhaseChain(p.tokens, key, approval);
  if (state.tokens.some((t, i) => p.tokens[i] !== t)) throw Error("attempt_chain_conflict");
  if (chain.receipts.some((r) => r.at > p.issuedAt)) throw Error("attempt_future_evidence");
  const admission = admissionV2Schema.parse(p.admission),
    first = chain.receipts[0];
  if (
    !first ||
    admission.totalDeadline !== first.totalDeadline ||
    admission.preflightDeadline !== first.phaseDeadline ||
    now >= admission.totalDeadline + 5000 ||
    (state.admission && digest(state.admission) !== digest(admission))
  )
    throw Error("attempt_admission_invalid");
  validateSourceReceipt(approval.historicalApproval, admission.evidence);
  if (
    digest(coordinatorPrompt(approval.historicalApproval, admission.evidence)) !==
    admission.promptDigest
  )
    throw Error("attempt_prompt_invalid");
  let terminal: CallbackAttemptState["terminal"] = null,
    result = null;
  if (p.operation === "admission") {
    if (
      state.admission ||
      p.result ||
      chain.failed ||
      p.tokens.length !== 3 ||
      now >= admission.preflightDeadline
    )
      throw Error("attempt_admission_invalid");
  } else {
    if (!state.admission) throw Error("attempt_not_admitted");
    if (p.result) {
      if (!chain.complete || p.result.bindingDigest !== admission.runtimeBindingDigest)
        throw Error("attempt_result_invalid");
      result = validateBrief(p.result.text, approval.historicalApproval, admission.evidence);
      terminal = "ready";
    } else {
      if (!chain.failed) throw Error("attempt_failure_missing");
      terminal = "uncertain";
    }
  }
  return {
    revision: state.revision + 1,
    admission,
    tokens: p.tokens,
    terminal,
    cancelled: state.cancelled,
    packetDigests: [...state.packetDigests, packetDigest],
    result,
  };
}
export function projectAttempt(
  approval: AttemptApproval,
  state: CallbackAttemptState,
  key: KeyObject,
): AttemptView {
  const chain = verifyPhaseChain(state.tokens, key, approval),
    last = chain.receipts.at(-1);
  const spawn = chain.receipts.some((r) => r.event === "spawn_intent"),
    observed = chain.receipts.some((r) => r.event === "spawn_observed");
  const closed = chain.receipts.some(
    (r) =>
      r.stopEvidence === "immediate_child_closed" ||
      (r.phase === "provider" && r.event === "complete"),
  );
  return attemptViewSchema.parse({
    version: 2,
    requestId: approval.historicalApproval.request.requestId,
    attemptId: approval.attemptId,
    priorRunId: approval.priorRunId,
    status:
      state.terminal ??
      (state.cancelled
        ? "cancel_requested"
        : observed
          ? "child_observed"
          : spawn
            ? "spawn_attempted"
            : state.admission ||
                chain.receipts.some((r) => r.phase === "admission" && r.event === "complete")
              ? "admitted"
              : state.tokens.length
                ? "claimed"
                : "approved"),
    receiptCount: state.tokens.length,
    phase: last?.phase ?? null,
    stopEvidence: closed ? "immediate_child_closed" : spawn ? "unverified" : "not_attempted",
    providerRequests: null,
    duplicateCostPossible: true,
  });
}
export type AttemptCallbackRepository = {
  read(id: string): Promise<{ approval: AttemptApproval; state: CallbackAttemptState }>;
  /** Atomic CAS + append immutable token, including identical-packet idempotency; never retry a conflict here. */
  commit(
    id: string,
    expectedRevision: number,
    state: CallbackAttemptState,
    token: string,
  ): Promise<void>;
  cancel?(id: string): Promise<void>;
};
export function createAttemptCallback(d: {
  repository: AttemptCallbackRepository;
  peerKey: KeyObject;
  now(): number;
  authorizeCurrent(approval: AttemptApproval): Promise<void>;
}) {
  return async (id: string, token: string) => {
    const { approval, state } = await d.repository.read(id);
    if (approval.attemptId !== id) throw Error("attempt_mismatch");
    await d.authorizeCurrent(approval);
    const next = reduceAttemptPacket(approval, state, token, d.peerKey, d.now());
    if (next !== state) await d.repository.commit(id, state.revision, next, token);
    const persisted = await d.repository.read(id);
    if (digest(persisted.state) !== digest(next)) throw Error("attempt_persistence_unconfirmed");
    return {
      version: 2 as const,
      bindingDigest: digest(attemptBinding(approval)),
      admissionDigest: digest(next.admission),
      view: projectAttempt(approval, next, d.peerKey),
    };
  };
}
