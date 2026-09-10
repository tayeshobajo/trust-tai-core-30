/**
 * Taking a single exception, on the record.
 *
 * A flagged item is exactly what bulk approval refuses, so the only way past
 * it is one person accepting one item and saying why. These tests hold that
 * line: the reason is mandatory, the authority gate still governs the write,
 * the record keeps who and why, and nothing else in the batch moves.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { blogBatchSubmission } from "@/data/approvals/submissions";
import { itemOverrideRefusal, readyItemIds } from "@/domain/approvals";

import { createFakeSupabase } from "./fake-supabase";

const db = createFakeSupabase();

vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: { from: (table: string) => db.from(table) },
}));

const { approvalsService } = await import("./approvals-service");

const CONTEXT = { organizationId: "org-1", userId: "user-1" };
const DECIDER = { id: "user-1", label: "Tai" };

beforeEach(() => {
  for (const key of Object.keys(db.tables)) db.tables[key] = [];
});

const batch = () =>
  blogBatchSubmission({
    batchId: "batch-1",
    campaignName: "Spring series",
    items: [
      { slug: "a", title: "Post A", state: "ready", hitScore: 82 },
      {
        slug: "b",
        title: "Post B",
        state: "exception",
        exceptionReasons: ["low_confidence"],
        hitScore: 44,
      },
      {
        slug: "c",
        title: "Post C",
        state: "exception",
        exceptionReasons: ["low_confidence"],
        hitScore: 41,
      },
    ],
  });

async function load() {
  const request = await approvalsService.submit(CONTEXT, batch());
  const detail = await approvalsService.get(CONTEXT, request.id);
  return { request, items: detail!.items };
}

describe("bulk approval and exceptions", () => {
  it("never offers an exception item to bulk approval", async () => {
    const { items } = await load();
    const ready = readyItemIds(items);
    expect(ready).toHaveLength(1);
    expect(items.filter((item) => item.state === "exception")).toHaveLength(2);
    expect(ready).not.toContain(items[1]!.id);
  });

  it("still approves the ready items in one move, untouched by this change", async () => {
    const { request, items } = await load();
    const ready = readyItemIds(items);

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
    expect(after!.items.filter((item) => item.state === "approved")).toHaveLength(1);
    expect(after!.items.filter((item) => item.state === "exception")).toHaveLength(2);
  });
});

describe("per-item override", () => {
  it("refuses without a reason", async () => {
    const { request, items } = await load();
    const flagged = items[1]!;

    await expect(
      approvalsService.overrideItem(CONTEXT, {
        requestId: request.id,
        itemId: flagged.id,
        reason: "  ",
        actor: DECIDER,
        refusal: null,
      }),
    ).rejects.toThrow(/why/i);

    const after = await approvalsService.get(CONTEXT, request.id);
    expect(after!.items[1]!.state).toBe("exception");
  });

  it("refuses a person who may not decide here", async () => {
    const { request, items } = await load();

    await expect(
      approvalsService.overrideItem(CONTEXT, {
        requestId: request.id,
        itemId: items[1]!.id,
        reason: "Read it end to end and it is right.",
        actor: { id: "user-9", label: "Sam" },
        refusal: "Approving work is a leadership act. Ask an owner or admin.",
      }),
    ).rejects.toThrow(/leadership act/i);

    const after = await approvalsService.get(CONTEXT, request.id);
    expect(after!.items[1]!.state).toBe("exception");
    const events = await approvalsService.events(CONTEXT, request.id);
    expect(events.some((event) => event.kind === "item_override")).toBe(false);
  });

  it("records actor, reason and time, and moves only that item", async () => {
    const { request, items } = await load();
    const flagged = items[1]!;

    const updated = await approvalsService.overrideItem(CONTEXT, {
      requestId: request.id,
      itemId: flagged.id,
      reason: "Read it end to end and the claim holds.",
      actor: DECIDER,
      refusal: null,
    });
    expect(updated.state).toBe("approved");

    const after = await approvalsService.get(CONTEXT, request.id);
    expect(after!.items[0]!.state).toBe("ready");
    expect(after!.items[2]!.state).toBe("exception");
    expect(after!.items[2]!.facts["override"]).toBeUndefined();

    const override = after!.items[1]!.facts["override"] as Record<string, unknown>;
    expect(override["reason"]).toBe("Read it end to end and the claim holds.");
    expect((override["by"] as { id: string }).id).toBe("user-1");
    expect(typeof override["at"]).toBe("string");

    const event = (await approvalsService.events(CONTEXT, request.id)).find(
      (entry) => entry.kind === "item_override",
    );
    expect(event!.actor.id).toBe("user-1");
    expect(event!.metadata["itemId"]).toBe(flagged.id);
    expect(event!.metadata["reason"]).toBe("Read it end to end and the claim holds.");
  });

  it("approves without queueing or publishing anything", async () => {
    const { request, items } = await load();
    await approvalsService.overrideItem(CONTEXT, {
      requestId: request.id,
      itemId: items[1]!.id,
      reason: "Judged it myself.",
      actor: DECIDER,
      refusal: null,
    });

    const after = await approvalsService.get(CONTEXT, request.id);
    expect(after!.request.status).toBe("needs_review");
    expect(after!.request.downstream).toBeUndefined();
    expect(db.tables["content_publish_attempts"] ?? []).toHaveLength(0);
  });

  it("refuses an item that is not flagged", async () => {
    const { request, items } = await load();
    await expect(
      approvalsService.overrideItem(CONTEXT, {
        requestId: request.id,
        itemId: items[0]!.id,
        reason: "Looks fine to me.",
        actor: DECIDER,
        refusal: null,
      }),
    ).rejects.toThrow(/needs you specifically/i);
  });
});

describe("the override gate itself", () => {
  it("keeps the card's own authority answer first", () => {
    expect(
      itemOverrideRefusal({ refusal: "Nope.", itemState: "exception", reason: "Good enough." }),
    ).toBe("Nope.");
  });

  it("allows a flagged item with a real reason", () => {
    expect(
      itemOverrideRefusal({ refusal: null, itemState: "exception", reason: "Checked it." }),
    ).toBeNull();
  });
});
