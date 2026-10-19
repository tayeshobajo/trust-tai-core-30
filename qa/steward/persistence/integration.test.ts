import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  stewardUpdates,
  type StewardUpdateInput,
} from "../../../src/data/supabase/steward-updates";
const actor = "22222222-2222-4222-8222-222222222222";
const literal = (value: unknown) =>
  value === null
    ? "null"
    : "'" +
      String(typeof value === "object" ? JSON.stringify(value) : value).replaceAll("'", "''") +
      "'";
const column = (key: string) =>
  key === "payload->>action" ? "payload->>'action'" : '"' + key.replaceAll('"', '""') + '"';
function client(user = actor) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: user } }, error: null }) },
    from: (table: string) => {
      let update: Record<string, unknown> | undefined;
      let fields = "*",
        body: Record<string, unknown> | undefined;
      const where: string[] = [];
      let suffix = "";
      const execute = async (single = false) => {
        const sql = update
          ? `with saved as(update ${column(table)} set ${Object.entries(update)
              .map(([k, v]) => `${column(k)}=${literal(v)}`)
              .join(
                ",",
              )} where ${where.join(" and ")} returning *) select coalesce(json_agg(saved),'[]') from saved`
          : body
            ? `with saved as(insert into ${column(table)}(${Object.keys(body).map(column).join(",")}) values(${Object.values(body).map(literal).join(",")}) returning *) select coalesce(json_agg(saved),'[]') from saved`
            : `select coalesce(json_agg(q),'[]') from(select ${fields} from ${column(table)}${where.length ? " where " + where.join(" and ") : ""}${suffix}) q`;
        try {
          const output = execFileSync(
            "psql",
            [
              process.env.STEWARD_TEST_DB!,
              "-XAtq",
              "-v",
              "ON_ERROR_STOP=1",
              "-c",
              `set role authenticated; set request.jwt.claim.sub=${literal(user)}; ${sql}`,
            ],
            { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
          const rows = JSON.parse(output.trim());
          return { data: single ? (rows[0] ?? null) : rows, error: null };
        } catch (e) {
          const error = e as { stderr: Buffer };
          const message = String(error.stderr);
          return {
            data: null,
            error: { message, code: message.includes("duplicate key") ? "23505" : "error" },
          };
        }
      };
      const query = {
        select: (v: string) => {
          fields = v.split(",").map(column).join(",");
          return query;
        },
        eq: (key: string, value: unknown) => {
          where.push(`${column(key)}=${literal(value)}`);
          return query;
        },
        in: (key: string, values: unknown[]) => {
          where.push(`${column(key)} in(${values.map(literal).join(",")})`);
          return query;
        },
        order: (key: string) => {
          suffix += ` order by ${column(key)} desc`;
          return query;
        },
        limit: (n: number) => {
          suffix += ` limit ${n}`;
          return query;
        },
        insert: (value: Record<string, unknown>) => {
          body = value;
          return query;
        },
        update: (value: Record<string, unknown>) => {
          update = value;
          return query;
        },
        maybeSingle: () => execute(true),
        single: () => execute(true),
        then: (resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) =>
          execute().then(resolve, reject),
      };
      return query;
    },
  } as unknown as SupabaseClient;
}
it("persists and reloads updates and same-task roll-forward through actual PostgreSQL with RLS", async () => {
  const input: StewardUpdateInput = {
    organizationId: "11111111-1111-4111-8111-111111111111",
    taskId: "33333333-3333-4333-8333-333333333333",
    kind: "commitment",
    meetingId: "44444444-4444-4444-8444-444444444444",
    operationId: "55555555-5555-4555-8555-555555555555",
    note: "Persistence test decision",
    authorName: "Fixture member",
    laterDate: null,
    laterMeetingId: null,
    originalDue: "2026-10-05",
    action: "update",
  };
  await stewardUpdates(client()).post(input);
  await stewardUpdates(client()).post(input);
  const reloaded = await stewardUpdates(client()).list(input.organizationId, input.taskId);
  expect(reloaded).toHaveLength(1);
  expect(reloaded[0]?.actor_user_id).toBe(actor);
  expect(reloaded[0]?.payload.note).toBe(input.note);
  await stewardUpdates(client()).post({
    ...input,
    operationId: "77777777-7777-4777-8777-777777777777",
    action: "roll_forward",
    laterMeetingId: "66666666-6666-4666-8666-666666666666",
    note: "Carry the same obligation forward.",
  });
  const forwards = await stewardUpdates(client()).forwards(input.organizationId, [input.taskId]);
  expect(forwards.events).toHaveLength(1);
  expect(forwards.events[0]?.entity_id).toBe(input.taskId);
  const unchanged = execFileSync(
    "psql",
    [
      process.env.STEWARD_TEST_DB!,
      "-XAtq",
      "-c",
      `select status||','||conversation_id||','||due_at from commitments where id=${literal(input.taskId)}`,
    ],
    { encoding: "utf8" },
  ).trim();
  expect(unchanged).toBe(`open,${input.meetingId},2026-10-05`);
  await expect(
    stewardUpdates(client("99999999-9999-4999-8999-999999999999")).post({
      ...input,
      operationId: "88888888-8888-4888-8888-888888888888",
    }),
  ).rejects.toThrow("unavailable");
  expect(
    await stewardUpdates(client("99999999-9999-4999-8999-999999999999")).list(
      input.organizationId,
      input.taskId,
    ),
  ).toHaveLength(0);
});

