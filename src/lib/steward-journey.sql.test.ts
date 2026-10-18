/**
 * REAL SQL journey for the staged Steward backend — NOT a Map mock.
 *
 * Runs only when STEWARD_JOURNEY_DB points at a disposable PostgreSQL that
 * has the harness fixture plus the UNAPPLIED patches 001–005 and the local
 * review grants applied (the harness does exactly this; see
 * docs/proposed/steward-backend/harness/tests/007_adapter_journey.sh).
 * Without that env var every test here is skipped.
 *
 * The repositories below implement the SAME interfaces as the Supabase
 * adapters (steward-canonical-run.supabase.ts, steward-verification.
 * supabase.ts, steward-proposal-ledger.supabase.ts) over a narrow
 * psql-backed transport, so SQL↔TS mapping defects cannot hide behind
 * in-memory fakes. The provider is fake; no model is ever called.
 */

import { execFileSync } from "node:child_process";
import { describe, expect, test } from "vitest";

import {
  authorizeWorkerEndpoint,
  executeCanonicalRun,
  type CanonicalRun,
  type CanonicalRunRepository,
  OperationConflictError,
} from "./steward-canonical-run.server";
import type { CanonicalRunProvider } from "./steward-canonical-run.server";
import {
  verifyCanonicalTask,
  reopenCanonicalTask,
  type VerificationRepository,
} from "./steward-verification.server";
import {
  registerExtractedProposals,
  dismissLedgerProposal,
  type ProposalLedgerRepository,
} from "./steward-proposal-ledger.server";
import { extractProposals } from "@/data/steward/extract";
import type { NormalizedConversation } from "@/domain/steward";

const DB = process.env["STEWARD_JOURNEY_DB"];
const journey = DB ? test : test.skip;

const ORG = "11111111-1111-1111-1111-111111111111";
const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const MEMBER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const VIEWER = "dddddd00-0000-0000-0000-000000000001";
const CROSS_ORG = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const TASK = "10000000-0000-0000-0000-000000000001";
const CONVERSATION = "dddddddd-dddd-dddd-dddd-dddddddddddd";

/* ------------------------------------------------------------ transport */

function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

class SqlError extends Error {
  code?: string;
}

