import { it, expect, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { makeTimingPreview } from "../../packages/studio-research-coordinator/src/timing-preview";
import { createAttemptSupabaseRepository } from "./studio-research-attempt-supabase.server";
import {
  parseAttemptApproval,
  type AttemptApproval,
} from "./studio-research-attempt-contracts.server";
import { initialAttemptState } from "./studio-research-attempt-callback.server";
import {
  COORDINATOR,
  digest,
  PROMPT_POLICY_SHA256,
  COMPOSITION_POLICY_SHA256,
} from "./studio-research-coordinator-contracts";
import { TIMING_POLICY_DIGEST } from "./studio-research-timing-candidate.server";
import type { RouteEnvelope } from "./studio-research-route-transport.server";

function approvals() {
  const prior = parseAttemptApproval({
    version: 2,
    attemptId: "55555555-5555-4555-8555-555555555555",
    runId: "66666666-6666-4666-8666-666666666666",
    priorRunId: "44444444-4444-4444-8444-444444444444",
    nonce: "77777777-7777-4777-8777-777777777777",
    sessionId: "ses_88888888-8888-4888-8888-888888888888",
    subjectId: "11111111-1111-4111-8111-111111111111",
    approvedAt: 1000000,
    expiresAt: 1100000,
    policyDigest: TIMING_POLICY_DIGEST,
    duplicateCostAccepted: true,
    historicalApproval: {
      version: 1,
      promptPolicySha256: PROMPT_POLICY_SHA256,
      executionPolicySha256: COMPOSITION_POLICY_SHA256,
      request: {
        requestId: "22222222-2222-4222-8222-222222222222",
        organizationId: COORDINATOR.organizationId,
        topic: "IANA example domains",
      },
      companyId: COORDINATOR.companyId,
      projectId: COORDINATOR.projectId,
      agentId: COORDINATOR.agentId,
      approvedBy: "11111111-1111-4111-8111-111111111111",
      approvedAt: 1000,
      expiresAt: 10000,
      approvedUrls: ["https://www.iana.org/help/example-domains"],
      issueId: "33333333-3333-4333-8333-333333333333",
      primaryModel: COORDINATOR.model,
      auxiliaryModel: COORDINATOR.model,
      endpoint: COORDINATOR.endpoint,
      nativeTools: "deny",
      maxProviderRequests: null,
      maxCliJobs: 1,
      timeoutMs: 60000,
      draftRequested: false,
      voiceExamples: [],
    },
  });
  const successor = parseAttemptApproval({
    ...prior,
    version: 3,
    domain: "studio-successor-approval/v1",
    attemptId: "99999999-9999-4999-8999-999999999999",
    runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    nonce: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    sessionId: "ses_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    predecessorAttemptId: prior.attemptId,
    predecessorRunId: prior.runId,
    predecessorApprovalDigest: digest(prior),
    predecessorExpiresAt: prior.expiresAt,
    userApprovalReference: "synthetic-owner-approval",
    approvedAt: 1100001,
    expiresAt: 1200001,
  });
  return { prior, successor };
}

it.each([
  [4, 2, true],
  [5, 3, true],
  [4, 3, false],
  [5, 2, false],
] as const)(
  "host config %s accepts approval version %s only when explicitly paired (%s)",
  (configVersion, approvalVersion, accepted) => {
    const { prior, successor } = approvals(),
      approval = approvalVersion === 2 ? prior : successor;
    const keys = generateKeyPairSync("ed25519");
    const read = vi.fn(() => approval),
      fetcher = vi.fn(),
      providerKey = vi.fn(),
      revalidateHost = vi.fn();
    // Factory construction only: no dispatch, provider, native spawn, network or provisioning.
    const construct = () =>
      makeTimingPreview({
        config: {
          version: configVersion,
          attemptId: approval.attemptId,
          approvalDigest: digest(approval),
          policyDigest: TIMING_POLICY_DIGEST,
        },
        store: { read } as unknown as Parameters<typeof makeTimingPreview>[0]["store"],
        ledger: { claim: vi.fn(), finish: vi.fn() },
        studioKey: keys.publicKey,
        callbackKey: keys.publicKey,
        privateKey: keys.privateKey,
        fetcher,
        providerKey,
        revalidateHost,
        now: () => approval.approvedAt,
        shutdownSignal: new AbortController().signal,
        hostAdmissionExpiresAt: approval.expiresAt,
      });
    if (accepted) expect(construct()).toBeDefined();
    else expect(construct).toThrow("attempt_pin_mismatch");
    expect(read).toHaveBeenCalledExactlyOnceWith(approval.attemptId);
    expect(fetcher).not.toHaveBeenCalled();
    expect(providerKey).not.toHaveBeenCalled();
    expect(revalidateHost).not.toHaveBeenCalled();
  },
);

function syntheticRepository(approval: AttemptApproval, storageVersion?: 2 | 3) {
  const keys = generateKeyPairSync("ed25519");
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path.includes("studio_research_attempts_"))
      return Response.json([
        { approval, approval_digest: digest(approval), state: initialAttemptState() },
      ]);
    if (path.includes("nonce_claim_")) return Response.json({ claimed: true, response: null });
    return Response.json(true);
  });
  return {
    fetcher,
    repository: createAttemptSupabaseRepository(
      "synthetic-inert-key",
      keys.publicKey,
      fetcher,
      storageVersion,
    ),
  };
}

