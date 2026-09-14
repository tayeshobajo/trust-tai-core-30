/**
 * Comms review, at the boundary rather than in the domain.
 *
 * These tests stand a fake Supabase and a fake model in front of the real
 * server module, because the promises this slice makes are boundary promises:
 * who is allowed to write, what happens when a read fails, what the reviewer
 * is actually told about the author, and whether a run that could not save
 * its evidence is ever allowed to look complete. None of that is visible from
 * a pure-domain test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/trust-tai-backend.server", () => ({
  trustTaiSupabaseUrl: () => "https://project.supabase.co",
  trustTaiSupabaseKey: () => "anon_key",
}));

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));

const { callModel, runtimeModelCaller } = vi.hoisted(() => {
  const callModel = vi.fn();
  return { callModel, runtimeModelCaller: vi.fn(async () => callModel) };
});
vi.mock("@/lib/intelligence-runtime.server", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, runtimeModelCaller };
});

import { ReviewFailure, runReview } from "@/lib/comms-review.server";

/* --------------------------------------------------------------- fixtures */

const ORG = "org-1";
const USER = "user-1";
const SESSION = "session-1";
const VERSION = "version-1";
/** The teammate who actually wrote the draft. The caller is only reviewing it. */
const AUTHOR = "author-2";

type Result = { data: unknown; error: unknown };
const ok = (data: unknown = null): Result => ({ data, error: null });
const boom = (message: string): Result => ({ data: null, error: { message } });

interface TableStub {
  /** What a read of this table returns; may depend on the `eq` filters used. */
  read?: Result | ((filters: Record<string, unknown>) => Result);
  /** What an insert returns, and a place to record what was attempted. */
  insert?: Result;
  /** What an update returns. */
  update?: Result;
}

interface Attempt {
  table: string;
  op: "insert" | "update";
  payload: unknown;
}

/** A chainable query double: enough of PostgREST's shape to be honest. */
function chain(
  result: Result | ((filters: Record<string, unknown>) => Result),
  filters: Record<string, unknown> = {},
): Record<string, unknown> {
  const node: Record<string, unknown> = {};
  for (const method of ["select", "in", "is", "neq", "order", "limit"]) {
    node[method] = () => node;
  }
  node["eq"] = (column: string, value: unknown) => {
    filters[column] = value;
    return node;
  };
  const settle = () => (typeof result === "function" ? result(filters) : result);
  node["maybeSingle"] = async () => settle();
  node["single"] = async () => settle();
  node["then"] = (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(settle()).then(resolve, reject);
  return node;
}

function fakeClient(tables: Record<string, TableStub>, attempts: Attempt[], user: string | null) {
  return {
    auth: {
      getUser: async () =>
        user
          ? { data: { user: { id: user } }, error: null }
          : { data: { user: null }, error: null },
    },
    from(table: string) {
      const stub = tables[table] ?? {};
      const node = chain(stub.read ?? ok([]), {});
      node["insert"] = (payload: unknown) => {
        attempts.push({ table, op: "insert", payload });
        return chain(stub.insert ?? ok(null));
      };
      node["update"] = (payload: unknown) => {
        attempts.push({ table, op: "update", payload });
        return chain(stub.update ?? ok(null));
      };
      return node;
    },
  };
}

const MEMBERSHIP = (status: string | null, role = "owner") =>
  ok(status === null ? { role } : { role, status });

function baseTables(over: Record<string, TableStub> = {}): Record<string, TableStub> {
  return {
    organization_memberships: { read: MEMBERSHIP("active") },
    profiles: {
      read: (filters) =>
        filters["id"] === AUTHOR
          ? ok({ id: AUTHOR, full_name: "Priya Raman", email: "priya@trusttai.example" })
          : ok({ id: USER, full_name: "Sam Ellis", email: "sam@trusttai.example" }),
    },
    comms_voice_profiles: {
      read: ok({
        id: "voice-1",
        title: "Voice DNA",
        content_markdown: "Write plainly. Never pad a sentence.",
        version: 3,
      }),
    },
    comms_drafts: { read: ok([{ subject: "Re: dates", body: "The date is the 4th." }]) },
    comms_review_sessions: {
      read: ok({
        id: SESSION,
        organization_id: ORG,
        situation: "She asked twice for the date.",
        goal: "Give her the date.",
        recipient_name: "Megan Walls",
        recipient_email: "megan@northlight.example",
        status: "open",
        context_revision: 2,
        created_at: "2026-09-14T09:00:00.000Z",
        updated_at: "2026-09-14T09:00:00.000Z",
      }),
    },
    comms_review_versions: {
      read: ok({
        id: VERSION,
        session_id: SESSION,
        organization_id: ORG,
        version: 1,
        author_user_id: AUTHOR,
        subject: "Re: dates",
        body: "The migration finishes on 4 October. Cost stays as quoted.",
        created_at: "2026-09-14T09:05:00.000Z",
      }),
    },
    comms_review_sources: {
      read: ok([
        {
          id: "source-1",
          label: "Her email",
          status: "parsed",
          status_note: "",
          checksum: "abc",
          content: "When does the migration finish?",
        },
      ]),
    },
    comms_review_runs: {
      insert: ok({
        id: "run-1",
        session_id: SESSION,
        version_id: VERSION,
        status: "running",
        context_revision: 2,
        started_at: "2026-09-14T09:06:00.000Z",
        stages: [],
        coverage: {},
        limitations: [],
      }),
    },
    comms_review_findings: { insert: ok(null), read: ok([]) },
    comms_review_obligations: { insert: ok(null) },
    ...over,
  };
}

const MODEL_ANSWER = {
  raw: JSON.stringify({
    summary: "Fit to send.",
    goalRead: "Give her the date.",
    findings: [
      {
        kind: "tone",
        severity: "note",
        excerpt: "Cost stays as quoted.",
        why: "Reads a little flat.",
      },
    ],
    obligations: [
      {
        obligationId: "source-1:0",
        status: "answered",
        answerQuote: "The migration finishes on 4 October.",
        because: "The date is given.",
      },
    ],
    limitations: [],
  }),
  provider: "lovable",
  model: "openai/gpt-5-mini",
};

function run(tables: Record<string, TableStub>, user: string | null = USER) {
  const attempts: Attempt[] = [];
  createClient.mockImplementation(() => fakeClient(tables, attempts, user));
  return {
    attempts,
    call: () => runReview("token", { organizationId: ORG, sessionId: SESSION, versionId: VERSION }),
  };
}

async function failureOf(promise: Promise<unknown>): Promise<ReviewFailure> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ReviewFailure) return error;
    throw error;
  }
  throw new Error("expected the review to fail, but it succeeded");
}

