/**
 * Adapter↔SQL contract tests. These parse the UNAPPLIED SQL patches in
 * docs/proposed/steward-backend/ and assert every adapter RPC call uses the
 * exact function name and parameter names the SQL declares — the failure
 * mode where the adapter sends p_organization_id while the SQL expects
 * p_org is caught here, not at runtime.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createSupabaseCanonicalRunRepository } from "./steward-canonical-run.supabase";
import { createSupabaseVerificationRepository } from "./steward-verification.supabase";
import { createSupabaseCoverageRepository } from "./steward-coverage.supabase";
import { createSupabaseProposalLinkRepository } from "./steward-proposal-link.supabase";
import { createSupabaseScopeRepository } from "./steward-scope.supabase";

const SQL_DIR = join(__dirname, "..", "..", "docs", "proposed", "steward-backend");

/** Extract the p_ parameter names of a public function from a SQL file. */
function sqlParams(file: string, fn: string): string[] {
  const sql = readFileSync(join(SQL_DIR, file), "utf8");
  const match = sql.match(new RegExp(`function public\\.${fn}\\(([^)]*)\\)`, "s"));
  if (!match) throw new Error(`function ${fn} not found in ${file}`);
  return [...match[1]!.matchAll(/\b(p_[a-z_]+)\s+[a-z]/gi)].map((m) => m[1]!);
}

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

function mockSupabase(returnValue: unknown = null) {
  const calls: RpcCall[] = [];
  const client = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data: returnValue, error: null };
    }),
    from: vi.fn(() => {
      const q = {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: returnValue, error: null }),
        single: async () => ({ data: returnValue, error: null }),
      };
      return q;
    }),
  };
  return { client, calls };
}

const RUN_ROW = {
  id: "r1",
  organization_id: "o1",
  task_id: "t1",
  action: "prepare_brief",
  client_operation_id: "op-1",
  request_digest: "d",
  input_snapshot: [],
  status: "queued",
  artifact_text: null,
  artifact_digest: null,
  evidence_refs: [],
  requested_by: "u1",
  attempts: 0,
  max_attempts: 3,
  failure_reason: null,
  claim_token: null,
  claim_version: 0,
};

const RECEIPT_ROW = {
  id: "rc1",
  organization_id: "o1",
  task_id: "t1",
  operation_id: "op-1",
  kind: "verify",
  note: "evidence note here",
  actor_id: "u1",
  created_at: "2026-01-01",
};

