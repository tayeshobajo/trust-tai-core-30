/**
 * Kept writing habits, at the boundary.
 *
 * The promises here are boundary promises: a habit can only come from a
 * decision in this workspace, bound to the run and session that decision
 * actually belongs to; the provenance written is the server's reading, never
 * the caller's claim; a read that fails is a refusal rather than a silent
 * skip; and the exact active set is part of the fingerprint a review is
 * judged against, so keeping or revoking one invalidates earlier evidence.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

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

import {
  lessonCategory,
  LESSON_CATALOGUE_VERSION,
} from "@/domain/comms-lessons";
import { promoteLesson, revokeLesson, ReviewFailure, runReview } from "@/lib/comms-review.server";

const ORG = "org-1";
const USER = "user-1";
const SESSION = "session-1";
const VERSION = "version-1";
const AUTHOR = "author-2";
const RUN = "run-1";
const FINDING = "finding-1";
const DECIDER = "decider-9";

type Result = { data: unknown; error: unknown; count?: number | null };
const ok = (data: unknown = null): Result => ({ data, error: null });
const boom = (message: string): Result => ({ data: null, error: { message } });

interface TableStub {
  read?: Result | ((filters: Record<string, unknown>) => Result);
  insert?: Result | ((payload: Record<string, unknown>) => Result);
  update?: Result;
}

interface Attempt {
  table: string;
  op: "insert" | "update";
  payload: Record<string, unknown>;
}

function chain(
  result: Result | ((filters: Record<string, unknown>) => Result),
  filters: Record<string, unknown> = {},
): Record<string, unknown> {
  const node: Record<string, unknown> = {};
  for (const method of ["select", "in", "is", "neq", "order", "limit", "range"]) {
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

function harness(tables: Record<string, TableStub>, user: string | null = USER) {
  const attempts: Attempt[] = [];
  createClient.mockImplementation(() => ({
    auth: {
      getUser: async () =>
        user ? { data: { user: { id: user } }, error: null } : { data: { user: null }, error: null },
    },
    from(table: string) {
      const stub = tables[table] ?? {};
      const node = chain(stub.read ?? ok([]), {});
      node["insert"] = (payload: unknown) => {
        const body = payload as Record<string, unknown>;
        attempts.push({ table, op: "insert", payload: body });
        const answer = typeof stub.insert === "function" ? stub.insert(body) : stub.insert;
        return chain(answer ?? ok(null));
      };
      node["update"] = (payload: unknown) => {
        attempts.push({ table, op: "update", payload: payload as Record<string, unknown> });
        return chain(stub.update ?? ok(null));
      };
      return node;
    },
  }));
  return attempts;
}

const lessonRow = (over: Record<string, unknown> = {}) => ({
  id: "lesson-1",
  organization_id: ORG,
  source_finding_id: FINDING,
  source_run_id: RUN,
  source_session_id: SESSION,
  category: "open_with_the_reason",
  source_note: "Worth considering: flat opener (edited)",
  decided_by: DECIDER,
  decided_at: "2026-09-16T08:00:00.000Z",
  private_note: "Acme prefers Tuesday",
  promoted_by: USER,
  promoted_by_role: "owner",
  promoted_at: "2026-09-16T09:00:00.000Z",
  revoked_at: null,
  revoked_by: null,
  ...over,
});

function promotionTables(over: Record<string, TableStub> = {}): Record<string, TableStub> {
  return {
    organization_memberships: { read: ok({ role: "owner", status: "active" }) },
    comms_review_findings: {
      read: (filters) =>
        filters["organization_id"] === ORG
          ? ok({
              id: FINDING,
              state: "edited",
              decided_by: DECIDER,
              decided_at: "2026-09-16T08:00:00.000Z",
              why: "flat opener",
              severity: "consider",
              run_id: RUN,
            })
          : ok(null),
    },
    comms_review_runs: {
      read: (filters) =>
        filters["organization_id"] === ORG
          ? ok({ id: RUN, session_id: SESSION, status: "complete" })
          : ok(null),
    },
    comms_review_lessons: { insert: ok(lessonRow()) },
    ...over,
  };
}

const failureOf = async (promise: Promise<unknown>): Promise<ReviewFailure> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ReviewFailure) return error;
    throw error;
  }
  throw new Error("expected a refusal");
};

beforeEach(() => {
  createClient.mockReset();
  callModel.mockReset();
});

describe("a habit may only come from a decision in this workspace", () => {
  it("refuses a finding that is not this organization's, and writes nothing", async () => {
    const attempts = harness(
      promotionTables({
        comms_review_findings: { read: ok(null) },
      }),
    );
    const failure = await failureOf(
      promoteLesson("token", { organizationId: ORG, findingId: FINDING, category: "keep_our_wording" }),
    );
    expect(failure.code).toBe("not_found");
    expect(attempts.filter((one) => one.table === "comms_review_lessons")).toHaveLength(0);
  });

  it("refuses when the run behind the decision is in another workspace", async () => {
    const attempts = harness(promotionTables({ comms_review_runs: { read: ok(null) } }));
    const failure = await failureOf(
      promoteLesson("token", { organizationId: ORG, findingId: FINDING, category: "keep_our_wording" }),
    );
    expect(failure.code).toBe("not_found");
    expect(failure.message).toMatch(/not in this workspace/i);
    expect(attempts.filter((one) => one.table === "comms_review_lessons")).toHaveLength(0);
  });

  it("refuses when the caller names a different draft than the run's own session", async () => {
    const attempts = harness(promotionTables());
    const failure = await failureOf(
      promoteLesson("token", {
        organizationId: ORG,
        findingId: FINDING,
        category: "keep_our_wording",
        sessionId: "someone-elses-session",
      }),
    );
    expect(failure.code).toBe("invalid");
    expect(attempts.filter((one) => one.table === "comms_review_lessons")).toHaveLength(0);
  });

  it("refuses a decision from a failed review", async () => {
    harness(
      promotionTables({
        comms_review_runs: { read: ok({ id: RUN, session_id: SESSION, status: "failed" }) },
      }),
    );
    const failure = await failureOf(
      promoteLesson("token", { organizationId: ORG, findingId: FINDING, category: "keep_our_wording" }),
    );
    expect(failure.message).toMatch(/failed/i);
  });

  it("refuses, rather than skipping, when the decision cannot be read", async () => {
    const attempts = harness(
      promotionTables({ comms_review_findings: { read: boom("connection reset") } }),
    );
    const failure = await failureOf(
      promoteLesson("token", { organizationId: ORG, findingId: FINDING, category: "keep_our_wording" }),
    );
    expect(failure.code).toBe("write_failed");
    expect(failure.message).toMatch(/nothing was kept/i);
    expect(attempts.filter((one) => one.table === "comms_review_lessons")).toHaveLength(0);
  });

  it("refuses free text, so a client fact can never be the reused guidance", async () => {
    const attempts = harness(promotionTables());
    const failure = await failureOf(
      promoteLesson("token", {
        organizationId: ORG,
        findingId: FINDING,
        category: "Acme prefers Tuesday",
      }),
    );
    expect(failure.code).toBe("invalid");
    expect(attempts.filter((one) => one.table === "comms_review_lessons")).toHaveLength(0);
  });
});

describe("the provenance written is the server's reading", () => {
  it("stores the decider, the run and the session it verified, not the caller's word", async () => {
    const attempts = harness(promotionTables());
    await promoteLesson("token", {
      organizationId: ORG,
      findingId: FINDING,
      category: "open_with_the_reason",
      sessionId: SESSION,
      privateNote: "Acme prefers Tuesday",
    });
    const write = attempts.find((one) => one.table === "comms_review_lessons");
    expect(write?.payload).toMatchObject({
      organization_id: ORG,
      source_finding_id: FINDING,
      source_run_id: RUN,
      source_session_id: SESSION,
      category: "open_with_the_reason",
      decided_by: DECIDER,
      promoted_by: USER,
      promoted_by_role: "owner",
    });
    /* The typed note is stored for people, and is not the reused guidance. */
    expect(write?.payload["private_note"]).toBe("Acme prefers Tuesday");
  });
});

