import { describe, expect, it } from "vitest";
import { linkProposalToTask, type ProposalLinkRepository } from "./steward-proposal-link.server";

const BASE = {
  orgId: "org-a",
  conversationId: "conv-1",
  proposalId: "prop-1",
  taskId: "task-1",
  operationId: "op-1",
  actorId: "user-owner",
};

function makeRepo(overrides: Partial<ProposalLinkRepository> = {}): ProposalLinkRepository {
  return {
    async linkProposal(input) {
      const { orgId, ...rest } = input;
      return { link: { id: "link-1", organizationId: orgId, ...rest, createdAt: "now" }, replayed: false };
    },
    async linksForConversation() {
      return [];
    },
    ...overrides,
  };
}

describe("linkProposalToTask", () => {
  it("records an explicit human link", async () => {
    const result = await linkProposalToTask(makeRepo(), BASE);
    expect(result.kind).toBe("linked");
    if (result.kind === "linked") {
      expect(result.link.proposalId).toBe("prop-1");
      expect(result.link.taskId).toBe("task-1");
      expect(result.replayed).toBe(false);
    }
  });

  it("replays the same operation idempotently", async () => {
    const repo = makeRepo({
      async linkProposal(input) {
        return { link: { id: "link-1", ...input, createdAt: "now" }, replayed: true };
      },
    });
    const result = await linkProposalToTask(repo, BASE);
    expect(result.kind).toBe("linked");
    if (result.kind === "linked") expect(result.replayed).toBe(true);
  });

  it("conflicts when the proposal is already linked by a different operation", async () => {
    const repo = makeRepo({
      async linkProposal() {
        const e = new Error("proposal_already_linked") as Error & { code: string };
        e.code = "P0030";
        throw e;
      },
    });
    const result = await linkProposalToTask(repo, { ...BASE, operationId: "op-2" });
    expect(result.kind).toBe("conflict");
  });

  it("rejects cross-org or missing tasks without creating anything", async () => {
    const repo = makeRepo({
      async linkProposal() {
        throw new Error("task_not_found");
      },
    });
    const result = await linkProposalToTask(repo, { ...BASE, taskId: "task-in-other-org" });
    expect(result.kind).toBe("rejected");
  });
});