it("persists native completion with compare-and-swap and rejects a stale repeated click", async () => {
  const c = {
    id: "33333333-3333-4333-8333-333333333333",
    organizationId: "11111111-1111-4111-8111-111111111111",
    conversationId: "44444444-4444-4444-8444-444444444444",
    ownerUserId: actor,
    ownerName: "Fixture member",
    what: "Fixture task",
    status: "open" as const,
    sourceKey: "fixture",
    evidence: [],
    createdAt: "2026-10-01",
    updatedAt: "2026-10-01T00:00:00Z",
  };
  await stewardUpdates(client()).setCommitmentStatus(
    c,
    "kept",
    "Checked the completed fixture output.",
    "Fixture member",
  );
  const state = execFileSync(
    "psql",
    [
      process.env.STEWARD_TEST_DB!,
      "-XAtq",
      "-c",
      `select status from commitments where id=${literal(c.id)}`,
    ],
    { encoding: "utf8" },
  ).trim();
  expect(state).toBe("kept");
  await expect(
    stewardUpdates(client()).setCommitmentStatus(
      c,
      "kept",
      "Checked the completed fixture output.",
      "Fixture member",
    ),
  ).rejects.toThrow("changed");
});

it("persists full-transcript readings, replays one canonical result, and denies cross-org reads/writes", async () => {
  const { saveMeetingReading, loadMeetingReading } =
    await import("../../../src/data/steward/reading-store");
  const org = "11111111-1111-4111-8111-111111111111",
    meeting = "44444444-4444-4444-8444-444444444444";
  const result = {
    run: { coverage: { digest: "fixture-digest", segmentsRead: 3, segmentsTotal: 3 }, signals: [] },
  } as unknown as import("../../../src/data/steward/ingest").InterpretationResult;
  const input = {
    org,
    meeting,
    actor,
    key: "meeting-reasoning:fixture-v1",
    digest: "fixture-digest",
    version: "full-transcript-v1",
    result,
  };
  await saveMeetingReading(client(), input);
  const replay = await saveMeetingReading(client(), {
    ...input,
    result: { ...result, suppressedCount: 99 },
  });
  expect(replay).toEqual(result);
  expect(await loadMeetingReading(client(), org, meeting, input.key)).toEqual(result);
  const outsider = client("99999999-9999-4999-8999-999999999999");
  expect(await loadMeetingReading(outsider, org, meeting, input.key)).toBeNull();
  await expect(
    saveMeetingReading(outsider, { ...input, key: "unauthorized-reading" }),
  ).rejects.toThrow("access changed");
  expect(await loadMeetingReading(client(), org, meeting, "unauthorized-reading")).toBeNull();
});