/* ------------------------------------------------------------------ tests */

describe("runReview at the server boundary", () => {
  beforeEach(() => {
    process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"] = "service_key";
    callModel.mockResolvedValue(MODEL_ANSWER);
  });
  afterEach(() => {
    delete process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"];
    delete process.env["SUPABASE_SERVICE_ROLE_KEY"];
    createClient.mockReset();
    callModel.mockReset();
  });

  it("saves the run, its findings and its coverage, and only then completes", async () => {
    const { attempts, call } = run(baseTables());
    const result = await call();

    expect(result.runId).toBe("run-1");
    const order = attempts.map((attempt) => `${attempt.op}:${attempt.table}`);
    expect(order).toEqual([
      "insert:comms_review_runs",
      "insert:comms_review_findings",
      "insert:comms_review_obligations",
      "update:comms_review_runs",
    ]);
    const completion = attempts.at(-1)?.payload as Record<string, unknown>;
    expect(completion["status"]).toBe("complete");
    expect(completion["provider"]).toBe("lovable");
  });

  it("refuses before calling the model when the source material cannot be read", async () => {
    const { attempts, call } = run(
      baseTables({ comms_review_sources: { read: boom("permission denied") } }),
    );
    const failure = await failureOf(call());

    expect(failure.code).toBe("review_unreadable");
    expect(callModel).not.toHaveBeenCalled();
    expect(attempts).toEqual([]);
  });

  it("never completes a run whose evidence could not be saved", async () => {
    const { attempts, call } = run(
      baseTables({ comms_review_findings: { insert: boom("insert failed") } }),
    );
    const failure = await failureOf(call());

    expect(failure.code).toBe("write_failed");
    const updates = attempts.filter((attempt) => attempt.op === "update");
    expect(updates).toHaveLength(1);
    expect((updates[0]?.payload as Record<string, unknown>)["status"]).toBe("failed");
    expect(failure.message).toMatch(/recorded as failed/i);
  });

  it("says so plainly when even the failure could not be recorded", async () => {
    const { call } = run(
      baseTables({
        comms_review_findings: { insert: boom("insert failed") },
        comms_review_runs: {
          insert: baseTables()["comms_review_runs"]?.insert ?? ok(null),
          update: boom("update failed"),
        },
      }),
    );
    const failure = await failureOf(call());
    expect(failure.message).toMatch(/could not even be recorded/i);
  });

  it("fails honestly when the server has no writing credentials", async () => {
    delete process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"];
    const { attempts, call } = run(baseTables());
    const failure = await failureOf(call());

    expect(failure.code).toBe("server_not_configured");
    expect(callModel).not.toHaveBeenCalled();
    expect(attempts).toEqual([]);
  });

  it.each([
    ["invited", MEMBERSHIP("invited")],
    ["suspended", MEMBERSHIP("suspended")],
    ["blank", MEMBERSHIP("")],
    ["missing altogether", MEMBERSHIP(null)],
  ])("refuses a membership that is %s, not active", async (_label, membership) => {
    const { attempts, call } = run(baseTables({ organization_memberships: { read: membership } }));
    const failure = await failureOf(call());

    expect(failure.code).toBe("access_denied");
    expect(attempts).toEqual([]);
  });

  it("refuses someone with no membership of this workspace", async () => {
    const { call } = run(baseTables({ organization_memberships: { read: ok(null) } }));
    expect((await failureOf(call())).code).toBe("access_denied");
  });

  it("refuses when there is no signed-in person at all", async () => {
    const { call } = run(baseTables(), null);
    expect((await failureOf(call())).code).toBe("access_denied");
  });

  it("abandons a run whose context moved between reading and starting", async () => {
    const { attempts, call } = run(
      baseTables({
        comms_review_runs: {
          insert: ok({
            id: "run-1",
            session_id: SESSION,
            version_id: VERSION,
            status: "running",
            /* The session said 2 a moment ago; the database stamped 5. */
            context_revision: 5,
            started_at: "2026-09-14T09:06:00.000Z",
            stages: [],
            coverage: {},
            limitations: [],
          }),
        },
      }),
    );
    const failure = await failureOf(call());

    expect(failure.code).toBe("stale_version");
    expect(callModel).not.toHaveBeenCalled();
    const updates = attempts.filter((attempt) => attempt.op === "update");
    expect((updates[0]?.payload as Record<string, unknown>)["error_code"]).toBe("context_changed");
  });

  it("tells the reviewer the real author and the workspace's stored voice rules", async () => {
    const { attempts, call } = run(baseTables());
    await call();

    const packet = JSON.parse(String(callModel.mock.calls[0]?.[0]?.input)) as Record<
      string,
      Record<string, unknown>
    >;
    expect(packet["writtenBy"]?.["name"]).toBe("Priya Raman");
    expect(String(packet["writtenBy"]?.["note"])).not.toMatch(/Tai/);
    expect(packet["reviewedBy"]?.["name"]).toBe("Sam Ellis");
    expect(String(packet["reviewedBy"]?.["note"])).toMatch(/not the author/i);
    expect(packet["voice"]?.["rules"]).toBe("Write plainly. Never pad a sentence.");
    expect(packet["voice"]?.["version"]).toBe(3);
    expect(String(packet["voice"]?.["note"])).toMatch(/read-only/i);
    expect(packet["situation"]).toBe("She asked twice for the date.");

    const startedRun = attempts[0]?.payload as Record<string, unknown>;
    expect(startedRun["stages"]).toContain("voice_profile:voice-1@v3");
  });

  it("never carries another client's words in as a style example", async () => {
    const leak = {
      subject: "Northwind renewal",
      body: "Northwind's renewal is 12 March and the price is 48,000.",
    };
    const { call } = run(baseTables({ comms_drafts: { read: ok([leak]) } }));
    await call();

    const sent = String(callModel.mock.calls[0]?.[0]?.input);
    expect(sent).not.toMatch(/Northwind/);
    expect(sent).not.toMatch(/48,000/);
    const packet = JSON.parse(sent) as Record<string, Record<string, unknown>>;
    expect(packet["voice"]?.["styleExamples"]).toEqual([]);
    expect(String(packet["voice"]?.["styleExamplesNote"])).toMatch(/other people's names/i);
    expect(String(packet["voice"]?.["note"])).toMatch(/style only/i);
  });

  it("changes the voice stamp when the rules text changes without a version bump", async () => {
    const first = run(baseTables());
    await first.call();
    const stampOne = (first.attempts[0]?.payload as Record<string, unknown>)["stages"];

    const second = run(
      baseTables({
        comms_voice_profiles: {
          read: ok({
            id: "voice-1",
            title: "Voice DNA",
            content_markdown: "Write plainly. Never pad a sentence. Never flatter.",
            version: 3,
          }),
        },
      }),
    );
    await second.call();
    const stampTwo = (second.attempts[0]?.payload as Record<string, unknown>)["stages"];
    expect(stampTwo).not.toEqual(stampOne);
  });

  it("discloses the fallback instead of claiming a calibrated voice", async () => {
    const { attempts, call } = run(
      baseTables({ comms_voice_profiles: { read: boom("not readable") } }),
    );
    await call();

    const packet = JSON.parse(String(callModel.mock.calls[0]?.[0]?.input)) as Record<
      string,
      Record<string, unknown>
    >;
    expect(String(packet["voice"]?.["status"])).toMatch(/No stored voice rules/i);
    expect(packet["voice"]?.["rules"]).toBeNull();
    expect((attempts[0]?.payload as Record<string, unknown>)["stages"]).toContain(
      "voice_profile:none",
    );
  });
});
