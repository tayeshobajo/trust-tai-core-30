/**
 * Integration tests for the live Approvals persistence layer.
 *
 * These run the real service, the real row mappers and the real state machine
 * against an in-memory Supabase stand-in, so they check what actually matters:
 * that a resubmit does not flood the queue, that a decided request cannot be
 * quietly reopened, that approving does not execute, and that partial approval
 * of a batch leaves the exceptions exactly where they were.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  blogBatchSubmission,
  commsDraftSubmission,
  scoutRelationshipSubmission,
} from "@/data/approvals/submissions";

import { createFakeSupabase } from "./fake-supabase";

const db = createFakeSupabase();

vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: {
    from: (table: string) => db.from(table),
  },
}));

const { approvalsService } = await import("./approvals-service");

const CONTEXT = { organizationId: "org-1", userId: "user-1" };
const DECIDER = { id: "user-1", label: "Tai" };

beforeEach(() => {
  for (const key of Object.keys(db.tables)) db.tables[key] = [];
});

function draft() {
  return commsDraftSubmission({
    relationshipId: "rel-1",
    personName: "Ada Rowe",
    companyName: "Northbeam",
    channel: "email",
    subject: "Following up",
    body: "Good to meet you.",
    reasoning: "She asked for a summary after the call.",
  });
}

describe("submission", () => {
  it("records the request and opens the trail with the reason a person is needed", async () => {
    const request = await approvalsService.submit(CONTEXT, draft());

    expect(request.status).toBe("ready");
    expect(request.sourceEntity.id).toBe("rel-1");
    expect(request.requiredCapability).toBe("comms.write");
    expect(db.tables["approval_requests"]).toHaveLength(1);

    const events = await approvalsService.events(CONTEXT, request.id);
    expect(events[0]!.kind).toBe("submitted");
  });

  it("never turns the same source state into two decisions", async () => {
    const first = await approvalsService.submit(CONTEXT, draft());
    const second = await approvalsService.submit(CONTEXT, {
      ...draft(),
      summary: "A revised subject line",
    });

    expect(second.id).toBe(first.id);
    expect(db.tables["approval_requests"]).toHaveLength(1);
    expect(second.summary).toBe("A revised subject line");
  });

  it("refuses to reopen a decision that has already been made", async () => {
    const request = await approvalsService.submit(CONTEXT, draft());
    await approvalsService.decide(CONTEXT, {
      requestId: request.id,
      to: "rejected",
      decision: {
        decision: "reject",
        decidedBy: DECIDER,
        decidedAt: new Date().toISOString(),
        reason: "Wrong moment.",
      },
    });

    const resubmitted = await approvalsService.submit(CONTEXT, draft());
    expect(resubmitted.status).toBe("rejected");
    expect(db.tables["approval_requests"]).toHaveLength(1);
  });

  it("counts a revision only when the source app answers a revision request", async () => {
    const request = await approvalsService.submit(CONTEXT, draft());
    expect(request.revision).toBe(1);

    await approvalsService.decide(CONTEXT, {
      requestId: request.id,
      to: "revision_requested",
      decision: {
        decision: "request_revision",
        decidedBy: DECIDER,
        decidedAt: new Date().toISOString(),
        reason: "Too formal.",
      },
    });

    const again = await approvalsService.submit(CONTEXT, draft());
    expect(again.revision).toBe(2);
    expect(again.status).toBe("ready");
  });

  it("keeps a request that lacks context out of the ready column", async () => {
    const request = await approvalsService.submit(
      CONTEXT,
      scoutRelationshipSubmission({
        prospectId: "p-1",
        companyName: "Northbeam",
        fitScore: 84,
        fitReasons: ["Right size, right sector."],
        gaps: ["No decision maker identified yet."],
      }),
    );
    expect(request.status).toBe("needs_context");
    expect(request.whyItNeedsYou).toBe("No decision maker identified yet.");
  });
});

describe("deciding", () => {
  it("records authority without performing the work", async () => {
    const request = await approvalsService.submit(CONTEXT, draft());
    const approved = await approvalsService.decide(CONTEXT, {
      requestId: request.id,
      to: "approved",
      decision: { decision: "approve", decidedBy: DECIDER, decidedAt: new Date().toISOString() },
    });

    expect(approved.status).toBe("approved");
    expect(approved.decision?.decidedBy.id).toBe("user-1");
    expect(approved.downstream).toBeUndefined();
  });

  it("refuses to jump a request straight to executed", async () => {
    const request = await approvalsService.submit(CONTEXT, draft());
    await expect(
      approvalsService.decide(CONTEXT, {
        requestId: request.id,
        to: "executed",
        decision: { decision: "approve", decidedBy: DECIDER, decidedAt: new Date().toISOString() },
      }),
    ).rejects.toThrow(/cannot move/i);
  });

  it("records an honest downstream state after the handover", async () => {
    const request = await approvalsService.submit(CONTEXT, draft());
    await approvalsService.decide(CONTEXT, {
      requestId: request.id,
      to: "approved",
      decision: { decision: "approve", decidedBy: DECIDER, decidedAt: new Date().toISOString() },
    });
    await approvalsService.recordDownstream(
      CONTEXT,
      request.id,
      {
        state: "queued",
        adapterId: "comms.send_queue",
        because: "Approved for sending.",
        at: new Date().toISOString(),
      },
      "queued",
    );

    const after = await approvalsService.get(CONTEXT, request.id);
    expect(after!.request.status).toBe("queued");
    expect(after!.request.downstream?.adapterId).toBe("comms.send_queue");
  });

  it("keeps a note on the record with the person who wrote it", async () => {
    const request = await approvalsService.submit(CONTEXT, draft());
    await approvalsService.addNote(CONTEXT, request.id, "Check the pricing line.", DECIDER);

    const events = await approvalsService.events(CONTEXT, request.id);
    const note = events.find((event) => event.kind === "note");
    expect(note!.body).toBe("Check the pricing line.");
    expect(note!.actor.label).toBe("Tai");
  });
});

describe("batches", () => {
  const batch = () =>
    blogBatchSubmission({
      batchId: "batch-1",
      campaignName: "Spring series",
      items: [
        { slug: "a", title: "Post A", state: "ready", hitScore: 82 },
        { slug: "b", title: "Post B", state: "ready", hitScore: 78 },
        {
          slug: "c",
          title: "Post C",
          state: "exception",
          exceptionReasons: ["voice_mismatch"],
          hitScore: 41,
        },
      ],
    });

  it("surfaces the exceptions rather than burying them in a count", async () => {
    const request = await approvalsService.submit(CONTEXT, batch());
    expect(request.batch).toMatchObject({ total: 3, ready: 2, exceptions: 1 });
    expect(request.status).toBe("needs_review");
  });

  it("approves only the items the person chose, leaving exceptions untouched", async () => {
    const request = await approvalsService.submit(CONTEXT, batch());
    const loaded = await approvalsService.get(CONTEXT, request.id);
    const ready = loaded!.items.filter((item) => item.state === "ready").map((item) => item.id);

    await approvalsService.decide(CONTEXT, {
      requestId: request.id,
      to: "approved",
      decision: {
        decision: "approve",
        decidedBy: DECIDER,
        decidedAt: new Date().toISOString(),
        itemIds: ready,
      },
      itemIds: ready,
    });

    const after = await approvalsService.get(CONTEXT, request.id);
    expect(after!.items.filter((item) => item.state === "approved")).toHaveLength(2);
    expect(after!.items.filter((item) => item.state === "exception")).toHaveLength(1);
  });

  it("does not double the batch when the source app resubmits it", async () => {
    await approvalsService.submit(CONTEXT, batch());
    await approvalsService.submit(CONTEXT, batch());
    expect(db.tables["approval_items"]).toHaveLength(3);
  });
});

describe("scoping", () => {
  it("never returns another organization's decisions", async () => {
    await approvalsService.submit(CONTEXT, draft());
    const other = await approvalsService.list({ organizationId: "org-2", userId: "user-9" });
    expect(other).toHaveLength(0);
  });
});
