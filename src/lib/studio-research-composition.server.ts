/** Single fail-closed composition. No startup wiring, environment lookup or network default. */
import type { KeyObject } from "node:crypto";
import { z } from "zod";
import {
  COORDINATOR,
  COMPOSITION_POLICY_SHA256,
  LINUX_PREVIEW_POLICY_SHA256,
  approvalSchema,
  checkApproval,
  digest,
  profileSchema,
  type Approval,
} from "./studio-research-coordinator-contracts";
import { CoordinatorStore, type Job } from "./studio-research-coordinator-store.server";
import {
  createCoordinator,
  type CoordinatorDeps,
  type ExecutionInput,
  type Capture,
  type Action,
} from "./studio-research-coordinator.server";
import {
  createApprovalAuthority,
  verifySignedJson,
} from "./studio-research-coordinator-authority.server";
import { signCoordinatorReceipt } from "./studio-research-receipt-signing.server";
type Owned = {
  approval: Approval;
  state: "approved" | "running" | "ready" | "cancelled";
  revoked: boolean;
  admission?: unknown;
  resultDigest?: string;
};
export type CompositionDeps = {
  mode: "offline-synthetic" | "linux-public-preview" | "production";
  store: CoordinatorStore;
  now(): number;
  /** Real server session+membership/work check. Request never leaves this process via transport. */
  authorize(request: Request, organizationId: string, work: boolean): Promise<{ userId: string }>;
  readApproved(organizationId: string, requestId: string): Promise<Owned | null>;
  reader: CoordinatorDeps["reader"];
  grantPublicKey: KeyObject;
  hostPrivateKey: KeyObject;
  ackPublicKey: KeyObject;
  runtimePublicKey: KeyObject;
  runtime: {
    inspectPolicy(): Promise<string>;
    profile(): Promise<unknown>;
    start(input: ExecutionInput): Promise<{ completion: Promise<Capture> }>;
    stopExact(input: {
      requestId: string;
      runId: string;
      sessionId: string;
      nonce: string;
      approvalDigest: string;
    }): Promise<string>;
  };
  /** Fixed typed receipt channel only. No arbitrary URL/header or session forwarding. */
  exchange(kind: "admission" | "result", signedReceipt: string): Promise<string>;
};
const policyProof = z
  .object({
    domain: z.literal("studio-runtime-policy/v1"),
    policyDigest: z.string().regex(/^[a-f0-9]{64}$/),
    mode: z.enum(["offline-synthetic", "linux-public-preview"]),
    issuedAt: z.number().finite(),
    expiresAt: z.number().finite(),
  })
  .strict();
const proofSchema = z
  .object({
    domain: z.enum(["studio-admission-ack/v1", "studio-result-ack/v1", "studio-stop-ack/v1"]),
    companyId: z.literal(COORDINATOR.companyId),
    projectId: z.literal(COORDINATOR.projectId),
    agentId: z.literal(COORDINATOR.agentId),
    subjectId: z.string().uuid(),
    requestId: z.string().uuid(),
    runId: z.string().uuid(),
    sessionId: z.string(),
    approvalDigest: z.string(),
    payloadDigest: z.string(),
    issuedAt: z.number().finite(),
    expiresAt: z.number().finite(),
    status: z.enum(["accepted", "stopped"]),
  })
  .strict();
