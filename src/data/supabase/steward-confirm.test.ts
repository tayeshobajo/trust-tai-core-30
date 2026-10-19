import { beforeEach, expect, it, vi } from "vitest";
import type { Proposal } from "@/domain/steward";
const fake = vi.hoisted(() => ({
  results: [] as { data: unknown; error: null }[],
  writes: vi.fn(),
  user: "user",
}));
vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: fake.user } } }) },
    from: () => {
      const result = () => Promise.resolve(fake.results.shift());
      const query = {
        select: () => query,
        eq: () => query,
        limit: () => query,
        single: result,
        maybeSingle: result,
        upsert: (...args: unknown[]) => {
          fake.writes(...args);
          return query;
        },
        then: (resolve: (value: unknown) => unknown) => result().then(resolve),
      };
      return query;
    },
  },
}));
import { stewardService } from "./steward-service";
const input = {
  organizationId: "org",
  userId: "user",
  conversationId: "meeting",
  ownerName: "Alex",
  proposal: {
    id: "source-key",
    statement: "Check the invitation browser journey",
    evidence: [],
    kind: "commitment",
  } as unknown as Proposal,
};
beforeEach(() => {
  fake.results = [];
  fake.user = "user";
  fake.writes.mockReset();
});
it("replays a prior confirmation without reopening or rewriting its original record", async () => {
  fake.results = [
    { data: { role: "admin" }, error: null },
    { data: { id: "meeting" }, error: null },
    {
      data: {
        id: "existing",
        organization_id: "org",
        conversation_id: "meeting",
        source_key: "source-key",
        statement: input.proposal.statement,
        status: "kept",
        evidence: [],
        owner_name: "Alex",
      },
      error: null,
    },
  ];
  const task = await stewardService.confirm(input);
  expect(task.id).toBe("existing");
  expect(task.status).toBe("kept");
  expect(fake.writes).not.toHaveBeenCalled();
});
it("refuses confirmation after identity changes", async () => {
  fake.user = "other";
  await expect(stewardService.confirm(input)).rejects.toThrow("Sign in");
  expect(fake.writes).not.toHaveBeenCalled();
});
it("rechecks canonical business work before creating a task from cached analysis", async () => {
  fake.results = [
    { data: { role: "admin" }, error: null },
    { data: { id: "meeting" }, error: null },
    { data: null, error: null },
    { data: [], error: null },
    { data: [{ id: "board-task", title: input.proposal.statement, status: "done" }], error: null },
  ];
  await expect(stewardService.confirm(input)).rejects.toThrow("board-task");
  expect(fake.writes).not.toHaveBeenCalled();
});
it.each(["kept", "open"])(
  "allows a separate client's obligation after explicit reconciliation with %s historical work",
  async (status) => {
    const statement = "Send report to Acme";
    fake.results = [
      { data: { role: "admin" }, error: null },
      { data: { id: "new-meeting" }, error: null },
      { data: null, error: null },
      {
        data: [
          {
            id: "old-report",
            statement: "Send report",
            status,
            conversation_id: "old-meeting",
            evidence: [],
          },
        ],
        error: null,
      },
      { data: [], error: null },
      { data: { id: "new-report", statement, status: "open", evidence: [] }, error: null },
    ];
    await stewardService.confirm({
      ...input,
      conversationId: "new-meeting",
      proposal: { ...input.proposal, statement },
      distinctObligationReason:
        "The old report was for Beta in September; this meeting agreed a separate October Acme report.",
    });
    expect(fake.writes).toHaveBeenCalledOnce();
    const [payload, options] = fake.writes.mock.calls[0]!;
    expect(payload.evidence[0].label).toContain("old-report");
    expect(payload.evidence[0].label).toContain("October Acme");
    expect(options.ignoreDuplicates).toBe(true);
  },
);
