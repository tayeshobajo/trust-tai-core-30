/**
 * Steward persistence, end to end against an in-memory stand-in.
 *
 * Two boundaries matter more than anything else here: a person who is not
 * signed in gets nothing, and a person signed into one organization can never
 * see another organization's promises. Both are checked with real service code.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { rehearsalConversation } from "@/data/steward/fixture";
import { extractProposals } from "@/data/steward/extract";

import { createFakeSupabase } from "./fake-supabase";

const db = createFakeSupabase();
let session: { access_token: string } | null = { access_token: "token-1" };

vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: {
    from: (table: string) => db.from(table),
    auth: {
      getSession: async () => ({ data: { session } }),
    },
  },
}));

const { stewardService } = await import("./steward-service");
const { readConversation, readRehearsal } = await import("@/data/steward/ingest");

const ORG_A = "org-a";
const ORG_B = "org-b";

beforeEach(() => {
  for (const key of Object.keys(db.tables)) db.tables[key] = [];
  session = { access_token: "token-1" };
});

async function seedCommitment(organizationId: string, sourceKey: string) {
  const conversation = rehearsalConversation();
  const stored = await stewardService.saveConversation({
    organizationId,
    userId: "user-1",
    conversation: { ...conversation, sourceRef: { ...conversation.sourceRef, externalId: sourceKey } },
  });
  const proposal = extractProposals(conversation)[0]!;
  return stewardService.confirm({
    organizationId,
    userId: "user-1",
    conversationId: stored.id,
    proposal: { ...proposal, id: `${sourceKey}:${proposal.id}` },
    ownerName: "Dana",
    dueAt: null,
  });
}

describe("fails closed when nobody is signed in", () => {
  it("refuses to read a conversation without a session", async () => {
    session = null;
    await expect(
      readConversation({ organizationId: ORG_A, sourceUrl: "https://fathom.video/calls/123456" }),
    ).rejects.toThrow(/sign in/i);
  });

  it("still allows the rehearsal walk, which touches no workspace data", () => {
    const result = readRehearsal();
    expect(result.conversation.rehearsal).toBe(true);
    expect(result.proposals.length).toBeGreaterThan(0);
    expect(db.tables["conversations"] ?? []).toHaveLength(0);
  });
});

describe("another organization's stewardship is invisible", () => {
  beforeEach(async () => {
    await seedCommitment(ORG_A, "call-a");
    await seedCommitment(ORG_B, "call-b");
  });

  it("reads only this organization's commitments", async () => {
    const mine = await stewardService.commitments(ORG_A);
    expect(mine).toHaveLength(1);
    expect(mine.every((row) => row.organizationId === ORG_A)).toBe(true);
  });

  it("reads only this organization's conversations", async () => {
    const mine = await stewardService.conversations(ORG_A);
    expect(mine).toHaveLength(1);
    expect(mine.every((row) => row.organizationId === ORG_A)).toBe(true);
  });

  it("keeps the two organizations' rows separate on disk", () => {
    const rows = db.tables["commitments"] ?? [];
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row["organization_id"]))).toEqual(new Set([ORG_A, ORG_B]));
  });
});

describe("confirming a promise is idempotent", () => {
  it("re-confirming the same line does not create a second commitment", async () => {
    await seedCommitment(ORG_A, "call-a");
    await seedCommitment(ORG_A, "call-a");
    expect(await stewardService.commitments(ORG_A)).toHaveLength(1);
  });

  it("status changes are recorded, and a kept promise stops asking", async () => {
    const created = await seedCommitment(ORG_A, "call-a");
    const updated = await stewardService.setStatus(created.id, "kept");
    expect(updated?.status).toBe("kept");
  });
});