const unavailable = () => ({
  available: false as const,
  reason: "composition_unavailable" as const,
});
export async function createManualResearchComposition(configuration?: CompositionDeps) {
  if (!configuration) return unavailable();
  const d = configuration;
  // Production is intentionally unavailable until a separately reviewed, entitled bounded executor exists.
  if (
    !d ||
    !["offline-synthetic", "linux-public-preview"].includes(d.mode) ||
    !(d.store instanceof CoordinatorStore) ||
    ![
      d.now,
      d.authorize,
      d.readApproved,
      d.reader,
      d.exchange,
      d.runtime?.inspectPolicy,
      d.runtime?.profile,
      d.runtime?.start,
      d.runtime?.stopExact,
    ].every((x) => typeof x === "function") ||
    ![d.grantPublicKey, d.ackPublicKey, d.runtimePublicKey].every(
      (k) => k?.type === "public" && k.asymmetricKeyType === "ed25519",
    ) ||
    d.hostPrivateKey?.type !== "private" ||
    d.hostPrivateKey.asymmetricKeyType !== "ed25519"
  )
    return unavailable();
  const expectedPolicy =
    d.mode === "linux-public-preview" ? LINUX_PREVIEW_POLICY_SHA256 : COMPOSITION_POLICY_SHA256;
  async function policy() {
    const p = policyProof.parse(
      verifySignedJson(d!.runtimePublicKey, await d!.runtime.inspectPolicy()),
    );
    if (p.mode !== d.mode || p.policyDigest !== expectedPolicy)
      throw Error("runtime_policy_mode_mismatch");
    if (p.issuedAt > d!.now() || p.expiresAt <= d!.now() || p.expiresAt - p.issuedAt > 60000)
      throw Error("runtime_policy_unverified");
    profileSchema.parse(await d!.runtime.profile());
    if (p.expiresAt <= d!.now()) throw Error("runtime_policy_expired");
  }
  try {
    await policy();
  } catch {
    return unavailable();
  }
  type Context = { request: Request; grant?: string };
  const contexts = new WeakMap<object, Context>();
  const running = new Map<string, object>();
  async function owner(request: Request, a: Approval, action: Action) {
    const user = await d.authorize(request, a.request.organizationId, action !== "read");
    const current = await d.readApproved(a.request.organizationId, a.request.requestId);
    if (
      a.executionPolicySha256 !== expectedPolicy ||
      !current ||
      user.userId !== a.approvedBy ||
      digest(approvalSchema.parse(current.approval)) !== digest(a) ||
      ((action === "run" || action === "approve") &&
        (current.revoked || current.state === "cancelled"))
    )
      throw Error("not_authorized");
    return user;
  }
  const signedAuthority = createApprovalAuthority({
    publicKey: d.grantPublicKey,
    now: d.now,
    attestation: (c) => contexts.get(c as object)?.grant,
    authenticate: async (c) => {
      const context = contexts.get(c as object);
      if (!context) throw Error();
      const job = (c as { approval: Approval }).approval;
      return owner(context.request, job, "run");
    },
  });
  const authority: CoordinatorDeps["authority"] = async (c, action, a) => {
    const context = contexts.get(c as object);
    if (!context) return null;
    try {
      await owner(context.request, a, action);
      if (action === "run" || action === "approve") return signedAuthority(c, action, a);
      return {
        subjectId: a.approvedBy,
        organizationId: a.request.organizationId,
        requestId: a.request.requestId,
        approvalDigest: digest(a),
        expiresAt: d.now() + 5000,
        actions: [action],
      };
    } catch {
      return null;
    }
  };
  function context(request: Request, a: Approval, grant?: string) {
    const c = { approval: structuredClone(a) };
    contexts.set(c, { request, ...(grant ? { grant } : {}) });
    return c;
  }
  function proof(
    token: string,
    job: Job,
    domain: z.infer<typeof proofSchema>["domain"],
    payloadDigest: string,
    at = d.now(),
  ) {
    const p = proofSchema.parse(
      verifySignedJson(
        domain === "studio-stop-ack/v1" ? d.runtimePublicKey : d.ackPublicKey,
        token,
      ),
    );
    if (
      p.domain !== domain ||
      p.status !== (domain === "studio-stop-ack/v1" ? "stopped" : "accepted") ||
      p.subjectId !== job.approval.approvedBy ||
      p.requestId !== job.id ||
      p.runId !== job.data.runId ||
      p.sessionId !== job.data.sessionId ||
      p.approvalDigest !== job.approvalDigest ||
      p.payloadDigest !== payloadDigest ||
      p.issuedAt > at ||
      p.expiresAt <= at ||
      p.expiresAt - p.issuedAt > 60000
    )
      throw Error("receipt_ack_invalid");
  }
  async function deliver(kind: "admission" | "result", job: Job) {
    if (kind === "result" && job.data.delivery) {
      const saved = job.data.delivery;
      proof(saved.ack, job, "studio-result-ack/v1", saved.payloadDigest, saved.verifiedAt);
      return;
    }
    const snapshot = structuredClone(job);
    if (kind === "result") {
      snapshot.state = "ready";
      delete snapshot.data.review;
      delete snapshot.data.delivery;
      delete snapshot.data.stopReceipt;
    }
    const token = signCoordinatorReceipt(d.hostPrivateKey, snapshot, kind, d.now());
    const ack = await timeout(d.exchange(kind, token));
    const payloadDigest = digest(token);
    proof(
      ack,
      job,
      kind === "admission" ? "studio-admission-ack/v1" : "studio-result-ack/v1",
      payloadDigest,
    );
    if (kind === "result") {
      const destination = await d.readApproved(job.approval.request.organizationId, job.id);
      if (
        !destination ||
        destination.state !== "ready" ||
        destination.resultDigest !== job.data.resultDigest ||
        digest(destination.approval) !== job.approvalDigest
      )
        throw Error("delivery_unconfirmed");
      // Destination verification awaited: do not persist a proof that expired meanwhile.
      const verifiedAt = d.now();
      proof(ack, job, "studio-result-ack/v1", payloadDigest, verifiedAt);
      for (let attempt = 0; attempt < 3; attempt++) {
        const latest = d.store.read(job.id)!;
        if (latest.data.delivery) return;
        if (!["ready", "reviewed"].includes(latest.state)) throw Error("delivery_conflict");
        if (
          d.store.transition(latest, latest.state, {
            delivery: { ack, payloadDigest, verifiedAt },
          })
        )
          return;
      }
      throw Error("delivery_conflict");
    }
  }

  const core = createCoordinator({
    store: d.store,
    now: d.now,
    authority,
    reader: d.reader,
    admit: async (job) => {
      await policy();
      await deliver("admission", job);
    },
    executor: {
      profile: d.runtime.profile,
      start: async (input) => {
        const c = running.get(input.requestId),
          job = d.store.read(input.requestId);
        if (!c || !job || !(await authority(c, "run", job.approval))) throw Error("not_authorized");
        await policy();
        const admission = await d.readApproved(job.approval.request.organizationId, job.id);
        const expected = {
          origin: "coordinator",
          requestId: job.id,
          issueId: job.approval.issueId,
          approvalDigest: job.approvalDigest,
          runId: job.data.runId,
          sessionId: job.data.sessionId,
          evidence: job.data.evidence,
          promptDigest: job.data.promptDigest,
          evidenceDigest: job.data.evidenceDigest,
          launch: job.data.launch,
        };
        if (
          !admission ||
          admission.revoked ||
          admission.state !== "running" ||
          digest(admission.admission) !== digest(expected)
        )
          throw Error("admission_unconfirmed");
        if (
          input.signal.aborted ||
          d.now() >= input.launchDeadline ||
          Buffer.byteLength(input.prompt) > 25000
        )
          throw Error("launch_not_admitted");
        const handle = await d.runtime.start(input);
        return {
          completion: handle.completion,
          stop: async () => {
            const command = {
              requestId: job.id,
              runId: input.runId,
              sessionId: input.sessionId,
              nonce: input.nonce,
              approvalDigest: job.approvalDigest,
            };
            try {
              const ack = await timeout(d.runtime.stopExact(command));
              const payloadDigest = digest(command);
              proof(ack, job, "studio-stop-ack/v1", payloadDigest);
              for (let attempt = 0; attempt < 3; attempt++) {
                const latest = d.store.read(job.id)!;
                if (latest.data.stopReceipt) return true;
                if (!["running", "cancel_requested", "uncertain"].includes(latest.state))
                  return false;
                if (
                  d.store.transition(latest, latest.state, {
                    stopReceipt: { ack, payloadDigest, verifiedAt: d.now() },
                  })
                )
                  return true;
              }
              return false;
            } catch {
              return false;
            }
          },
        };
      },
    },
  });
  async function known(request: Request, id: string, action: Action) {
    const job = d.store.read(z.string().uuid().parse(id));
    if (!job) throw Error("not_found");
    await owner(request, job.approval, action);
    return { job, c: context(request, job.approval) };
  }
  return {
    available: true as const,
    mode:
      d.mode === "linux-public-preview"
        ? ("linux-public-preview" as const)
        : ("offline-synthetic" as const),
    usesStore(store: CoordinatorStore) {
      return store === d.store;
    },
    async run(request: Request, input: { approval: unknown; grant: string }) {
      const a = checkApproval(input.approval, d.now());
      const c = context(request, a, input.grant);
      if (!(await authority(c, "run", a))) throw Error("not_authorized");
      await policy();
      if (running.has(a.request.requestId))
        return { requestId: a.request.requestId, state: "queued" as const };
      running.set(a.request.requestId, c);
      try {
        await core.approve(c, a);
        const result = await core.run(c, a.request.requestId);
        if (result.state === "ready") {
          try {
            await deliver("result", d.store.read(a.request.requestId)!);
          } catch {
            return { ...result, state: "delivery_uncertain" as const };
          }
        }
        return result;
      } finally {
        running.delete(a.request.requestId);
      }
    },
    async read(request: Request, id: string) {
      const { job, c } = await known(request, id, "read");
      const result = await core.read(c, id);
      if (result.state === "ready" && !job.data.delivery)
        return { ...result, state: "delivery_uncertain" as const };
      return result;
    },
    async reconcileResult(request: Request, id: string) {
      const { job, c } = await known(request, id, "review");
      if (job.state !== "ready" && job.state !== "reviewed") throw Error("result_not_ready");
      await deliver("result", job);
      return core.read(c, id);
    },
    async cancel(request: Request, id: string) {
      const { c } = await known(request, id, "cancel");
      return core.cancel(c, id);
    },
    async review(request: Request, id: string, input: unknown) {
      const { job, c } = await known(request, id, "review");
      if (!job.data.delivery) throw Error("delivery_unconfirmed");
      proof(
        job.data.delivery.ack,
        job,
        "studio-result-ack/v1",
        job.data.delivery.payloadDigest,
        job.data.delivery.verifiedAt,
      );
      return core.review(c, id, input);
    },
  };
}
async function timeout<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error("transport_uncertain")), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
