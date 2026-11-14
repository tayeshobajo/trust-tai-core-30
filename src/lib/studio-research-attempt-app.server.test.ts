import { it, expect, vi } from "vitest";
import { makeStudioAttemptApplication } from "./studio-research-attempt-app.server";
import {
  initialAttemptState,
  type CallbackAttemptState,
} from "./studio-research-attempt-callback.server";
import { parseAttemptApproval } from "./studio-research-attempt-contracts.server";
import {
  COORDINATOR,
  digest,
  PROMPT_POLICY_SHA256,
  COMPOSITION_POLICY_SHA256,
} from "./studio-research-coordinator-contracts";
import { TIMING_POLICY_DIGEST } from "./studio-research-timing-candidate.server";
import type { authorizeStudioResearch } from "./studio-research-access.server";

function fixture() {
  const approval = parseAttemptApproval({
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
  let now = 1000000,
    state = initialAttemptState(),
    canWork = true;
  const host = {
    version: 2,
    requestId: approval.historicalApproval.request.requestId,
    attemptId: approval.attemptId,
    priorRunId: approval.priorRunId,
    status: "approved",
    receiptCount: 0,
    phase: null,
    stopEvidence: "not_attempted",
    providerRequests: null,
    duplicateCostPossible: true,
    // Even a signed host cannot supply the CMD launch decision or TTL.
    launchEligibility: {
      eligible: true,
      checkedAt: 1000000,
      expiresAt: 1900000,
      ttlMs: 900000,
      reason: "eligible",
    },
  };
  const remote = vi.fn(async () => host);
  const read = vi.fn(async () => ({ approval, state }));
  const app = makeStudioAttemptApplication({
    attemptId: approval.attemptId,
    approvalDigest: digest(approval),
    repository: { read, commit: vi.fn() },
    remote,
    now: () => now,
    authorize: async () =>
      ({ user: { id: approval.subjectId }, access: { canWork } }) as Awaited<
        ReturnType<typeof authorizeStudioResearch>
      >,
  });
  return {
    approval,
    host,
    remote,
    read,
    setTime: (value: number) => {
      now = value;
    },
    setState: (value: CallbackAttemptState) => {
      state = value;
    },
    denyWork: () => {
      canWork = false;
    },
    call: (operation: "read" | "start" = "read") =>
      app(new Request("https://cmd.trusttai.com/_serverFn/attempt", { method: "POST" }), {
        version: 2,
        operation,
        organizationId: COORDINATOR.organizationId,
        requestId: host.requestId,
        attemptId: approval.attemptId,
      }),
  };
}

it("projects eligibility from final server time and pinned approval, overriding host TTL", async () => {
  const f = fixture();
  f.remote.mockImplementation(async () => {
    f.setTime(1005000);
    return f.host;
  });
  const view = await f.call();
  expect(view.launchEligibility).toEqual({
    eligible: true,
    checkedAt: 1005000,
    expiresAt: 1100000,
    ttlMs: 95000,
    reason: "eligible",
  });
  expect(f.remote).toHaveBeenCalledWith(expect.objectContaining({ operation: "read" }));
});

it.each([
  [999999, "not_yet_valid"],
  [1100000, "expired"],
  [1200000, "expired"],
])("keeps approved status readable at %s but does not permit launch (%s)", async (now, reason) => {
  const f = fixture();
  f.setTime(now as number);
  const view = await f.call();
  expect(view.status).toBe("approved");
  expect(view.launchEligibility).toMatchObject({ eligible: false, reason, ttlMs: 0 });
});

it("does not dispatch an expired start even if the host claims eligibility", async () => {
  const f = fixture();
  f.setTime(1100000);
  await expect(f.call("start")).rejects.toThrow("attempt_expired");
  expect(f.remote).not.toHaveBeenCalled();
});

it.each(["claimed", "uncertain", "cancel_requested", "ready"])(
  "rejects eligibility for host %s",
  async (status) => {
    const f = fixture();
    f.host.status = status;
    expect((await f.call()).launchEligibility).toMatchObject({
      eligible: false,
      reason: "attempt_not_untouched",
      ttlMs: 0,
    });
  },
);

it.each([
  { revision: 1 },
  { tokens: ["synthetic-receipt"] },
  { cancelled: true },
  { terminal: "uncertain" as const },
  { packetDigests: ["a".repeat(64)] },
])("rejects a touched callback state even with host approved: %j", async (patch) => {
  const f = fixture();
  f.setState({ ...initialAttemptState(), ...patch });
  expect((await f.call()).launchEligibility).toMatchObject({
    eligible: false,
    reason: "attempt_not_untouched",
    ttlMs: 0,
  });
});

it("allows read-only access to view status without granting launch eligibility", async () => {
  const f = fixture();
  f.denyWork();
  expect((await f.call()).launchEligibility).toMatchObject({
    eligible: false,
    reason: "access_denied",
    ttlMs: 0,
  });
});

it("rechecks the persisted approval pin after the remote read", async () => {
  const f = fixture();
  f.read
    .mockResolvedValueOnce({ approval: f.approval, state: initialAttemptState() })
    .mockResolvedValueOnce({
      approval: { ...f.approval, expiresAt: 1200000 },
      state: initialAttemptState(),
    });
  await expect(f.call()).rejects.toThrow("attempt_owner_mismatch");
});
