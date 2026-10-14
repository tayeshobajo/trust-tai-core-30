import { beforeEach, expect, it, vi } from "vitest";
import { toRoadmap } from "@/data/supabase/roadmap-schema";
import { roadmapRevision } from "@/domain/roadmap-tracker-edit";
const org = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333";
const operationId = "44444444-4444-4444-8444-444444444444";
const other = "55555555-5555-4555-8555-555555555555";
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  user: "",
  writes: [] as string[],
  beforeWrite: null as null | (() => void),
  failActivity: false,
  loseResponse: false,
  failReadback: false,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: db.user ? { id: db.user } : null }, error: null }),
    },
    from: (table: string) => {
      let mode = "read";
      let body: Record<string, unknown> = {};
      const filters: [string, unknown][] = [];
      const run = async (single = false) => {
        if (mode === "update" && db.beforeWrite) {
          const fn = db.beforeWrite;
          db.beforeWrite = null;
          fn();
        }
        if (
          mode === "read" &&
          table === "roadmaps" &&
          db.failReadback &&
          db.writes.includes("roadmaps")
        )
          return { data: null, error: { code: "503" } };
        const rows = db.tables[table] ?? [];
        const found = rows.filter((r) =>
          filters.every(([k, v]) =>
            typeof r[k] === "object" && r[k] !== null ? JSON.stringify(r[k]) === v : r[k] === v,
          ),
        );
        if (mode === "insert") {
          if (db.failActivity) return { data: null, error: { code: "503" } };
          if (rows.some((r) => r["id"] === body["id"]))
            return { data: null, error: { code: "23505" } };
          db.writes.push(table);
          rows.push(structuredClone(body));
          db.tables[table] = rows;
          return { data: null, error: null };
        }
        if (mode === "update" && found[0]) {
          db.writes.push(table);
          Object.assign(found[0], structuredClone(body));
          if (db.loseResponse) throw new Error("Response lost after commit");
        }
        return { data: structuredClone(single ? (found[0] ?? null) : found), error: null };
      };
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => {
          filters.push([k, v]);
          return q;
        },
        is: (k: string, v: unknown) => {
          filters.push([k, v]);
          return q;
        },
        update: (v: Record<string, unknown>) => {
          mode = "update";
          body = v;
          return q;
        },
        insert: (v: Record<string, unknown>) => {
          mode = "insert";
          body = v;
          return q;
        },
        maybeSingle: () => run(true),
        then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
          run().then(resolve, reject),
      };
      return q;
    },
  }),
}));
import { readEditableTracker, saveTrackerEdit } from "./roadmap-tracker-edit.server";
function row() {
  return db.tables["roadmaps"]![0]!;
}
function input(
  patch: Record<string, unknown> = { pipelineStage: "Approved", followUpDate: "2026-10-20" },
) {
  return {
    organizationId: org,
    roadmapId: id,
    operationId,
    expectedRevision: roadmapRevision(toRoadmap(row())),
    patch,
  };
}
function request(body = input(), token = "session") {
  return new Request("https://preview.test/api/public/roadmap/tracker", {
    method: "PATCH",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  Object.assign(db, {
    user,
    writes: [],
    beforeWrite: null,
    failActivity: false,
    loseResponse: false,
    failReadback: false,
  });
  db.tables = {
    organization_memberships: [
      { organization_id: org, user_id: user, status: "active", role: "owner" },
      { organization_id: org, user_id: other, status: "active", role: "team_member" },
    ],
    organization_app_settings: [],
    member_app_access: [],
    organization_role_app_access: [],
    activities: [],
    roadmaps: [
      {
        id,
        organization_id: org,
        subject_label: "Fixture Company",
        title: "Fixture roadmap",
        status: "draft",
        owner_user_id: user,
        next_move: {
          action: "Original action",
          tier: "decided",
          because: "Human evidence",
          externalOwnedKey: "keep",
        },
        metadata: {
          artifactVersion: 7,
          outreach_tracker: {
            receipts: ["import-receipt"],
            fields: { clientSignal: "Existing human signal" },
          },
        },
        updated_at: "2026-10-01T00:00:00.000Z",
        created_at: "2026-10-01T00:00:00.000Z",
      },
    ],
  };
});
it("saves a validated tracker edit and atomic history without changing lifecycle, artifacts or import receipts", async () => {
  const response = await saveTrackerEdit(request());
  expect(response.status).toBe(200);
  const saved = await response.json();
  expect(saved.roadmap.status).toBe("draft");
  expect(saved.roadmap.metadata).toMatchObject({
    artifactVersion: 7,
    outreach_tracker: {
      receipts: ["import-receipt"],
      fields: {
        pipelineStage: "Approved",
        followUpDate: "2026-10-20",
        clientSignal: "Existing human signal",
      },
      edits: [
        {
          actorUserId: user,
          changes: [
            { field: "pipelineStage", before: null, after: "Approved" },
            { field: "followUpDate", before: null, after: "2026-10-20" },
          ],
        },
      ],
    },
  });
  expect(db.writes).toEqual(["roadmaps", "activities"]);
});
it("replays an identical save once, including after another later edit", async () => {
  const body = input();
  await saveTrackerEdit(request(body));
  row()["title"] = "Later human title";
  const r = await saveTrackerEdit(request(body));
  expect(r.status).toBe(200);
  expect((await r.json()).replayed).toBe(true);
  expect(db.writes).toEqual(["roadmaps", "activities"]);
  expect(row()["title"]).toBe("Later human title");
});
it("rejects operation ID reuse with a changed payload", async () => {
  const body = input();
  await saveTrackerEdit(request(body));
  expect(
    (await saveTrackerEdit(request({ ...body, patch: { pipelineStage: "Sent" } }))).status,
  ).toBe(409);
});
it("refuses stale revisions without overwriting newer human facts", async () => {
  const body = input();
  row()["next_move"] = { action: "New human action" };
  expect((await saveTrackerEdit(request(body))).status).toBe(409);
  expect(db.writes).toEqual([]);
});
it("catches a same-timestamp concurrent metadata change at the conditional database update", async () => {
  db.beforeWrite = () => {
    row()["metadata"] = { newerHumanFact: true };
  };
  expect((await saveTrackerEdit(request())).status).toBe(409);
  expect(row()["metadata"]).toEqual({ newerHumanFact: true });
  expect(db.writes).toEqual([]);
});
it("catches a concurrent owner change", async () => {
  db.beforeWrite = () => {
    row()["owner_user_id"] = other;
  };
  expect((await saveTrackerEdit(request())).status).toBe(409);
  expect(db.writes).toEqual([]);
});
it("confirms a committed write by receipt after a lost response", async () => {
  db.loseResponse = true;
  expect((await saveTrackerEdit(request())).status).toBe(200);
  expect(db.writes.filter((x) => x === "roadmaps")).toHaveLength(1);
});
it("does not retry a write when readback is unavailable, then recovers the same operation", async () => {
  const body = input();
  db.failReadback = true;
  expect((await saveTrackerEdit(request(body))).status).toBe(503);
  expect(db.writes).toEqual(["roadmaps"]);
  db.failReadback = false;
  expect((await saveTrackerEdit(request(body))).status).toBe(200);
  expect(db.writes).toEqual(["roadmaps", "activities"]);
});
it("keeps durable edit history when activity mirroring fails and retries only the mirror", async () => {
  const body = input();
  db.failActivity = true;
  const r = await saveTrackerEdit(request(body));
  expect(r.status).toBe(200);
  expect((await r.json()).warning).toContain("shared activity stream");
  db.failActivity = false;
  await saveTrackerEdit(request(body));
  expect(db.writes).toEqual(["roadmaps", "activities"]);
});
it.each(["missing_token", "revoked", "inactive", "view", "hidden", "disabled"])(
  "blocks %s access without mutations",
  async (kind) => {
    if (kind === "revoked") db.user = "";
    if (kind === "inactive") db.tables["organization_memberships"]![0]!["status"] = "inactive";
    if (["view", "hidden"].includes(kind))
      db.tables["member_app_access"] = [
        { organization_id: org, user_id: user, app_key: "roadmap", access_level: kind },
      ];
    if (kind === "disabled")
      db.tables["organization_app_settings"] = [
        { organization_id: org, app_key: "roadmap", enabled: false },
      ];
    expect(
      (await saveTrackerEdit(request(input(), kind === "missing_token" ? "" : "session"))).status,
    ).toBeGreaterThanOrEqual(400);
    expect(db.writes).toEqual([]);
  },
);
it("checks current app permissions again after an earlier authorized read", async () => {
  const get = new Request(
    `https://preview.test/api/public/roadmap/tracker?organizationId=${org}&roadmapId=${id}`,
    { headers: { Authorization: "Bearer session" } },
  );
  expect((await readEditableTracker(get)).status).toBe(200);
  db.tables["organization_role_app_access"] = [
    { organization_id: org, role: "owner", app_key: "roadmap", access_level: "view" },
  ];
  expect((await saveTrackerEdit(request())).status).toBe(403);
  expect(db.writes).toEqual([]);
});
it.each([
  { status: "approved" },
  { pipelineStage: "Signed" },
  { followUpDate: "2026-02-30" },
  { keyLinks: "javascript:alert(1)" },
  { conversionDays: "-1" },
  { approved: true },
  { clientId: other },
])("rejects invalid or out-of-scope fields %j", async (patch) => {
  expect((await saveTrackerEdit(request(input(patch)))).status).toBe(400);
  expect(db.writes).toEqual([]);
});
it("validates active owner membership and preserves next_move metadata", async () => {
  expect(
    (await saveTrackerEdit(request(input({ ownerUserId: other, nextAction: "Review evidence" }))))
      .status,
  ).toBe(200);
  expect(row()).toMatchObject({
    owner_user_id: other,
    next_move: { action: "Review evidence", externalOwnedKey: "keep" },
  });
});
it("rejects an inactive or foreign owner", async () => {
  db.tables["organization_memberships"]![1]!["status"] = "inactive";
  expect((await saveTrackerEdit(request(input({ ownerUserId: other })))).status).toBe(400);
  expect(db.writes).toEqual([]);
});
it("allows explicit clearing and zero without fabricating meaningful-update dates or payments", async () => {
  await saveTrackerEdit(
    request(input({ clientSignal: null, conversionDays: "0", pipelineStage: "Closed - Won" })),
  );
  const tracker = (row()["metadata"] as Record<string, Record<string, unknown>>)[
    "outreach_tracker"
  ]!;
  expect(tracker["fields"]).toMatchObject({
    clientSignal: null,
    conversionDays: "0",
    pipelineStage: "Closed - Won",
  });
  expect((tracker["fields"] as Record<string, unknown>)["lastMeaningfulUpdate"]).toBeUndefined();
  expect(row()["status"]).toBe("draft");
  expect(db.writes).not.toContain("payments");
});
it("does not create a missing roadmap or write across organizations", async () => {
  const body = input();
  body.roadmapId = other;
  expect((await saveTrackerEdit(request(body))).status).toBe(404);
  row()["organization_id"] = other;
  expect((await saveTrackerEdit(request(input()))).status).toBe(404);
  expect(db.writes).toEqual([]);
});