/* ------------------------------------------------- the set, and the review */

function reviewTables(over: Record<string, TableStub> = {}): Record<string, TableStub> {
  return {
    organization_memberships: { read: ok({ role: "owner", status: "active" }) },
    profiles: {
      read: (filters) =>
        filters["id"] === AUTHOR
          ? ok({ id: AUTHOR, full_name: "Priya Raman", email: "priya@trusttai.example" })
          : ok({ id: USER, full_name: "Sam Ellis", email: "sam@trusttai.example" }),
    },
    comms_voice_profiles: {
      read: ok({ id: "voice-1", title: "Voice DNA", content_markdown: "Write plainly.", version: 3 }),
    },
    comms_drafts: { read: ok([{ subject: "Re: dates", body: "The date is the 4th." }]) },
    comms_review_sessions: {
      read: ok({
        id: SESSION,
        organization_id: ORG,
        situation: "She asked twice.",
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
        body: "The migration finishes on 4 October.",
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
        id: RUN,
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
    comms_review_lessons: { read: ok([]) },
    ...over,
  };
}

const MODEL_ANSWER = {
  raw: JSON.stringify({
    summary: "Fit to send.",
    goalRead: "Give her the date.",
    findings: [],
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

async function runWith(lessons: Result) {
  const attempts = harness(reviewTables({ comms_review_lessons: { read: lessons } }));
  callModel.mockResolvedValue(MODEL_ANSWER);
  await runReview("token", { organizationId: ORG, sessionId: SESSION, versionId: VERSION });
  const insert = attempts.find((one) => one.table === "comms_review_runs" && one.op === "insert");
  const packet = JSON.parse(String((callModel.mock.calls[0]?.[0] as { input: string }).input));
  return { attempts, insert, packet };
}

describe("the active set is part of what a review was judged against", () => {
  it("refuses to run at all when the kept habits cannot be read", async () => {
    const attempts = harness(
      reviewTables({ comms_review_lessons: { read: boom("connection reset") } }),
    );
    callModel.mockResolvedValue(MODEL_ANSWER);
    const failure = await failureOf(
      runReview("token", { organizationId: ORG, sessionId: SESSION, versionId: VERSION }),
    );
    expect(failure.message).toMatch(/could not be read/i);
    /* No run recorded, no model call: an unreadable set is not an empty one. */
    expect(attempts.filter((one) => one.table === "comms_review_runs")).toHaveLength(0);
    expect(callModel).not.toHaveBeenCalled();
  });

  it("changes the fingerprint when a habit is kept, and again when it is revoked", async () => {
    const none = await runWith(ok([]));
    const one = await runWith(ok([lessonRow()]));
    const revoked = await runWith(
      ok([lessonRow({ revoked_at: "2026-09-16T10:00:00.000Z", revoked_by: USER })]),
    );
    expect(one.insert?.payload["context_fingerprint"]).not.toBe(
      none.insert?.payload["context_fingerprint"],
    );
    expect(revoked.insert?.payload["context_fingerprint"]).toBe(
      none.insert?.payload["context_fingerprint"],
    );
  });

  it("records the exact set with the run's provenance", async () => {
    const { insert } = await runWith(ok([lessonRow()]));
    const snapshot = insert?.payload["kept_lessons_snapshot"] as Record<string, unknown>;
    expect(snapshot["categories"]).toEqual(["open_with_the_reason"]);
    expect(String(snapshot["stamp"])).toMatch(/^lessons:[0-9a-f]{64}$/);
    expect(String(insert?.payload["stages"])).toContain("lessons:");
  });

  it("hands the reviewer catalogue wording only, never the conversation it came from", async () => {
    const { packet } = await runWith(ok([lessonRow()]));
    const guidance = String(packet["keptLessons"] ?? "");
    expect(guidance).toContain("Expect the opening line to give the reason for writing");
    expect(guidance).not.toContain("Acme");
    expect(guidance).not.toContain("flat opener");
  });
});

/* ----------------------------------------- a database without the column */

describe("a database missing the newest column still keeps what it supports", () => {
  it("drops only kept_lessons_snapshot, never the voice provenance", async () => {
    const runRow = {
      id: RUN,
      session_id: SESSION,
      version_id: VERSION,
      status: "running",
      context_revision: 2,
      started_at: "2026-09-14T09:06:00.000Z",
      stages: [],
      coverage: {},
      limitations: [],
    };
    const attempts = harness(
      reviewTables({
        comms_review_lessons: { read: ok([lessonRow()]) },
        comms_review_runs: {
          /* The real shape of a workspace that has the voice columns and not
             the newest one: the named column is absent, nothing else is. */
          insert: (payload) =>
            "kept_lessons_snapshot" in payload
              ? {
                  data: null,
                  error: {
                    code: "PGRST204",
                    message: "Could not find the 'kept_lessons_snapshot' column of 'comms_review_runs' in the schema cache",
                  },
                }
              : ok(runRow),
        },
      }),
    );
    callModel.mockResolvedValue(MODEL_ANSWER);
    await runReview("token", { organizationId: ORG, sessionId: SESSION, versionId: VERSION });

    const inserts = attempts.filter(
      (one) => one.table === "comms_review_runs" && one.op === "insert",
    );
    expect(inserts).toHaveLength(2);
    const retry = inserts[1]!.payload;
    expect(retry).not.toHaveProperty("kept_lessons_snapshot");
    /* Everything this database does support is still written down. */
    expect(retry["voice_profile_id"]).toBe("voice-1");
    expect(retry["voice_version"]).toBe(3);
    expect(retry["voice_snapshot_checksum"]).toEqual(expect.any(String));
    expect(retry["style_context_snapshot"]).toMatchObject({ rulesText: "Write plainly." });
    /* And the run itself still completed against the habits in force. */
    expect(String(retry["stages"])).toContain("lessons:");
    const completion = attempts.find(
      (one) => one.table === "comms_review_runs" && one.op === "update" && one.payload["status"] === "complete",
    );
    expect(completion).toBeDefined();
  });
});

describe("the snapshot names the wording, not only the categories", () => {
  it("records the catalogue version, the lesson ids and the exact sentences", async () => {
    const { insert } = await runWith(ok([lessonRow()]));
    const snapshot = insert?.payload["kept_lessons_snapshot"] as Record<string, unknown>;
    expect(snapshot["catalogueVersion"]).toBe(LESSON_CATALOGUE_VERSION);
    expect(snapshot["lessons"]).toEqual([
      {
        id: "lesson-1",
        category: "open_with_the_reason",
        guidance: lessonCategory("open_with_the_reason")?.guidance,
        promotedAt: "2026-09-16T09:00:00.000Z",
      },
    ]);
  });
});

/* ---------------------------------------------------- stopping a habit */

describe("stopping a habit is said once and answered the same way twice", () => {
  it("returns the original record when it was already stopped, and writes nothing", async () => {
    const stopped = lessonRow({ revoked_at: "2026-09-16T11:00:00.000Z", revoked_by: USER });
    const attempts = harness({
      organization_memberships: { read: ok({ role: "owner", status: "active" }) },
      comms_review_lessons: { read: ok(stopped) },
    });
    const lesson = await revokeLesson("token", { organizationId: ORG, lessonId: "lesson-1" });
    expect(lesson.revokedAt).toBe("2026-09-16T11:00:00.000Z");
    expect(attempts.filter((one) => one.op === "update")).toHaveLength(0);
  });

  it("says plainly when there is no such habit, rather than reporting success", async () => {
    const attempts = harness({
      organization_memberships: { read: ok({ role: "owner", status: "active" }) },
      comms_review_lessons: { read: ok(null) },
    });
    const failure = await failureOf(
      revokeLesson("token", { organizationId: ORG, lessonId: "lesson-1" }),
    );
    expect(failure.code).toBe("not_found");
    expect(attempts.filter((one) => one.op === "update")).toHaveLength(0);
  });

  it("stops one still in use and hands back the record of it", async () => {
    let seen = lessonRow();
    const attempts = harness({
      organization_memberships: { read: ok({ role: "owner", status: "active" }) },
      comms_review_lessons: {
        read: () => ok(seen),
        update: ok(lessonRow({ revoked_at: "2026-09-16T12:00:00.000Z", revoked_by: USER })),
      },
    });
    const lesson = await revokeLesson("token", { organizationId: ORG, lessonId: "lesson-1" });
    void seen;
    expect(lesson.revokedBy).toBe(USER);
    const update = attempts.find((one) => one.table === "comms_review_lessons" && one.op === "update");
    expect(update?.payload).toMatchObject({ revoked_by: USER });
  });
});
