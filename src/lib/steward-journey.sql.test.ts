/**
 * REAL SQL journey for the staged Steward backend — NOT a Map mock and
 * NOT a reimplemented repository.
 *
 * Runs only when STEWARD_JOURNEY_DB points at a disposable PostgreSQL that
 * has the harness fixture plus the UNAPPLIED patches 001–005 and the local
 * review grants applied (the harness does exactly this; see
 * docs/proposed/steward-backend/harness/tests/007_adapter_journey.sh).
 * Without that env var every test here is skipped.
 *
 * The ACTUAL Supabase adapters (steward-canonical-run.supabase.ts,
 * steward-verification.supabase.ts, steward-proposal-ledger.supabase.ts)
 * are imported and driven over a narrow psql-backed transport that
 * implements only `rpc(name, args)` and
 * `from(table).select(cols).eq(...).single()/maybeSingle()` — so SQL↔TS
 * mapping defects cannot hide behind duplicated mapping code. The
 * provider is fake; no model is ever called.
 */

import { execFileSync } from "node:child_process";
import { describe, expect, test } from "vitest";

import { createSupabaseCanonicalRunRepository } from "./steward-canonical-run.supabase";
import { createSupabaseVerificationRepository } from "./steward-verification.supabase";
import { createSupabaseProposalLedgerRepository } from "./steward-proposal-ledger.supabase";
import {
  authorizeWorkerEndpoint,
  executeCanonicalRun,
  OperationConflictError,
  type CanonicalRunProvider,
  type CanonicalRunRepository,
} from "./steward-canonical-run.server";
import { verifyCanonicalTask, reopenCanonicalTask } from "./steward-verification.server";
import {
  registerExtractedProposals,
  dismissLedgerProposal,
} from "./steward-proposal-ledger.server";
import { parseStoredConversation } from "./steward-proposal-ledger.functions";
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
  return psql(`set role authenticated; select public.test_act_as(${lit(userId)}); ${statement}`);
}

function asWorker(statement: string): string {
  return psql(`select public.test_act_as_worker(); set role service_role; ${statement}`);
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

/** Declared positional parameter order per proposed function. */
const PARAM_ORDER: Record<string, string[]> = {
  steward_request_canonical_run: ["p_org", "p_task", "p_action", "p_operation", "p_input_refs"],
  steward_claim_canonical_run: ["p_run", "p_lease_seconds"],
  steward_complete_canonical_run: ["p_run", "p_claim_token", "p_artifact", "p_evidence_refs"],
  steward_fail_canonical_run: ["p_run", "p_claim_token", "p_reason", "p_known_pre_call"],
  steward_uncertain_canonical_run: ["p_run", "p_claim_token", "p_reason"],
  steward_verify_task: ["p_org", "p_task", "p_expected_revision", "p_operation", "p_note"],
  steward_reopen_task: ["p_org", "p_task", "p_expected_revision", "p_operation", "p_reason"],
  steward_register_proposals: [
    "p_org",
    "p_conversation",
    "p_operation",
    "p_proposals",
    "p_transcript",
  ],
  steward_dismiss_proposal: ["p_org", "p_conversation", "p_proposal", "p_reason", "p_operation"],
};

function sqlArg(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return lit(value);
  return `${lit(JSON.stringify(value))}::jsonb`;
}

interface TransportResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}

/**
 * Narrow psql-backed transport implementing exactly the surface the real
 * Supabase adapters use: rpc(name, args) and a from()/select()/eq() query
 * builder with single()/maybeSingle()/awaitable terminals.
 */