describe("Supabase adapters match the proposed SQL contract", () => {
  it("requestRun sends exactly steward_request_canonical_run's parameters", async () => {
    const { client, calls } = mockSupabase({ run: RUN_ROW, replayed: false });
    const repo = createSupabaseCanonicalRunRepository(client as never);
    await repo.requestRun({
      orgId: "o1",
      taskId: "t1",
      action: "prepare_brief",
      operationId: "op-1",
      digest: "d",
      inputRefs: [{ kind: "transcript", id: "c1" }],
      actorId: "u1",
    });
    expect(calls[0]!.fn).toBe("steward_request_canonical_run");
    expect(Object.keys(calls[0]!.args).sort()).toEqual(
      sqlParams("001_canonical_runs.up.sql", "steward_request_canonical_run").sort(),
    );
  });

  it("claimRun sends exactly steward_claim_canonical_run's parameters", async () => {
    const { client, calls } = mockSupabase(RUN_ROW);
    const repo = createSupabaseCanonicalRunRepository(client as never);
    await repo.claimRun("r1", "worker", 120);
    expect(calls[0]!.fn).toBe("steward_claim_canonical_run");
    expect(Object.keys(calls[0]!.args).sort()).toEqual(
      sqlParams("001_canonical_runs.up.sql", "steward_claim_canonical_run").sort(),
    );
  });

  it("completeRun sends exactly steward_complete_canonical_run's parameters", async () => {
    const { client, calls } = mockSupabase(RUN_ROW);
    const repo = createSupabaseCanonicalRunRepository(client as never);
    await repo.completeRun({ runId: "r1", claimToken: "tok", artifactText: "a", evidenceRefs: [] });
    expect(calls[0]!.fn).toBe("steward_complete_canonical_run");
    expect(Object.keys(calls[0]!.args).sort()).toEqual(
      sqlParams("001_canonical_runs.up.sql", "steward_complete_canonical_run").sort(),
    );
  });

  it("failRun sends exactly steward_fail_canonical_run's parameters", async () => {
    const { client, calls } = mockSupabase(RUN_ROW);
    const repo = createSupabaseCanonicalRunRepository(client as never);
    await repo.failRun({ runId: "r1", claimToken: "tok", reason: "x" });
    expect(calls[0]!.fn).toBe("steward_fail_canonical_run");
    expect(Object.keys(calls[0]!.args).sort()).toEqual(
      sqlParams("001_canonical_runs.up.sql", "steward_fail_canonical_run").sort(),
    );
  });

  it("readInput is not available on the Supabase adapter (resolve_input is not granted)", async () => {
    const { client, calls } = mockSupabase();
    const repo = createSupabaseCanonicalRunRepository(client as never);
    await expect(repo.readInput({ kind: "transcript", id: "c1" }, "o1", "u1")).rejects.toThrow(
      /server-side only/,
    );
    expect(calls).toHaveLength(0);
  });

  it("verifyTask sends exactly steward_verify_task's parameters", async () => {
    const { client, calls } = mockSupabase({ receipt: RECEIPT_ROW, replayed: false });
    const repo = createSupabaseVerificationRepository(client as never);
    await repo.verifyTask({
      orgId: "o1",
      taskId: "t1",
      expectedRevision: 1,
      operationId: "op-1",
      note: "evidence note here",
      actorId: "u1",
    });
    expect(calls[0]!.fn).toBe("steward_verify_task");
    expect(Object.keys(calls[0]!.args).sort()).toEqual(
      sqlParams("002_atomic_verification.up.sql", "steward_verify_task").sort(),
    );
  });

  it("reopenTask sends exactly steward_reopen_task's parameters", async () => {
    const { client, calls } = mockSupabase({ receipt: RECEIPT_ROW, replayed: false });
    const repo = createSupabaseVerificationRepository(client as never);
    await repo.reopenTask({
      orgId: "o1",
      taskId: "t1",
      expectedRevision: 2,
      operationId: "op-2",
      reason: "reopen reason here",
      actorId: "u1",
    });
    expect(calls[0]!.fn).toBe("steward_reopen_task");
    expect(Object.keys(calls[0]!.args).sort()).toEqual(
      sqlParams("002_atomic_verification.up.sql", "steward_reopen_task").sort(),
    );
  });

  it("attest binds the operation id and the reviewed source; the SQL derives the current hash itself", async () => {
    const { client, calls } = mockSupabase({
      id: "a1",
      organization_id: "o1",
      conversation_id: "c1",
      transcript_hash: "h",
      scope_version: 1,
      attested_by: "u1",
      attested_at: "2026-01-01",
      superseded_at: null,
    });
    const repo = createSupabaseCoverageRepository(client as never);
    await repo.attest({
      orgId: "o1",
      conversationId: "c1",
      operationId: "op-att-1",
      expectedTranscriptHash: "reviewed-hash-0123456789",
      expectedScopeVersion: 2,
    });
    expect(calls[0]!.fn).toBe("steward_attest_coverage");
    expect(Object.keys(calls[0]!.args).sort()).toEqual(
      sqlParams("003_coverage_attestation.up.sql", "steward_attest_coverage").sort(),
    );
    expect(calls[0]!.args).toMatchObject({
      p_operation: "op-att-1",
      p_expected_hash: "reviewed-hash-0123456789",
      p_expected_scope_version: 2,
    });
  });

  it("linkProposal sends exactly steward_link_proposal's parameters", async () => {
    const { client, calls } = mockSupabase({
      id: "l1",
      organization_id: "o1",
      conversation_id: "c1",
      proposal_id: "p1",
      task_id: "t1",
      operation_id: "op-1",
      actor_id: "u1",
      created_at: "2026-01-01",
    });
    const repo = createSupabaseProposalLinkRepository(client as never);
    await repo.linkProposal({
      orgId: "o1",
      conversationId: "c1",
      proposalId: "p1",
      taskId: "t1",
      operationId: "op-1",
      actorId: "u1",
    });
    expect(calls[0]!.fn).toBe("steward_link_proposal");
    expect(Object.keys(calls[0]!.args).sort()).toEqual(
      sqlParams("004_proposal_links.up.sql", "steward_link_proposal").sort(),
    );
  });

  it("scope add/amend/counts send exactly the SQL parameters", async () => {
    const itemRow = {
      id: "i1",
      organization_id: "o1",
      conversation_id: "c1",
      task_id: "t1",
      classification: "manual_required",
      removed_at: null,
    };
    const { client, calls } = mockSupabase(itemRow);
    const repo = createSupabaseScopeRepository(client as never);
    await repo.addItem({
      orgId: "o1",
      conversationId: "c1",
      taskId: "t1",
      classification: "manual_required",
      operationId: "op-1",
    });
    expect(calls[0]!.fn).toBe("steward_scope_add_item");
    expect(Object.keys(calls[0]!.args).sort()).toEqual(
      sqlParams("005_scope_membership.up.sql", "steward_scope_add_item").sort(),
    );
    await repo.amendRemove({
      orgId: "o1",
      conversationId: "c1",
      itemId: "i1",
      reason: "scope amendment reason",
      operationId: "op-2",
    });
    const amendCall = calls[1]!;
    expect(amendCall.fn).toBe("steward_scope_amend_remove");
    expect(Object.keys(amendCall.args).sort()).toEqual(
      sqlParams("005_scope_membership.up.sql", "steward_scope_amend_remove").sort(),
    );
    await repo.counts("o1", "c1");
    const countsCall = calls[2]!;
    expect(countsCall.fn).toBe("steward_scope_counts");
    expect(Object.keys(countsCall.args).sort()).toEqual(
      sqlParams("005_scope_membership.up.sql", "steward_scope_counts").sort(),
    );
  });
});