it.each([
  [undefined, 2, true],
  [2, 2, true],
  [3, 3, true],
  [undefined, 3, false],
  [2, 3, false],
  [3, 2, false],
] as const)(
  "repository selector %s accepts approval version %s only when explicitly paired (%s)",
  async (storageVersion, approvalVersion, accepted) => {
    const { prior, successor } = approvals(),
      approval = approvalVersion === 2 ? prior : successor;
    const { repository, fetcher } = syntheticRepository(approval, storageVersion);
    if (accepted) expect((await repository.read(approval.attemptId)).approval).toEqual(approval);
    else
      await expect(repository.read(approval.attemptId)).rejects.toThrow("attempt_storage_binding");
    expect(fetcher).toHaveBeenCalledTimes(1); // No fallback or cross-version retry.
    const url = new URL(String(fetcher.mock.calls[0]![0]));
    expect(url.pathname).toBe(`/rest/v1/studio_research_attempts_v${storageVersion ?? 2}`);
    expect(url.searchParams.get("attempt_id")).toBe(`eq.${approval.attemptId}`);
  },
);

it.each([undefined, 2, 3] as const)(
  "all repository endpoints stay within explicit storage selector %s",
  async (storageVersion) => {
    const { prior, successor } = approvals(),
      approval = storageVersion === 3 ? successor : prior;
    const { repository, fetcher } = syntheticRepository(approval, storageVersion);
    const envelope: RouteEnvelope = {
      domain: "studio-coordinator-route/v1",
      sender: "coordinator",
      companyId: COORDINATOR.companyId,
      projectId: COORDINATOR.projectId,
      agentId: COORDINATOR.agentId,
      organizationId: COORDINATOR.organizationId,
      subjectId: approval.subjectId,
      requestId: approval.historicalApproval.request.requestId,
      issueId: approval.historicalApproval.issueId,
      approvalDigest: digest(approval),
      operation: "authority",
      nonce: approval.nonce,
      issuedAt: approval.approvedAt,
      expiresAt: approval.approvedAt + 1000,
      payload: { version: 2, attemptId: approval.attemptId },
    };
    await repository.read(approval.attemptId);
    await repository.cancel!(approval.attemptId);
    await repository.commit(approval.attemptId, 0, initialAttemptState(), "synthetic-packet");
    await repository.ledger.claim(envelope);
    await repository.ledger.finish(envelope, "synthetic-response");
    const suffix = `_v${storageVersion ?? 2}`;
    expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      `/rest/v1/studio_research_attempts${suffix}`,
      `/rest/v1/rpc/studio_attempt_cancel${suffix}`,
      `/rest/v1/rpc/studio_attempt_commit${suffix}`,
      `/rest/v1/rpc/studio_attempt_nonce_claim${suffix}`,
      `/rest/v1/rpc/studio_attempt_nonce_finish${suffix}`,
    ]);
  },
);
