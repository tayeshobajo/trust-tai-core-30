/**
 * What an approval is, and what it is not.
 *
 * These tests hold the architecture law in place: the source app prepares, the
 * Approvals room records the judgment, and the source app executes through its
 * own governed path. Approving comms copy must never send it, approving a
 * prospect must never open a second relationship, and a decision that cannot
 * be applied must say so rather than report success.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeSupabase } from "@/data/supabase/fake-supabase";

const db = createFakeSupabase();

vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: { from: (table: string) => db.from(table) },
}));

const { approvalsService } = await import("@/data/supabase/approvals-service");
const { submitCommsDraftForApproval } = await import("./sources");
const { executeApprovedRequest } = await import("./execution");

const CONTEXT = { organizationId: "org-1", userId: "user-1" };
const DECIDER = { id: "user-1", label: "Tai" };

function seedRelationship(id = "rel-1") {
  db.tables["comms_relationships"] = [
    {
      id,
      organization_id: CONTEXT.organizationId,
      full_name: "Ada Rowe",
      company_name: "Northbeam",
      email: "ada@northbeam.test",
      stage: "new",
      segment: "nurture",
      source: "scout_handoff",
      prospect_id: "prospect-1",
      created_at: new Date().toISOString(),
    },
  ];
  return id;
}

function seedDraft(reviewState = "needs_human_review", id = "draft-1") {
  db.tables["comms_drafts"] = [
    {
      id,
      organization_id: CONTEXT.organizationId,
      relationship_id: "rel-1",
      intent: "Follow up after the call",
      register: "follow_up",
      subject: "Following up",
      body: "Good to meet you.",
      voice_version: "v1",
      review_state: reviewState,
      rationale: { why: "She asked for a summary after the call." },
      evidence: [],
      created_by: CONTEXT.userId,
      created_at: new Date().toISOString(),
    },
  ];
  return id;
}

async function approve(requestId: string) {
  return approvalsService.decide(CONTEXT, {
    requestId,
    to: "approved",
    decision: { decision: "approve", decidedBy: DECIDER, decidedAt: new Date().toISOString() },
  });
}

beforeEach(() => {
  for (const key of Object.keys(db.tables)) db.tables[key] = [];
  seedRelationship();
});

describe("a real Comms draft through Approvals", () => {
  it("submits the draft itself, so two drafts to one person are two decisions", async () => {
    seedDraft();
    const first = await submitCommsDraftForApproval("draft-1", CONTEXT);
    expect(first.request.sourceKey).toContain("draft:draft-1");
    expect(first.request.payload?.["draftId"]).toBe("draft-1");
    expect(first.request.requiredCapability).toBe("comms.write");

    const again = await submitCommsDraftForApproval("draft-1", CONTEXT);
    expect(again.request.id).toBe(first.request.id);
    expect(db.tables["approval_requests"]!).toHaveLength(1);
  });

  it("approves the copy in Comms and stops there, sending nothing", async () => {
    seedDraft();
    const { request } = await submitCommsDraftForApproval("draft-1", CONTEXT);
    const approved = await approve(request.id);
    const outcome = await executeApprovedRequest(approved, CONTEXT);

    expect(outcome.result.state).toBe("queued");
    expect(outcome.nextStatus).toBe("queued");
    expect(db.tables["comms_drafts"]![0]!["review_state"]).toBe("approved");
    /* No message store is written by an approval. Only a real send does that. */
    expect(db.tables["comms_messages"] ?? []).toHaveLength(0);
  });

  it("refuses to submit something Comms has already sent", async () => {
    seedDraft("sent");
    await expect(submitCommsDraftForApproval("draft-1", CONTEXT)).rejects.toThrow(/already sent/i);
  });

  it("says plainly when the decision could not be applied", async () => {
    seedDraft();
    const { request } = await submitCommsDraftForApproval("draft-1", CONTEXT);
    const approved = await approve(request.id);
    db.tables["comms_drafts"]![0]!["review_state"] = "sent";

    const outcome = await executeApprovedRequest(approved, CONTEXT);
    expect(outcome.result.state).toBe("failed");
    expect(outcome.nextStatus).toBeUndefined();
  });
});

describe("a Scout prospect through Approvals", () => {
  it("records the decision honestly when Scout attached no brief", async () => {
    const request = await approvalsService.submit(CONTEXT, {
      sourceApp: "scout",
      category: "qualification",
      approvalType: "scout_relationship",
      title: "Northbeam",
      summary: "Strong fit.",
      whyItNeedsYou: "A person decides who we build a relationship with.",
      sourceEntity: { type: "prospect", id: "prospect-1", label: "Northbeam" },
      requiredCapability: "scout.write",
      boundary: {
        willDo: ["Open the relationship in Comms."],
        willNotDo: ["Send anything."],
      },
    });
    const approved = await approve(request.id);
    const outcome = await executeApprovedRequest(approved, CONTEXT);

    expect(outcome.result.state).toBe("unavailable");
    expect(db.tables["comms_relationships"]!).toHaveLength(1);
  });
});