describe("transport uncertainty vs known SQL answers (defect B)", () => {
  it("reinstate sends exactly steward_scope_amend_reinstate's parameters", async () => {
    const { client, calls } = mockSupabase({
      id: "i1",
      organization_id: "o1",
      conversation_id: "c1",
      task_id: "t1",
      classification: "manual_required",
      removed_at: null,
      removal_reason: null,
    });
    const repo = createSupabaseScopeRepository(client as never);
    await repo.amendReinstate({
      orgId: "o1",
      conversationId: "c1",
      itemId: "i1",
      reason: "reinstating after review",
      operationId: "op-9",
    });
    expect(calls[0]!.fn).toBe("steward_scope_amend_reinstate");
    expect(Object.keys(calls[0]!.args).sort()).toEqual(
      sqlParams("005_scope_membership.up.sql", "steward_scope_amend_reinstate").sort(),
    );
  });

  it("a lost transport response after the request was sent is UNCERTAIN, never rejected", async () => {
    const { verifyCanonicalTask } = await import("./steward-verification.server");
    const repo = {
      verifyTask: vi.fn(async () => {
        throw new Error("network response lost after request sent");
      }),
    };
    const result = await verifyCanonicalTask(repo as never, {
      orgId: "o1",
      taskId: "t1",
      expectedRevision: 3,
      note: "fictional evidence note",
      operationId: "op-1",
      actorId: "u1",
    });
    expect(result.kind).toBe("uncertain");
    /* Raw internals never leak into the uncertain message. */
    if (result.kind === "uncertain") {
      expect(result.message).not.toContain("network response lost");
    }
  });

  it("a known SQL validation answer stays a resolved rejection", async () => {
    const { verifyCanonicalTask } = await import("./steward-verification.server");
    const error = new Error("revision_conflict") as Error & { code: string };
    error.code = "P0001";
    const repo = {
      verifyTask: vi.fn(async () => {
        throw error;
      }),
    };
    const result = await verifyCanonicalTask(repo as never, {
      orgId: "o1",
      taskId: "t1",
      expectedRevision: 3,
      note: "fictional evidence note",
      operationId: "op-1",
      actorId: "u1",
    });
    expect(result.kind).toBe("revision_conflict");
  });

  it("a same-id retry after an uncertain verify replays — the SQL returns the existing receipt, no second mutation", async () => {
    /* The SQL steward_verify_task is idempotent per operation UUID (harness
       002 proves it in PostgreSQL); here the adapter must forward the SAME
       operation id on retry so that guarantee can engage. */
    const { client, calls } = mockSupabase({ task: null, receipt: RECEIPT_ROW, replayed: true });
    const repo = createSupabaseVerificationRepository(client as never);
    const input = {
      orgId: "o1",
      taskId: "t1",
      expectedRevision: 3,
      note: "fictional evidence note",
      operationId: "op-1",
      actorId: "u1",
    };
    await repo.verifyTask(input);
    await repo.verifyTask(input);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.args).toEqual(calls[1]!.args);
    expect(calls[0]!.args["p_operation"]).toBe("op-1");
  });
});
