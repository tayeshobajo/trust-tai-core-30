import { describe, expect, it, vi } from "vitest";
import {
  startStudioResearch,
  readStudioResearch,
  type ResearchDeps,
  type ResearchRun,
} from "./studio-research.server";
import {
  parseResearchResult,
  researchIssueDescription,
  type ResearchRequest,
} from "@/domain/studio-research";

const request: ResearchRequest = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  requestId: "22222222-2222-4222-8222-222222222222",
  topic: "Practical AI adoption in Nashville",
};
const result = {
  version: 1,
  requestId: request.requestId,
  topics: [
    {
      title: "A sourced topic",
      summary: "Evidence to review",
      relevance: "Relevant to the requested topic",
      sources: [
        {
          title: "Public source",
          url: "https://example.org/article",
          publishedAt: null,
          retrievedAt: "2026-11-05T12:00:00Z",
        },
      ],
    },
  ],
  limitations: ["LinkedIn connection status was not checked."],
};

function fixture() {
  let stored: ResearchRun | null = null;
  const deps: ResearchDeps = {
    authorize: vi.fn(async () => true),
    configuration: vi.fn(async () => ({
      enabled: true,
      organizationId: request.organizationId,
      companyId: "company",
      agentId: "agent",
      owningApp: "studio",
      capabilities: ["studio.research"],
    })),
    agent: vi.fn(async () => ({ id: "agent", companyId: "company", status: "idle" })),
    reserve: vi.fn<ResearchDeps["reserve"]>(async (input, companyId, agentId) => {
      if (stored) return { kind: "existing", run: { ...stored } };
      stored = {
        id: "binding",
        request: input,
        companyId,
        agentId,
        issueId: null,
        state: "dispatching",
      };
      return { kind: "claimed", run: { ...stored } };
    }),
    createIssue: vi.fn(async () => ({
      id: "issue",
      companyId: "company",
      assigneeAgentId: "agent",
    })),
    attachIssue: vi.fn(async (_run, issueId) => {
      stored = { ...stored!, issueId, state: "submitted" };
    }),
    markUncertain: vi.fn(async () => {
      stored = { ...stored!, state: "dispatch_uncertain" };
    }),
    readRun: vi.fn(async () => stored),
    readIssue: vi.fn(async () => ({
      id: "issue",
      companyId: "company",
      assigneeAgentId: "agent",
      status: "done",
      comments: [
        {
          id: "comment",
          companyId: "company",
          issueId: "issue",
          authorAgentId: "agent",
          deletedAt: null,
          body: JSON.stringify(result),
        },
      ],
    })),
  };
  return deps;
}