function psql(statements: string): string {
  try {
    const out = execFileSync(
      "psql",
      [DB!, "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-c", statements],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const lines = out.split("\n").filter((line) => line.trim().length > 0);
    return lines[lines.length - 1] ?? "";
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? "";
    const err = new SqlError(stderr.trim() || "psql failed");
    const state = stderr.match(/SQLSTATE:\s*([0-9A-Z]{5})/)?.[1];
    if (state) err.code = state;
    if (stderr.includes("operation_conflict")) err.code = "P0002";
    if (stderr.includes("transcript_changed")) err.code = "P0001";
    throw err;
  }
}

function asUser(userId: string, statement: string): string {
  return psql(
    `set role authenticated; select public.test_act_as(${lit(userId)}); ${statement}`,
  );
}

function asWorker(statement: string): string {
  return psql(`select public.test_act_as_worker(); set role service_role; ${statement}`);
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

/* ------------------------------------------------------------- mapping */

interface RunRow {
  id: string;
  organization_id: string;
  task_id: string;
  action: CanonicalRun["action"];
  client_operation_id: string;
  request_digest: string;
  input_snapshot: CanonicalRun["inputSnapshot"];
  status: CanonicalRun["status"];
  artifact_text: string | null;
  artifact_digest: string | null;
  evidence_refs: string[];
  requested_by: string;
  attempts: number;
  max_attempts: number;
  failure_reason: string | null;
  claim_token: string | null;
  claim_version: number;
}

function mapRun(row: RunRow): CanonicalRun {
  return {
    id: row.id,
    organizationId: row.organization_id,
    taskId: row.task_id,
    action: row.action,
    clientOperationId: row.client_operation_id,
    requestDigest: row.request_digest,
    inputSnapshot: row.input_snapshot,
    status: row.status,
    artifactText: row.artifact_text,
    artifactDigest: row.artifact_digest,
    evidenceRefs: row.evidence_refs,
    requestedBy: row.requested_by,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    failureReason: row.failure_reason,
    claimToken: row.claim_token,
    claimVersion: row.claim_version,
  };
}

function rethrow(error: unknown): never {
  const err = error as { code?: string; message?: string };
  if (err.code === "P0002" || err.message?.includes("operation_conflict")) {
    throw new OperationConflictError("operation_conflict");
  }
  throw error;
}

/* --------------------------------------------------------- repositories */

function createPsqlRunRepository(actorId: string): CanonicalRunRepository {
  return {
    async requestRun(input) {
      try {
        const refs = JSON.stringify(
          input.inputRefs.map((r) => ({ kind: r.kind, id: r.id })),
        );
        const raw = asUser(
          actorId,
          `select public.steward_request_canonical_run(${lit(input.orgId)}, ${lit(input.taskId)}, ${lit(input.action)}, ${lit(input.operationId)}, ${lit(refs)}::jsonb)`,
        );
        const result = parseJson<{ run: RunRow; replayed: boolean }>(raw);
        return { run: mapRun(result.run), replayed: result.replayed === true };
      } catch (error) {
        rethrow(error);
      }
    },
    async claimRun(runId) {
      const raw = asWorker(
        `select row_to_json(f) from public.steward_claim_canonical_run(${lit(runId)}) f`,
      );
      if (!raw) return null;
      const row = parseJson<RunRow | null>(raw);
      return row?.id ? mapRun(row) : null;
    },
    async completeRun(input) {
      const raw = asWorker(
        `select row_to_json(f) from public.steward_complete_canonical_run(${lit(input.runId)}, ${lit(input.claimToken)}, ${lit(input.artifactText)}, ${lit(JSON.stringify(input.evidenceRefs))}::jsonb) f`,
      );
      return mapRun(parseJson<RunRow>(raw));
    },
    async failRun(input) {
      const raw = asWorker(
        `select row_to_json(f) from public.steward_fail_canonical_run(${lit(input.runId)}, ${lit(input.claimToken)}, ${lit(input.reason)}) f`,
      );
      return mapRun(parseJson<RunRow>(raw));
    },
    async markRunUncertain(input) {
      const raw = asWorker(
        `select row_to_json(f) from public.steward_uncertain_canonical_run(${lit(input.runId)}, ${lit(input.claimToken)}, ${lit(input.reason)}) f`,
      );
      return mapRun(parseJson<RunRow>(raw));
    },
    async readInput() {
      throw new Error("readInput is server-side only, same as the Supabase adapter");
    },
    async readTaskTitle(taskId, orgId) {
      const raw = asUser(
        actorId,
        `select title from public.steward_tasks where id = ${lit(taskId)} and organization_id = ${lit(orgId)}`,
      );
      return raw || null;
    },
  };
}

function createPsqlVerificationRepository(actorId: string): VerificationRepository {
  const readTask = (taskId: string) => {
    const raw = asUser(
      actorId,
      `select row_to_json(t) from (select id, status, revision, completion_evidence, completed_at, completed_by from public.steward_tasks where id = ${lit(taskId)} and organization_id = ${lit(ORG)}) t`,
    );
    if (!raw) return null;
    const row = parseJson<{
      id: string;
      status: "open" | "complete";
      revision: number;
      completion_evidence: string | null;
      completed_at: string | null;
      completed_by: string | null;
    }>(raw);
    return {
      id: row.id,
      status: row.status,
      revision: row.revision,
      completionEvidence: row.completion_evidence,
      completedAt: row.completed_at,
      completedBy: row.completed_by,
    };
  };
  return {
    async verifyTask(input) {
      const raw = asUser(
        actorId,
        `select public.steward_verify_task(${lit(input.orgId)}, ${lit(input.taskId)}, ${input.expectedRevision}, ${lit(input.operationId)}, ${lit(input.note)})`,
      );
      const result = parseJson<{ receipt: Record<string, unknown>; replayed: boolean }>(raw);
      const r = result.receipt;
      return {
        task: readTask(input.taskId),
        receipt: {
          id: r["id"] as string,
          organizationId: r["organization_id"] as string,
          taskId: r["task_id"] as string,
          operationId: r["operation_id"] as string,
          note: r["note"] as string,
          actorId: r["actor_id"] as string,
          createdAt: r["created_at"] as string,
        },
        replayed: result.replayed === true,
      };
    },
    async reopenTask(input) {
      const raw = asUser(
        actorId,
        `select public.steward_reopen_task(${lit(input.orgId)}, ${lit(input.taskId)}, ${input.expectedRevision}, ${lit(input.operationId)}, ${lit(input.reason)})`,
      );
      const result = parseJson<{ replayed: boolean }>(raw);
      return { task: readTask(input.taskId), replayed: result.replayed === true };
    },
  };
}

function createPsqlProposalLedgerRepository(actorId: string): ProposalLedgerRepository {
  return {
    async registerProposals(input) {
      const proposals = JSON.stringify(
        input.proposals.map((p) => ({
          source_key: p.sourceKey,
          kind: p.kind,
          statement: p.statement,
        })),
      );
      const raw = asUser(
        actorId,
        `select public.steward_register_proposals(${lit(input.orgId)}, ${lit(input.conversationId)}, ${lit(input.operationId)}, ${lit(proposals)}::jsonb, (select transcript from public.conversations where id = ${lit(input.conversationId)}))`,
      );
      return Number(raw);
    },
    async dismissProposal(input) {
      const raw = asUser(
        actorId,
        `select row_to_json(f) from public.steward_dismiss_proposal(${lit(input.orgId)}, ${lit(input.conversationId)}, ${lit(input.proposalId)}, ${lit(input.reason)}, ${lit(input.operationId)}) f`,
      );
      const row = parseJson<Record<string, unknown>>(raw);
      return {
        id: row["id"] as string,
        organizationId: row["organization_id"] as string,
        conversationId: row["conversation_id"] as string,
        sourceKey: row["source_key"] as string,
        kind: row["kind"] as string,
        statement: row["statement"] as string,
        status: row["status"] as "proposed" | "linked" | "dismissed",
      };
    },
    async ledgerForConversation(orgId, conversationId) {
      const raw = asUser(
        actorId,
        `select coalesce(jsonb_agg(row_to_json(l)), '[]'::jsonb) from (select id, organization_id, conversation_id, source_key, kind, statement, status from public.steward_proposal_ledger where organization_id = ${lit(orgId)} and conversation_id = ${lit(conversationId)}) l`,
      );
      const rows = parseJson<Record<string, unknown>[]>(raw);
      return rows.map((row) => ({
        id: row["id"] as string,
        organizationId: row["organization_id"] as string,
        conversationId: row["conversation_id"] as string,
        sourceKey: row["source_key"] as string,
        kind: row["kind"] as string,
        statement: row["statement"] as string,
        status: row["status"] as "proposed" | "linked" | "dismissed",
      }));
    },
  };
}

/** Narrow psql-backed fake of the RLS query builder authorizeWorkerEndpoint uses. */
function createPsqlRlsClient(callerId: string) {
  return {
    from(table: string) {
      return {
        select(cols: string) {
          const conditions: string[] = [];
          const build = () =>
            `select row_to_json(t) from (select ${cols} from public.${table} where ${conditions.join(" and ")}) t`;
          const chain: {
            eq: (col: string, val: string) => typeof chain;
            maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
          } = {
            eq(col: string, val: string) {
              conditions.push(`${col} = ${lit(val)}`);
              return chain;
            },
            async maybeSingle() {
              const raw = asUser(callerId, build());
              return { data: raw ? parseJson<Record<string, unknown>>(raw) : null };
            },
          };
          return chain;
        },
      };
    },
  };
}

/* ---------------------------------------------------------------- fakes */

function fakeProvider(calls: { count: number }): CanonicalRunProvider {
  return {
    async generate(input) {
      calls.count += 1;
      expect(input.taskTitle).toBe("Prepare Soji handoff");
      expect(input.inputs.length).toBeGreaterThan(0);
      expect(input.inputs[0]!.content.length).toBeGreaterThan(0);
      return {
        text: "Draft brief: synthetic preparation output for the Soji handoff.",
        evidenceRefs: input.inputs.map((i) => `${i.kind}:${i.id}`),
      };
    },
  };
}

/* ---------------------------------------------------------------- suite */

describe("steward SQL journey (real disposable PostgreSQL)", () => {
  journey("request → replay → claim → artifact → verify → replay → reopen", async () => {
    const runRepo = createPsqlRunRepository(OWNER);
    const verifyRepo = createPsqlVerificationRepository(OWNER);

    // 1. Request a canonical preparation run.
    const requested = await runRepo.requestRun({
      orgId: ORG,
      taskId: TASK,
      action: "prepare_brief",
      operationId: "e7a00000-0000-0000-0000-000000000001",
      digest: "",
      inputRefs: [{ kind: "transcript", id: CONVERSATION }],
      actorId: OWNER,
    });
    expect(requested.replayed).toBe(false);
    expect(requested.run.status).toBe("queued");
    expect(requested.run.inputSnapshot.length).toBe(1);
    expect(requested.run.inputSnapshot[0]!.content.length).toBeGreaterThan(0);

    // 2. Same operation + same payload replays the SAME run.
    const replay = await runRepo.requestRun({
      orgId: ORG,
      taskId: TASK,
      action: "prepare_brief",
      operationId: "e7a00000-0000-0000-0000-000000000001",
      digest: "",
      inputRefs: [{ kind: "transcript", id: CONVERSATION }],
      actorId: OWNER,
    });
    expect(replay.replayed).toBe(true);
    expect(replay.run.id).toBe(requested.run.id);

    // 3. Same operation + changed payload conflicts.
    await expect(
      runRepo.requestRun({
        orgId: ORG,
        taskId: TASK,
        action: "prepare_brief",
        operationId: "e7a00000-0000-0000-0000-000000000001",
        digest: "",
        inputRefs: [{ kind: "task_notes", id: TASK }],
        actorId: OWNER,
      }),
    ).rejects.toBeInstanceOf(OperationConflictError);

    // 4. Endpoint denials through the REAL authorization composition:
    //    viewer, unrelated member (not creator/owner), cross-org and a
    //    nonexistent run are all denied before any privileged call.
    for (const caller of [VIEWER, MEMBER, CROSS_ORG]) {
      const denial = await authorizeWorkerEndpoint(createPsqlRlsClient(caller), {
        runId: requested.run.id,
        callerId: caller,
      });
      expect("denial" in denial, `${caller} must be denied`).toBe(true);
    }
    const ghost = await authorizeWorkerEndpoint(createPsqlRlsClient(OWNER), {
      runId: "00000000-0000-0000-0000-000000000000",
      callerId: OWNER,
    });
    expect("denial" in ghost).toBe(true);
    const allowed = await authorizeWorkerEndpoint(createPsqlRlsClient(OWNER), {
      runId: requested.run.id,
      callerId: OWNER,
    });
    expect("run" in allowed).toBe(true);

    // 5. Claim + execute with a fake provider; the artifact is durable and
    //    the provider saw ONLY the immutable snapshot.
    const calls = { count: 0 };
    const executed = await executeCanonicalRun(runRepo, fakeProvider(calls), {
      runId: requested.run.id,
      actorId: OWNER,
    });
    expect(executed.kind).toBe("complete");
    expect(calls.count).toBe(1);
    if (executed.kind === "complete") {
      expect(executed.run.artifactText).toContain("synthetic preparation output");
      expect(executed.run.artifactDigest).toBeTruthy();
      expect(executed.run.evidenceRefs).toEqual([`transcript:${CONVERSATION}`]);
    }

    // 6. Verify the task atomically with substantive evidence. The
    //    revision is read live — earlier harness suites legitimately bump it.
    const taskBefore = await runRepo.readTaskTitle(TASK, ORG, OWNER);
    expect(taskBefore).toBe("Prepare Soji handoff");
    const revisionAtVerify = Number(
      asUser(OWNER, `select revision from public.steward_tasks where id = ${lit(TASK)}`),
    );
    const verified = await verifyCanonicalTask(verifyRepo, {
      orgId: ORG,
      taskId: TASK,
      expectedRevision: revisionAtVerify,
      operationId: "e7a00000-0000-0000-0000-000000000002",
      note: "Reviewed the draft brief against the recorded call; it matches.",
      actorId: OWNER,
    });
    if (verified.kind !== "verified") throw new Error(`verify rejected: ${JSON.stringify(verified)}`);
    expect(verified.kind).toBe("verified");
    if (verified.kind === "verified") {
      expect(verified.replayed).toBe(false);
      expect(verified.task?.status).toBe("complete");
      expect(verified.receipt.note).toContain("Reviewed the draft brief");
    }

    // 7. Verify replay: same operation returns the same receipt.
    const verifyReplay = await verifyCanonicalTask(verifyRepo, {
      orgId: ORG,
      taskId: TASK,
      expectedRevision: revisionAtVerify,
      operationId: "e7a00000-0000-0000-0000-000000000002",
      note: "Reviewed the draft brief against the recorded call; it matches.",
      actorId: OWNER,
    });
    expect(verifyReplay.kind).toBe("verified");
    if (verifyReplay.kind === "verified") expect(verifyReplay.replayed).toBe(true);

    // 8. Reopen with a substantive reason; history is preserved.
    const revisionAtReopen = Number(
      asUser(OWNER, `select revision from public.steward_tasks where id = ${lit(TASK)}`),
    );
    const reopened = await reopenCanonicalTask(verifyRepo, {
      orgId: ORG,
      taskId: TASK,
      expectedRevision: revisionAtReopen,
      operationId: "e7a00000-0000-0000-0000-000000000003",
      reason: "Scope changed in the follow-up call; the brief is outdated.",
      actorId: OWNER,
    });
    expect(reopened.kind).toBe("reopened");
    if (reopened.kind === "reopened") {
      expect(reopened.task?.status).toBe("open");
      expect(reopened.replayed).toBe(false);
    }
    const reopenReplay = await reopenCanonicalTask(verifyRepo, {
      orgId: ORG,
      taskId: TASK,
      expectedRevision: revisionAtReopen,
      operationId: "e7a00000-0000-0000-0000-000000000003",
      reason: "Scope changed in the follow-up call; the brief is outdated.",
      actorId: OWNER,
    });
    expect(reopenReplay.kind).toBe("reopened");
    if (reopenReplay.kind === "reopened") expect(reopenReplay.replayed).toBe(true);
  });

  journey("proposal ledger: real extraction output registers and dismisses", async () => {
    const ledgerRepo = createPsqlProposalLedgerRepository(OWNER);

    // Real extractor over the REAL stored transcript contract.
    const transcript = parseJson<{ segments: { speaker: string; text: string; offset: number }[] }>(
      asUser(
        OWNER,
        `select transcript from public.conversations where id = ${lit(CONVERSATION)}`,
      ),
    );
    const normalized: NormalizedConversation = {
      sourceRef: { provider: "fathom", externalId: CONVERSATION, url: "" },
      title: "Soji roadmap call",
      occurredAt: new Date(0).toISOString(),
      participants: [],
      sourceActionItems: [],
      segments: transcript.segments.map((s, index) => ({
        index,
        speaker: s.speaker,
        at: "00:00:00",
        text: s.text,
      })),
    };
    const proposals = extractProposals(normalized);

    const registered = await registerExtractedProposals(ledgerRepo, {
      orgId: ORG,
      conversationId: CONVERSATION,
      operationId: "e7a00000-0000-0000-0000-000000000004",
      proposals: proposals.map((p) => ({ id: p.id, kind: p.kind, statement: p.statement })),
      transcript,
      actorId: OWNER,
    });
    // The fixture transcript may legitimately yield zero proposals; the
    // contract under test is that registration runs the real extractor and
    // reports honestly.
    expect(registered.kind).toBe("registered");
    if (registered.kind === "registered") {
      expect(registered.added).toBe(proposals.length);
    }

    const ledger = await ledgerRepo.ledgerForConversation(ORG, CONVERSATION);
    const pending = ledger.filter((p) => p.status === "proposed");
    if (pending.length > 0) {
      const dismissed = await dismissLedgerProposal(ledgerRepo, {
        orgId: ORG,
        conversationId: CONVERSATION,
        proposalId: pending[0]!.id,
        reason: "Reviewed in the room: not an agreed action.",
        operationId: "e7a00000-0000-0000-0000-000000000005",
        actorId: OWNER,
      });
      expect(dismissed.kind).toBe("dismissed");
      // Decision audit persisted with the operation.
      const audit = asUser(
        OWNER,
        `select count(*) from public.steward_proposal_decisions where organization_id = ${lit(ORG)} and operation_id = 'e7a00000-0000-0000-0000-000000000005' and kind = 'dismiss'`,
      );
      expect(audit).toBe("1");
    }
  });
});
