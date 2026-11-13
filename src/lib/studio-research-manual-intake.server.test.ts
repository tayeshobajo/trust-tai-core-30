import { it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  prepareManualResearchRequest,
  type IntakeDeps,
} from "./studio-research-manual-intake.server";
import { COORDINATOR } from "./studio-research-coordinator-contracts";
import type { ResearchRun } from "./studio-research.server";
function fixture() {
  const user = randomUUID(),
    input = {
      organizationId: COORDINATOR.organizationId,
      requestId: randomUUID(),
      topic: "Synthetic manual topic",
    };
  let saved: ResearchRun | null = null;
  const d: IntakeDeps = {
    mode: "offline-synthetic",
    authorize: async () => ({ userId: user }),
    owner: async () => user,
    agent: async () => ({
      id: COORDINATOR.agentId,
      companyId: COORDINATOR.companyId,
      status: "paused",
    }),
    reserve: async (request, companyId, agentId) => {
      if (saved) return { kind: "existing", run: saved };
      saved = {
        id: randomUUID(),
        request,
        companyId,
        agentId,
        issueId: null,
        state: "dispatching",
      };
      return { kind: "claimed", run: saved };
    },
    createIssue: vi.fn(async () => ({
      id: randomUUID(),
      companyId: COORDINATOR.companyId,
      assigneeAgentId: COORDINATOR.agentId,
    })),
    attachIssue: async (_r, id) => {
      saved = { ...saved!, state: "submitted", issueId: id };
    },
    markUncertain: async () => {
      saved = { ...saved!, state: "dispatch_uncertain" };
    },
  };
  const request = new Request("https://studio.local/", { method: "POST" });
  return { d, request, input };
}
it.each(["HTTP 409", "response lost after creation", "invalid successful response"])(
  "keeps %s uncertain without attachment or another create attempt",
  async (message) => {
    const f = fixture();
    const attach = vi.spyOn(f.d, "attachIssue");
    f.d.createIssue = vi.fn(async () => { throw Error(message); });
    for (let i = 0; i < 4; i++)
      expect((await prepareManualResearchRequest(f.request, f.input, f.d)).status).toBe("uncertain");
    expect(f.d.createIssue).toHaveBeenCalledTimes(1);
    expect(attach).not.toHaveBeenCalled();
  },
);
it("does not recreate after attachment and uncertainty persistence failures", async () => {
  const f = fixture();
  f.d.attachIssue = vi.fn(async () => { throw Error("database response lost"); });
  f.d.markUncertain = vi.fn(async () => { throw Error("database unavailable"); });
  expect((await prepareManualResearchRequest(f.request, f.input, f.d)).status).toBe("uncertain");
  expect((await prepareManualResearchRequest(f.request, f.input, f.d)).status).toBe("uncertain");
  expect(f.d.createIssue).toHaveBeenCalledTimes(1);
});
it("prepares one bound issue while native agent remains paused, without wake APIs", async () => {
  const f = fixture();
  const results = await Promise.all([
    prepareManualResearchRequest(f.request, f.input, f.d),
    prepareManualResearchRequest(f.request, f.input, f.d),
  ]);
  expect(results.some((r) => r.status === "prepared")).toBe(true);
  expect(f.d.createIssue).toHaveBeenCalledTimes(1);
  expect((await prepareManualResearchRequest(f.request, f.input, f.d)).status).toBe("prepared");
});
it("retains uncertain claim after ambiguous issue creation and does not resubmit", async () => {
  const f = fixture();
  f.d.createIssue = vi.fn(async () => {
    throw Error("response lost");
  });
  expect((await prepareManualResearchRequest(f.request, f.input, f.d)).status).toBe("uncertain");
  await prepareManualResearchRequest(f.request, f.input, f.d);
  expect(f.d.createIssue).toHaveBeenCalledTimes(1);
});
it("refuses production mode, non-paused agent and foreign owner", async () => {
  const f = fixture();
  expect(
    (await prepareManualResearchRequest(f.request, f.input, { ...f.d, mode: "production" })).status,
  ).toBe("blocked");
  f.d.agent = async () => ({
    id: COORDINATOR.agentId,
    companyId: COORDINATOR.companyId,
    status: "active",
  });
  expect((await prepareManualResearchRequest(f.request, f.input, f.d)).status).toBe("blocked");
  f.d.agent = async () => ({
    id: COORDINATOR.agentId,
    companyId: COORDINATOR.companyId,
    status: "paused",
  });
  f.d.owner = async () => randomUUID();
  await expect(prepareManualResearchRequest(f.request, f.input, f.d)).rejects.toThrow(
    "request_not_owned",
  );
  expect(f.d.createIssue).not.toHaveBeenCalled();
});
it("authenticates before any request reservation", async () => {
  const f = fixture();
  f.d.authorize = async () => {
    throw Error("denied");
  };
  const reserve = vi.spyOn(f.d, "reserve");
  await expect(prepareManualResearchRequest(f.request, f.input, f.d)).rejects.toThrow();
  expect(reserve).not.toHaveBeenCalled();
});
it("does not create an issue when the agent changes status before creation", async () => {
  const f = fixture();
  let calls = 0;
  f.d.agent = async () => ({
    id: COORDINATOR.agentId,
    companyId: COORDINATOR.companyId,
    status: ++calls === 1 ? "paused" : "active",
  });
  expect((await prepareManualResearchRequest(f.request, f.input, f.d)).status).toBe("uncertain");
  expect(f.d.createIssue).not.toHaveBeenCalled();
});