function createPsqlTransport(role: "authenticated" | "service", userId?: string) {
  const run = (statement: string): TransportResult => {
    try {
      const raw = role === "service" ? asWorker(statement) : asUser(userId!, statement);
      return { data: raw ? parseJson<unknown>(raw) : null, error: null };
    } catch (error) {
      const err = error as SqlError;
      return {
        data: null,
        error: {
          ...(err.code !== undefined ? { code: err.code } : {}),
          message: err.message,
        },
      };
    }
  };
  return {
    async rpc(name: string, args: Record<string, unknown>): Promise<TransportResult> {
      const order = PARAM_ORDER[name];
      if (!order) throw new Error(`no param order registered for ${name}`);
      const positional = order.map((p) => sqlArg(args[p])).join(", ");
      return run(`select to_jsonb(public.${name}(${positional}))`);
    },
    from(table: string) {
      return {
        select(cols: string) {
          const conditions: string[] = [];
          const sql = () =>
            `select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (select ${cols} from public.${table} where ${conditions.join(" and ")}) t`;
          const rows = (): TransportResult => run(sql());
          const chain = {
            eq(col: string, val: string) {
              conditions.push(`${col} = ${lit(val)}`);
              return chain;
            },
            async single(): Promise<TransportResult> {
              const result = rows();
              const list = result.data as unknown[] | null;
              return result.error
                ? result
                : { data: list && list.length > 0 ? list[0] : null, error: null };
            },
            async maybeSingle(): Promise<TransportResult> {
              const result = rows();
              const list = result.data as unknown[] | null;
              return result.error
                ? result
                : { data: list && list.length > 0 ? list[0] : null, error: null };
            },
            then(onFulfilled?: (value: TransportResult) => unknown) {
              return Promise.resolve(rows()).then(onFulfilled);
            },
          };
          return chain;
        },
      };
    },
  };
}

/** eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow test transport */
type AnyClient = any;

function userClient(userId: string): AnyClient {
  return createPsqlTransport("authenticated", userId);
}

function workerClient(): AnyClient {
  return createPsqlTransport("service");
}

/**
 * The real run adapter, composed exactly like the production handler:
 * request/title reads run as the authenticated caller (RLS), worker
 * transitions run as service_role.
 */
function createJourneyRunRepository(actorId: string): CanonicalRunRepository {
  const asActor = createSupabaseCanonicalRunRepository(userClient(actorId));
  const asWorkerRepo = createSupabaseCanonicalRunRepository(workerClient());
  return {
    requestRun: (input) => asActor.requestRun(input),
    readTaskTitle: (taskId, orgId) => asActor.readTaskTitle(taskId, orgId),
    readInput: () => asActor.readInput(),
    claimRun: (runId, actor, lease) => asWorkerRepo.claimRun(runId, actor, lease),
    completeRun: (input) => asWorkerRepo.completeRun(input),
    failRun: (input) => asWorkerRepo.failRun(input),
    markRunUncertain: (input) => asWorkerRepo.markRunUncertain(input),
  };
}

/** Narrow psql-backed fake of the RLS query builder authorizeWorkerEndpoint uses. */
type RlsChain = {
  eq(col: string, val: string): RlsChain;
  maybeSingle(): Promise<{ data: Record<string, unknown> | null }>;
};

