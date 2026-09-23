import { describe, expect, it } from "vitest";

import { completeScoutTaskAfterSentDelivery } from "./comms-scout-task-completion.server";

type Row = Record<string, unknown>;

function client(world: { status?: string; providerId?: string | null; prospectId?: string | null; taskStatus?: string; updated?: number }) {
  const state = { updated: world.updated ?? 0 };
  const from = (table: string) => {
    let updatePayload: Row | null = null;
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "neq"]) chain[method] = () => chain;
    chain["update"] = (payload: Row) => { updatePayload = payload; return chain; };
    chain["insert"] = async () => ({ data: null, error: null });
    chain["maybeSingle"] = async () => {
      if (table === "comms_review_deliveries") return { data: world.status === "sent" ? { id: "delivery", draft_id: "draft", status: "sent", provider_message_id: world.providerId ?? "provider-1" } : null, error: null };
      if (table === "comms_drafts") return { data: { relationship_id: "rel" }, error: null };
      if (table === "comms_relationships") return { data: { prospect_id: world.prospectId === undefined ? "prospect" : world.prospectId }, error: null };
      if (table === "steward_tasks") return { data: world.taskStatus ? { id: "task", status: world.taskStatus } : null, error: null };
      return { data: null, error: null };
    };
    chain["then"] = (resolve: (value: unknown) => unknown) => {
      if (table === "steward_tasks" && updatePayload) {
        state.updated += 1;
        return Promise.resolve({ data: [{ id: "task" }], error: null }).then(resolve);
      }
      return Promise.resolve({ data: null, error: null }).then(resolve);
    };
    return chain;
  };
  return { state, client: { from } as never };
}

describe("confirmed send to Scout task completion", () => {
  it("completes one exact linked task only after sent is recorded", async () => {
    const fixture = client({ status: "sent" });
    const result = await completeScoutTaskAfterSentDelivery({ client: fixture.client, organizationId: "org", deliveryId: "delivery" });
    expect(result).toMatchObject({ recorded: true, taskId: "task" });
    expect(fixture.state.updated).toBe(1);
  });

  it.each(["failed", "unknown", "attempting"])("does not complete for %s", async (status) => {
    const fixture = client({ status });
    const result = await completeScoutTaskAfterSentDelivery({ client: fixture.client, organizationId: "org", deliveryId: "delivery" });
    expect(result.recorded).toBe(false);
    expect(fixture.state.updated).toBe(0);
  });

  it("does not complete when no canonical prospect is linked", async () => {
    const fixture = client({ status: "sent", prospectId: null });
    const result = await completeScoutTaskAfterSentDelivery({ client: fixture.client, organizationId: "org", deliveryId: "delivery" });
    expect(result.recorded).toBe(false);
    expect(fixture.state.updated).toBe(0);
  });
});