import { describe, expect, it } from "vitest";
import {
  dismissLedgerProposal,
  registerExtractedProposals,
  toRegistrationPayload,
  TranscriptChangedError,
  type LedgerProposal,
  type ProposalLedgerRepository,
} from "./steward-proposal-ledger.server";

const BASE = {
  orgId: "org-a",
  conversationId: "conv-1",
  operationId: "op-1",
  actorId: "user-owner",
};

function makeProposal(partial: Partial<LedgerProposal> = {}): LedgerProposal {
  return {
    id: "ledger-1",
    organizationId: BASE.orgId,
    conversationId: BASE.conversationId,
    sourceKey: "fathom:3948:abc",
    kind: "action",
    statement: "Roadmap proposal at 39:48",
    status: "proposed",
    ...partial,
  };
}

function makeRepo(overrides: Partial<ProposalLedgerRepository> = {}): ProposalLedgerRepository {
  return {
    async registerProposals() {
      return 2;
    },
    async dismissProposal() {
      return makeProposal({ status: "dismissed" });
    },
    async ledgerForConversation() {
      return [];
    },
    ...overrides,
  };
}

describe("toRegistrationPayload", () => {
  it("maps extractProposals output: proposal.id IS the source key", () => {
    const payload = toRegistrationPayload([
      { id: "fathom:3948:abc", kind: "action", statement: "Roadmap proposal at 39:48" },
    ]);
    expect(payload).toEqual([
      { sourceKey: "fathom:3948:abc", kind: "action", statement: "Roadmap proposal at 39:48" },
    ]);
  });
});

describe("registerExtractedProposals", () => {
  it("registers proposals with the transcript they were extracted from", async () => {
    let seen: { transcript?: unknown; proposals?: unknown } = {};
    const repo = makeRepo({
      async registerProposals(input) {
        seen = input;
        return input.proposals.length;
      },
    });
    const result = await registerExtractedProposals(repo, {
      ...BASE,
      proposals: [{ id: "k1", kind: "action", statement: "s1" }],
      transcript: { segments: [] },
    });
    expect(result).toEqual({ kind: "registered", added: 1 });
    expect(seen.transcript).toEqual({ segments: [] });
  });

  it("surfaces a stale-transcript conflict honestly", async () => {
    const repo = makeRepo({
      async registerProposals() {
        throw new TranscriptChangedError();
      },
    });
    const result = await registerExtractedProposals(repo, {
      ...BASE,
      proposals: [],
      transcript: {},
    });
    expect(result.kind).toBe("transcript_changed");
  });

  it("reports other failures as rejected without swallowing the message", async () => {
    const repo = makeRepo({
      async registerProposals() {
        throw new Error("not_authorized");
      },
    });
    const result = await registerExtractedProposals(repo, {
      ...BASE,
      proposals: [],
      transcript: {},
    });
    expect(result).toEqual({ kind: "rejected", message: "not_authorized" });
  });
});

describe("dismissLedgerProposal", () => {
  it("requires a substantive reason", async () => {
    const result = await dismissLedgerProposal(makeRepo(), {
      ...BASE,
      proposalId: "ledger-1",
      reason: "no",
    });
    expect(result.kind).toBe("rejected");
  });

  it("dismisses with a reason and returns the updated row", async () => {
    const result = await dismissLedgerProposal(makeRepo(), {
      ...BASE,
      proposalId: "ledger-1",
      reason: "Reviewed: covered by the existing roadmap task.",
    });
    expect(result.kind).toBe("dismissed");
    if (result.kind === "dismissed") expect(result.proposal.status).toBe("dismissed");
  });

  it("maps an already-linked conflict", async () => {
    const repo = makeRepo({
      async dismissProposal() {
        const err = new Error("proposal_already_linked");
        (err as { code?: string }).code = "P0030";
        throw err;
      },
    });
    const result = await dismissLedgerProposal(repo, {
      ...BASE,
      proposalId: "ledger-1",
      reason: "Reviewed: covered by the existing roadmap task.",
    });
    expect(result.kind).toBe("conflict");
  });
});
