/**
 * The queue must be honest in both directions: everything parked at a human
 * boundary is in it, and nothing else is. These tests hold that line on the
 * Comms intake hook, including the part that matters most in production, that
 * a room resubmitting the same draft never doubles the work waiting.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CommsDraft, Relationship } from "@/domain/comms";

import { createFakeSupabase } from "@/data/supabase/fake-supabase";

const db = createFakeSupabase();

vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: { from: (table: string) => db.from(table) },
}));

const { submitCommsDraftIfAwaitingHuman } = await import("./intake");
const { approvalsService } = await import("@/data/supabase/approvals-service");

const CONTEXT = { organizationId: "org-1", userId: "user-1" };

const relationship = {
  id: "rel-1",
  organizationId: "org-1",
  fullName: "Ada Rowe",
  companyName: "Northbeam",
  stage: "nurture",
  source: "scout",
  observed: [],
  inferred: [],
  decided: [],
  metadata: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as unknown as Relationship;

function draft(overrides: Partial<CommsDraft> = {}): CommsDraft {
  return {
    id: "draft-1",
    organizationId: "org-1",
    relationshipId: "rel-1",
    intent: "follow_up",
    register: "warm_direct",
    subject: "Following up",
    body: "Good to meet you.",
    voiceVersion: 1,
    reviewState: "needs_human_review",
    rationale: { why: "She asked for a summary after the call." },
    evidence: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  } as CommsDraft;
}

beforeEach(() => {
  for (const key of Object.keys(db.tables)) db.tables[key] = [];
});

describe("comms intake", () => {
  it("puts a draft waiting on a person into the queue", async () => {
    const request = await submitCommsDraftIfAwaitingHuman(draft(), relationship, CONTEXT);

    expect(request).not.toBeNull();
    expect(request!.approvalType).toBe("comms_draft");
    expect(db.tables["approval_requests"]).toHaveLength(1);
  });

  it("leaves drafts that are not at a human boundary alone", async () => {
    for (const state of ["draft", "approved", "sending", "sent", "discarded"] as const) {
      const result = await submitCommsDraftIfAwaitingHuman(
        draft({ reviewState: state }),
        relationship,
        CONTEXT,
      );
      expect(result).toBeNull();
    }
    expect(db.tables["approval_requests"] ?? []).toHaveLength(0);
  });

  it("never doubles the queue when the same draft is saved again", async () => {
    const first = await submitCommsDraftIfAwaitingHuman(draft(), relationship, CONTEXT);
    const second = await submitCommsDraftIfAwaitingHuman(
      draft({ body: "Good to meet you yesterday." }),
      relationship,
      CONTEXT,
    );

    expect(second!.id).toBe(first!.id);
    expect(db.tables["approval_requests"]).toHaveLength(1);
  });

  it("does not reopen a decision a person already made", async () => {
    const request = await submitCommsDraftIfAwaitingHuman(draft(), relationship, CONTEXT);
    await approvalsService.decide(CONTEXT, {
      requestId: request!.id,
      to: "rejected",
      decision: {
        decision: "reject",
        decidedBy: { id: "user-1", label: "Tai" },
        decidedAt: new Date().toISOString(),
        reason: "Wrong moment.",
      },
    });

    const again = await submitCommsDraftIfAwaitingHuman(draft(), relationship, CONTEXT);
    expect(again!.status).toBe("rejected");
    expect(db.tables["approval_requests"]).toHaveLength(1);
  });
});
