import { describe, it, expect, vi, afterEach } from "vitest";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
vi.mock("./studio-research-access.server", () => ({ authorizeStudioResearch: vi.fn() }));
import { authorizeStudioResearch } from "./studio-research-access.server";
import {
  createStudioCoordinatorHandlers,
  signCoordinatorReceipt,
} from "./studio-research-coordinator-studio.server";
import {
  createCoordinatorRequestStore,
  type CoordinatorRow,
} from "./studio-research-coordinator-request-store.server";
import { COORDINATOR, digest } from "./studio-research-coordinator-contracts";
import { createApprovalAuthority } from "./studio-research-coordinator-authority.server";
import { createCoordinator } from "./studio-research-coordinator.server";
import { CoordinatorStore } from "./studio-research-coordinator-store.server";
import { extractSource } from "./studio-research-public-source.server";
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((f) => f());
  vi.clearAllMocks();
});
function fixture() {
  const userId = randomUUID(),
    requestId = randomUUID(),
    issueId = randomUUID(),
    keys = generateKeyPairSync("ed25519"),
    hostKeys = generateKeyPairSync("ed25519");
  let row: CoordinatorRow = {
    id: randomUUID(),
    organization_id: COORDINATOR.organizationId,
    request_id: requestId,
    created_by: userId,
    topic: "Public AI research",
    company_id: COORDINATOR.companyId,
    agent_id: COORDINATOR.agentId,
    issue_id: issueId,
    state: "submitted",
    result: null,
    result_comment_id: null,
    coordinator_state: null,
    coordinator_approval: null,
    coordinator_approval_digest: null,
    coordinator_admission: null,
    coordinator_brief: null,
    coordinator_result_digest: null,
  };
  const calls: { method: string; params: URLSearchParams; body: unknown }[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input)),
      params = url.searchParams;
    expect(url.pathname).toBe("/rest/v1/studio_research_requests");
    expect(init!.redirect).toBe("manual");
    expect(init!.headers).toHaveProperty("apikey", "synthetic-test-key");
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method: init?.method ?? "GET", params, body });
    let matches = true;
    for (const [field, condition] of params) {
      if (field === "limit") continue;
      const v = row[field as keyof CoordinatorRow];
      if (condition === "is.null" ? v !== null : String(v) !== condition.slice(3)) matches = false;
    }
    if (!matches) return Response.json([]);
    if (init?.method === "PATCH") row = { ...row, ...body };
    return Response.json([row]);
  });
  vi.mocked(authorizeStudioResearch).mockResolvedValue({ user: { id: userId } } as never);
  const store = createCoordinatorRequestStore("synthetic-test-key", fetcher);
  const options = {
    enabled: true,
    store,
    approvalPrivateKey: keys.privateKey,
    receiptPublicKey: hostKeys.publicKey,
    now: () => 2000,
  };
  const handlers = createStudioCoordinatorHandlers(options);
  const request = new Request("https://cmd.trusttai.com/internal/staged", {
    method: "POST",
    headers: { Authorization: "Bearer synthetic-session" },
  });
  const ids = { organizationId: COORDINATOR.organizationId, requestId };
  const command = { ...ids, approvedUrls: ["https://example.org/article"] };
  return {
    userId,
    keys,
    hostKeys,
    store,
    handlers,
    request,
    ids,
    command,
    calls,
    fetcher,
    options,
    get row() {
      return row;
    },
    set row(v: CoordinatorRow) {
      row = v;
    },
  };
}
describe("concrete staged Studio coordinator flow", () => {
  it("authenticates via existing helper and derives immutable authority from owned submitted record", async () => {
    const f = fixture();
    const issued = await f.handlers.approve(f.request, f.command);
    expect(authorizeStudioResearch).toHaveBeenCalledWith(
      f.request,
      COORDINATOR.organizationId,
      true,
    );
    expect(issued.approval.approvedBy).toBe(f.userId);
    expect(f.row.coordinator_state).toBe("approved");
    const verifier = createApprovalAuthority({
      publicKey: f.keys.publicKey,
      now: () => 2000,
      authenticate: async () => ({ userId: f.userId }),
      attestation: () => issued.attestation,
    });
    expect(await verifier({}, "run", issued.approval)).not.toBeNull();
    expect((await f.handlers.approve(f.request, f.command)).approval).toEqual(issued.approval);
    expect(f.calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
  });
  it("rejects browser identity/model/approval overrides and changed sources", async () => {
    const f = fixture();
    for (const field of ["approvedBy", "companyId", "primaryModel", "expiresAt", "approved"])
      await expect(
        f.handlers.approve(f.request, { ...f.command, [field]: "forged" }),
      ).rejects.toThrow();
    await f.handlers.approve(f.request, f.command);
    await expect(
      f.handlers.approve(f.request, { ...f.command, approvedUrls: ["https://example.org/other"] }),
    ).rejects.toThrow("approval_conflict");
  });
  it.each(["created_by", "organization_id", "company_id", "agent_id", "issue_id", "state"])(
    "rejects invalid request binding %s",
    async (field) => {
      const f = fixture();
      f.row = {
        ...f.row,
        [field]: field === "state" ? "dispatching" : field === "issue_id" ? null : randomUUID(),
      };
      await expect(f.handlers.approve(f.request, f.command)).rejects.toThrow();
      expect(f.calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
    },
  );
  it("denies missing session/access, disabled startup and revoked access before signing", async () => {
    const f = fixture();
    vi.mocked(authorizeStudioResearch).mockRejectedValueOnce(Error("denied"));
    await expect(f.handlers.approve(f.request, f.command)).rejects.toThrow("denied");
    await expect(
      createStudioCoordinatorHandlers({ ...f.options, enabled: false }).approve(
        f.request,
        f.command,
      ),
    ).rejects.toThrow("coordinator_disabled");
    let n = 0;
    vi.mocked(authorizeStudioResearch).mockImplementation(async () => {
      if (++n === 2) throw Error("revoked");
      return { user: { id: f.userId } } as never;
    });
    await expect(f.handlers.approve(f.request, f.command)).rejects.toThrow("revoked");
    expect(f.row.coordinator_state).toBe("approved");
  });
  it("runs synthetic full flow: stored approval, pre-launch admission ACK, signed result, owner review; no native comments", async () => {
    const f = fixture(),
      issued = await f.handlers.approve(f.request, f.command);
    const directory = mkdtempSync(join(tmpdir(), "studio-flow-")),
      ledger = new CoordinatorStore(join(directory, "ledger.sqlite"));
    cleanup.push(() => {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    });
    const evidence = [
      extractSource("Public AI evidence", "text/plain", f.command.approvedUrls[0]!, 2000),
    ];
    const brief = {
      research: {
        version: 1,
        requestId: f.ids.requestId,
        topics: [],
        limitations: ["Synthetic offline fixture"],
      },
      people: [],
      draft: null,
    };
    let starts = 0;
    const authority = createApprovalAuthority({
      publicKey: f.keys.publicKey,
      now: () => 2000,
      authenticate: async () => ({ userId: f.userId }),
      attestation: () => issued.attestation,
    });
    const coordinator = createCoordinator({
      store: ledger,
      now: () => 2000,
      authority,
      reader: async () => evidence,
      admit: async (job) => {
        expect(starts).toBe(0);
        await f.handlers.receive(
          signCoordinatorReceipt(f.hostKeys.privateKey, job, "admission", 2000),
        );
      },
      executor: {
        profile: async () => ({
          primaryModel: COORDINATOR.model,
          auxiliaryModel: COORDINATOR.model,
          endpoint: COORDINATOR.endpoint,
          nativeTools: "deny",
          maxProviderRequests: null,
          maxCliJobs: 1,
          timeoutMs: 60000,
          freshSession: true,
          retries: 0,
          genericWake: false,
          runtimeLogs: false,
        }),
        start: async (input) => {
          expect(f.row.coordinator_state).toBe("running");
          starts++;
          return {
            stop: async () => true,
            completion: Promise.resolve({
              nonce: input.nonce,
              providerRequests: null,
              accounting: {
                mode: "cli-job-unmetered-provider" as const,
                cliJobs: 1 as const,
                coordinatorRetries: 0 as const,
                providerRequests: null,
                immediateChildClosed: true as const,
              },
              receipt: {
                requestId: input.requestId,
                issueId: input.issueId,
                runId: input.runId,
                sessionId: input.sessionId,
                agentId: COORDINATOR.agentId,
                projectId: COORDINATOR.projectId,
                exitCode: 0,
                timedOut: false,
                attempts: 1,
              },
              stdout: [
                { type: "step_start", sessionID: input.sessionId },
                { type: "text", sessionID: input.sessionId, part: { text: JSON.stringify(brief) } },
                { type: "step_finish", sessionID: input.sessionId, part: { reason: "stop" } },
              ]
                .map((x) => JSON.stringify(x))
                .join("\n"),
            }),
          };
        },
      },
    });
    await coordinator.approve({}, issued.approval);
    await coordinator.run({}, f.ids.requestId);
    expect(starts).toBe(1);
    const job = ledger.read(f.ids.requestId)!,
      token = signCoordinatorReceipt(f.hostKeys.privateKey, job, "result", 2000);
    await expect(
      f.handlers.receive(signCoordinatorReceipt(f.keys.privateKey, job, "result", 2000)),
    ).rejects.toThrow();
    expect(f.row.coordinator_state).toBe("running");
    expect(await f.handlers.receive(token)).toEqual({ status: "accepted" });
    expect(await f.handlers.receive(token)).toEqual({ status: "accepted" });
    expect((await f.handlers.read(f.request, f.ids)).status).toBe("review_ready");
    expect(f.row.result_comment_id).toBeNull();
    expect(f.row.result).toBeNull();
    expect(f.row.coordinator_result_digest).toBe(digest(brief));
    for (const c of f.calls.filter((c) => c.method === "PATCH")) {
      expect(c.params.has("limit")).toBe(false);
      expect(c.params.get("id")).toBe(`eq.${f.row.id}`);
      expect(c.params.get("created_by")).toBe(`eq.${f.userId}`);
      expect(c.params.get("issue_id")).toBe(`eq.${f.row.issue_id}`);
    }
    f.row = { ...f.row, created_by: randomUUID() };
    await expect(f.handlers.read(f.request, f.ids)).rejects.toThrow("request_not_owned");
  });
  it("rejects redirected storage without retry or leaking raw payload", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 307, headers: { Location: "https://example.org" } }),
    );
    await expect(
      createCoordinatorRequestStore("synthetic", fetcher).read(
        COORDINATOR.organizationId,
        randomUUID(),
      ),
    ).rejects.toThrow("coordinator_storage_rejected");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("cancels only an owned approved record and does not reset it", async () => {
    const f = fixture();
    await f.handlers.approve(f.request, f.command);
    expect(await f.handlers.cancel(f.request, f.ids)).toEqual({
      status: "result_acceptance_blocked",
      executionStop: "unverified",
    });
    await expect(f.handlers.approve(f.request, f.command)).rejects.toThrow("approval_conflict");
  });
});