function createPsqlRlsClient(callerId: string) {
  return userClient(callerId) as {
    from(table: string): { select(cols: string): RlsChain };
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

describe("steward SQL journey (real disposable PostgreSQL, real adapters)", () => {
  journey("request → replay → claim → artifact → verify → replay → reopen", async () => {
    const runRepo = createJourneyRunRepository(OWNER);
    const verifyRepo = createSupabaseVerificationRepository(userClient(OWNER));

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
    const taskBefore = await runRepo.readTaskTitle(TASK, ORG);
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
    if (verified.kind !== "verified")
      throw new Error(`verify rejected: ${JSON.stringify(verified)}`);
    expect(verified.replayed).toBe(false);
    expect(verified.task?.status).toBe("complete");
    expect(verified.receipt.note).toContain("Reviewed the draft brief");

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

  journey("proposal ledger: real stored conversation identity, real extraction", async () => {
    // A REAL-shape NormalizedConversation as saveConversation stores it:
    // externalId DIFFERENT from the DB UUID, nonzero segment offsets,
    // participants, and a provider action item (guarantees a proposal so
    // this test can never pass vacuously).
    const storedConversation: NormalizedConversation = {
      sourceRef: {
        provider: "fathom",
        externalId: "fathom-rec-98765",
        shareToken: "shr-abc123",
        url: "https://fathom.video/share/shr-abc123",
      },
      title: "Soji roadmap call",
      occurredAt: "2026-10-01T14:00:00.000Z",
      participants: [
        { name: "Tai", email: "tai@trusttai.com", emailDomain: "trusttai.com" },
        { name: "Soji Client", email: "client@soji.example", emailDomain: "soji.example" },
      ],
      segments: [
        { index: 0, speaker: "Tai", at: "00:39:48", text: "We will prepare the roadmap draft." },
        { index: 1, speaker: "Soji Client", at: "00:40:03", text: "Yes, agreed." },
      ],
      sourceActionItems: [
        {
          description: "Prepare the Soji roadmap draft",
          assigneeName: "Tai",
          at: "00:39:48",
          url: "https://fathom.video/share/shr-abc123?t=2388",
        },
      ],
    };
    // Store it in the disposable DB exactly as saveConversation would.
    asWorker(
      `update public.conversations set transcript = ${lit(JSON.stringify(storedConversation))}::jsonb where id = ${lit(CONVERSATION)}`,
    );

    // Read back through the caller's RLS view and validate the exact
    // stored object — no reconstruction, no fabricated identity.
    const storedRaw = parseJson<unknown>(
      asUser(OWNER, `select transcript from public.conversations where id = ${lit(CONVERSATION)}`),
    );
    const stored = parseStoredConversation(storedRaw);
    expect(stored, "stored conversation must validate").not.toBeNull();
    expect(stored!.sourceRef.externalId).toBe("fathom-rec-98765");
    expect(stored!.sourceRef.shareToken).toBe("shr-abc123");
    expect(stored!.participants).toHaveLength(2);
    expect(stored!.segments[1]!.at).toBe("00:40:03");

    // Extraction runs over the EXACT stored object; assert equality with
    // a direct extraction of the same object, and that it is non-vacuous.
    const direct = extractProposals(stored!);
    expect(direct.length).toBeGreaterThan(0);
    expect(direct.some((p) => p.evidence.length > 0)).toBe(true);

    // Invalid stored shapes fail closed.
    expect(parseStoredConversation({ segments: [] })).toBeNull();
    expect(parseStoredConversation({ sourceRef: { provider: "fathom" } })).toBeNull();

    const ledgerRepo = createSupabaseProposalLedgerRepository(userClient(OWNER));
    const registered = await registerExtractedProposals(ledgerRepo, {
      orgId: ORG,
      conversationId: CONVERSATION,
      operationId: "e7a00000-0000-0000-0000-000000000004",
      proposals: direct.map((p) => ({
        id: p.id,
        kind: p.kind,
        statement: p.statement,
        evidence: p.evidence,
      })),
      transcript: storedRaw,
      actorId: OWNER,
    });
    expect(registered.kind).toBe("registered");
    if (registered.kind === "registered") {
      expect(registered.added).toBe(direct.length);
    }

    const ledger = await ledgerRepo.ledgerForConversation(ORG, CONVERSATION);
    // Earlier harness suites legitimately registered proposals for this
    // conversation too; assert every freshly extracted key is present.
    for (const proposal of direct) {
      expect(
        ledger.some((row) => row.sourceKey === proposal.id),
        `ledger must contain ${proposal.id}`,
      ).toBe(true);
    }
    // Evidence refs are retained for review, not discarded.
    expect(ledger.some((p) => (p.evidence?.length ?? 0) > 0)).toBe(true);

    const pending = ledger.filter((p) => p.status === "proposed");
    expect(pending.length).toBeGreaterThan(0);
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
  });

  journey("expired running lease terminalizes as uncertain — never re-executed", async () => {
    const runRepo = createJourneyRunRepository(OWNER);
    const requested = await runRepo.requestRun({
      orgId: ORG,
      taskId: TASK,
      action: "prepare_brief",
      operationId: "e7a00000-0000-0000-0000-000000000010",
      digest: "",
      inputRefs: [{ kind: "transcript", id: CONVERSATION }],
      actorId: OWNER,
    });
    // Claim with a 1-second lease, then let it expire WITHOUT completing —
    // simulating a worker that crashed after the provider call started.
    const claimed = await runRepo.claimRun(requested.run.id, OWNER, 1);
    expect(claimed?.status).toBe("running");
    asWorker(`select pg_sleep(1.2)`);

    // A second worker claims: the expired running lease is terminalized as
    // uncertain and NO claim is granted — zero provider calls happen.
    const calls = { count: 0 };
    const second = await executeCanonicalRun(runRepo, fakeProvider(calls), {
      runId: requested.run.id,
      actorId: OWNER,
    });
    expect(calls.count).toBe(0);
    expect(second.kind).toBe("not_claimed");
    const state = asWorker(
      `select status || '|' || failure_reason from public.steward_canonical_runs where id = ${lit(requested.run.id)}`,
    );
    expect(state.startsWith("failed|uncertain:")).toBe(true);
  });
});
