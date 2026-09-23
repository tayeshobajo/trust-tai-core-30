import { describe, expect, it, vi } from "vitest";

import { completeScoutTaskAfterSentDelivery } from "./comms-scout-task-completion.server";

type Row = Record<string, unknown>;

/** Tiny in-memory fake: steward_tasks keyed by correlation_id. */
function world(opts: { status?: string; failInsert?: boolean } = {}) {
  const tasks: Row[] = [{ id: "first", correlation_id: "scout:prospect:p1:first-message", status: "open" }];
  const inserts: Row[] = [];
  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    let mode: "select" | "update" | "insert" = "select";
    let payload: Row = {};
    const chain: Record<string, unknown> = {};
    chain["select"] = () => chain;
    chain["eq"] = (k: string, v: unknown) => { filters[k] = v; return chain; };
    chain["neq"] = (k: string, v: unknown) => { filters[`!${k}`] = v; return chain; };
    chain["update"] = (p: Row) => { mode = "update"; payload = p; return chain; };
    chain["insert"] = (p: Row) => {
      mode = "insert";
      payload = p;
      if (table === "activities") return Promise.resolve({ data: null, error: null });
      return chain;
    };
    const matches = () => tasks.filter((t) => (filters["correlation_id"] === undefined || t["correlation_id"] === filters["correlation_id"]) && (filters["!status"] === undefined || t["status"] !== filters["!status"]));
    chain["maybeSingle"] = async () => {
      if (table === "comms_review_deliveries") return { data: (opts.status ?? "sent") === "sent" ? { id: "d1", draft_id: "dr", status: "sent", provider_message_id: "pm" } : null, error: null };
      if (table === "comms_drafts") return { data: { relationship_id: "rel" }, error: null };
      if (table === "comms_relationships") return { data: { prospect_id: "p1" }, error: null };
      if (mode === "insert") {
        if (opts.failInsert) return { data: null, error: { message: "denied" } };
        const row = { id: `t${tasks.length}`, ...payload };
        tasks.push(row);
        inserts.push(row);
        return { data: { id: row.id }, error: null };
      }
      return { data: matches()[0] ?? null, error: null };
    };
    chain["then"] = (resolve: (v: unknown) => unknown) => {
      if (mode === "update") {
        const m = matches();
        m.forEach((t) => Object.assign(t, payload));
        return Promise.resolve({ data: m.map((t) => ({ id: t["id"] })), error: null }).then(resolve);
      }
      return Promise.resolve({ data: null, error: null }).then(resolve);
    };
    return chain;
  };
  return { tasks, inserts, client: { from } as never };
}

describe("send triggers the AI follow-up (S1–S4)", () => {
  it("S2 completes the first message and creates one AI follow-up, dispatched once", async () => {
    const w = world();
    const dispatch = vi.fn(async () => undefined);
    const r = await completeScoutTaskAfterSentDelivery({ client: w.client, organizationId: "o", deliveryId: "d1", dispatch });
    expect(r.recorded).toBe(true);
    expect(w.tasks[0]?.["status"]).toBe("complete");
    expect(w.inserts).toHaveLength(1);
    expect(w.inserts[0]).toMatchObject({ assignee_kind: "agent", correlation_id: "scout:prospect:p1:follow-up:d1", source_entity_id: "p1" });
    expect(dispatch).toHaveBeenCalledTimes(1);

    const again = await completeScoutTaskAfterSentDelivery({ client: w.client, organizationId: "o", deliveryId: "d1", dispatch });
    expect(again.followUpTaskId).toBe(r.followUpTaskId);
    expect(w.inserts).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("S1 nothing happens without a recorded send", async () => {
    const w = world({ status: "failed" });
    const dispatch = vi.fn(async () => undefined);
    await completeScoutTaskAfterSentDelivery({ client: w.client, organizationId: "o", deliveryId: "d1", dispatch });
    expect(w.inserts).toHaveLength(0);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("S4 AI start failure never undoes completion", async () => {
    const w = world();
    const r = await completeScoutTaskAfterSentDelivery({ client: w.client, organizationId: "o", deliveryId: "d1", dispatch: async () => { throw new Error("no access"); } });
    expect(r.recorded).toBe(true);
    expect(w.tasks[0]?.["status"]).toBe("complete");
  });

  it("S3 the follow-up is internal preparation only", async () => {
    const w = world();
    await completeScoutTaskAfterSentDelivery({ client: w.client, organizationId: "o", deliveryId: "d1" });
    expect(String(w.inserts[0]?.["notes"])).toMatch(/Never send/);
  });
});