describe("manual Studio research boundaries", () => {
  it("does not read configuration or dispatch without server work authority", async () => {
    const deps = fixture();
    vi.mocked(deps.authorize).mockResolvedValue(false);
    expect(await startStudioResearch("token", request, deps)).toEqual({
      status: "blocked",
      reason: "not_authorized",
    });
    expect(deps.configuration).not.toHaveBeenCalled();
    expect(deps.createIssue).not.toHaveBeenCalled();
  });
  it("does not accept caller-supplied agent IDs", async () => {
    const deps = fixture();
    await expect(
      startStudioResearch("token", { ...request, agentId: "other" }, deps),
    ).rejects.toThrow();
    expect(deps.authorize).not.toHaveBeenCalled();
  });
  it.each(["disabled", "wrong_org", "wrong_room", "missing_capability"])(
    "fails closed for %s registration",
    async (mode) => {
      const deps = fixture();
      const config = (await deps.configuration(request.organizationId))!;
      if (mode === "disabled") config.enabled = false;
      if (mode === "wrong_org") config.organizationId = "foreign";
      if (mode === "wrong_room") config.owningApp = "scout";
      if (mode === "missing_capability") config.capabilities = [];
      vi.mocked(deps.configuration).mockResolvedValue(config);
      expect(await startStudioResearch("token", request, deps)).toEqual({
        status: "blocked",
        reason: "not_configured",
      });
      expect(deps.agent).not.toHaveBeenCalled();
      expect(deps.reserve).not.toHaveBeenCalled();
    },
  );
  it.each(["paused", "error", "terminated"])(
    "does not resume an agent in %s status",
    async (status) => {
      const deps = fixture();
      vi.mocked(deps.agent).mockResolvedValue({ id: "agent", companyId: "company", status });
      expect(await startStudioResearch("token", request, deps)).toEqual({
        status: "blocked",
        reason: "agent_unavailable",
      });
      expect(deps.reserve).not.toHaveBeenCalled();
    },
  );
  it("rejects a live worker from a different company", async () => {
    const deps = fixture();
    vi.mocked(deps.agent).mockResolvedValue({
      id: "agent",
      companyId: "foreign",
      status: "active",
    });
    expect((await startStudioResearch("token", request, deps)).status).toBe("blocked");
    expect(deps.createIssue).not.toHaveBeenCalled();
  });
  it("dispatches once under concurrent requests with an atomic claim adapter", async () => {
    const deps = fixture();
    const responses = await Promise.all([
      startStudioResearch("token", request, deps),
      startStudioResearch("token", request, deps),
    ]);
    expect(deps.createIssue).toHaveBeenCalledTimes(1);
    expect(responses.some((r) => r.status === "submitted")).toBe(true);
    expect(await startStudioResearch("token", request, deps)).toEqual({
      status: "submitted",
      requestId: request.requestId,
      issueId: "issue",
    });
    expect(deps.createIssue).toHaveBeenCalledTimes(1);
  });
  it("rejects reuse of the operation ID for a changed topic", async () => {
    const deps = fixture();
    await startStudioResearch("token", request, deps);
    expect(
      await startStudioResearch("token", { ...request, topic: "Different scope" }, deps),
    ).toEqual({ status: "blocked", reason: "conflict" });
    expect(deps.createIssue).toHaveBeenCalledTimes(1);
  });
  it.each(["createIssue", "attachIssue"] as const)(
    "does not redispatch after an uncertain %s outcome",
    async (method) => {
      const deps = fixture();
      vi.mocked(deps[method]).mockRejectedValue(new Error("Lost response, possibly committed"));
      vi.mocked(deps.markUncertain).mockRejectedValue(new Error("Storage unavailable"));
      expect((await startStudioResearch("token", request, deps)).status).toBe("dispatch_uncertain");
      expect((await startStudioResearch("token", request, deps)).status).toBe("dispatch_uncertain");
      expect(deps.createIssue).toHaveBeenCalledTimes(1);
    },
  );
  it("requires a durable reservation before any external write", async () => {
    const deps = fixture();
    vi.mocked(deps.reserve).mockRejectedValue(new Error("Database unavailable"));
    expect(await startStudioResearch("token", request, deps)).toEqual({
      status: "blocked",
      reason: "storage_unavailable",
    });
    expect(deps.createIssue).not.toHaveBeenCalled();
  });
  it("rechecks read authority before accessing a run or external results", async () => {
    const deps = fixture();
    vi.mocked(deps.authorize).mockResolvedValue(false);
    expect(
      (await readStudioResearch("token", request.organizationId, request.requestId, deps)).status,
    ).toBe("blocked");
    expect(deps.readRun).not.toHaveBeenCalled();
    expect(deps.readIssue).not.toHaveBeenCalled();
  });
  it("rejects cross-workspace records even if an adapter returns one", async () => {
    const deps = fixture();
    await startStudioResearch("token", request, deps);
    expect(await readStudioResearch("token", "foreign", request.requestId, deps)).toEqual({
      status: "blocked",
      reason: "binding_mismatch",
    });
    expect(deps.readIssue).not.toHaveBeenCalled();
  });
  it("returns a sourced result only for human review", async () => {
    const deps = fixture();
    await startStudioResearch("token", request, deps);
    expect(
      await readStudioResearch("token", request.organizationId, request.requestId, deps),
    ).toEqual({ status: "review_ready", commentId: "comment", result });
  });
  it.each(["foreign_author", "foreign_issue", "deleted", "duplicate", "no_output", "unsourced"])(
    "does not accept %s output",
    async (mode) => {
      const deps = fixture();
      await startStudioResearch("token", request, deps);
      const issue = await deps.readIssue("company", "issue");
      if (mode === "foreign_author") issue.comments[0]!.authorAgentId = "someone-else";
      if (mode === "foreign_issue") issue.comments[0]!.issueId = "other";
      if (mode === "deleted") issue.comments[0]!.deletedAt = "2026-11-05T13:00:00Z";
      if (mode === "duplicate") issue.comments.push({ ...issue.comments[0]!, id: "second" });
      if (mode === "no_output") issue.comments = [];
      if (mode === "unsourced")
        issue.comments[0]!.body = JSON.stringify({
          ...result,
          topics: [{ ...result.topics[0], sources: [] }],
        });
      vi.mocked(deps.readIssue).mockResolvedValue(issue);
      expect(
        await readStudioResearch("token", request.organizationId, request.requestId, deps),
      ).toEqual({ status: "invalid_result" });
    },
  );
  it("does not mistake an unfinished issue for completed research", async () => {
    const deps = fixture();
    await startStudioResearch("token", request, deps);
    const issue = await deps.readIssue("company", "issue");
    issue.status = "in_progress";
    vi.mocked(deps.readIssue).mockResolvedValue(issue);
    expect(
      await readStudioResearch("token", request.organizationId, request.requestId, deps),
    ).toEqual({ status: "waiting" });
  });
  it("rejects oversized, mismatched and unsafe result payloads", () => {
    expect(() => parseResearchResult(" ".repeat(100001), request.requestId)).toThrow();
    expect(() => parseResearchResult(JSON.stringify(result), "other")).toThrow();
    for (const url of [
      "javascript:alert(1)",
      "http://example.org",
      "https://user:secret@example.org",
    ]) {
      const bad = structuredClone(result);
      bad.topics[0]!.sources[0]!.url = url;
      expect(() => parseResearchResult(JSON.stringify(bad), request.requestId)).toThrow();
    }
  });
  it("sends only explicit topic data and a correlation ID, never the organization or credentials", () => {
    const description = researchIssueDescription(request);
    expect(description).toContain(
      JSON.stringify({ requestId: request.requestId, topic: request.topic }),
    );
    expect(description).not.toContain(request.organizationId);
    expect(description).toContain("Do not publish");
  });
});
