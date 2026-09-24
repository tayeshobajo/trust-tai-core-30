import { describe, expect, it } from "vitest";

import { agentExecutionAuthority, recordAgentCompletion } from "./steward-agent-runner.server";

const me = "u-1";

describe("agent execution authority", () => {
  it("rejects view-only roles even for their own task", () => {
    expect(agentExecutionAuthority({ role: "viewer", userId: me, createdBy: me, ownerUserId: null }).ok).toBe(false);
  });
  it("rejects members running someone else's task", () => {
    expect(agentExecutionAuthority({ role: "member", userId: me, createdBy: "u-2", ownerUserId: "u-3" }).ok).toBe(false);
  });
  it("allows creator or owner, and owner/admin roles", () => {
    expect(agentExecutionAuthority({ role: "member", userId: me, createdBy: me, ownerUserId: null }).ok).toBe(true);
    expect(agentExecutionAuthority({ role: "team_member", userId: me, createdBy: "x", ownerUserId: me }).ok).toBe(true);
    expect(agentExecutionAuthority({ role: "admin", userId: me, createdBy: "x", ownerUserId: "y" }).ok).toBe(true);
  });
});

function fakeWriter(opts: { taskUpdated: number; priorFeed: number; insertError?: { code: string } | null }) {
  const inserts: unknown[] = [];
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["update", "eq", "neq", "select", "limit", "maybeSingle"]) c[m] = () => c;
    (c as { then: unknown }).then = (r: (v: unknown) => void) => r(result);
    return c;
  };
  return {
    inserts,
    client: {
      from(table: string) {
        if (table === "steward_tasks") {
          return chain({ data: Array(opts.taskUpdated).fill({ id: "t" }), error: null });
        }
        const c = chain({ data: Array(opts.priorFeed).fill({ id: "a" }), error: null }) as Record<string, unknown>;
        c["insert"] = (row: unknown) => {
          inserts.push(row);
          return Promise.resolve({ error: opts.insertError ?? null });
        };
        return c;
      },
    },
  };
}

const base = {
  organizationId: "o",
  task: { id: "t", title: "Summarise notes" } as never,
  agentId: "trust-tai-internal",
  runId: "r",
  evidenceRefs: ["context:1"],
  settledAt: "2026-09-24T00:00:00Z",
};

describe("recordAgentCompletion", () => {
  it("reports a failed feed write honestly instead of claiming success", async () => {
    const w = fakeWriter({ taskUpdated: 1, priorFeed: 0, insertError: { code: "42501" } });
    const r = await recordAgentCompletion(w.client as never, base);
    expect(r.taskCompleted).toBe(true);
    expect(r.feedRecorded).toBe(false);
    expect(r.note).toMatch(/didn't save/);
  });
  it("does not duplicate an existing feed entry on retry", async () => {
    const w = fakeWriter({ taskUpdated: 1, priorFeed: 1 });
    const r = await recordAgentCompletion(w.client as never, base);
    expect(r.feedRecorded).toBe(true);
    expect(w.inserts).toHaveLength(0);
  });
});
