/**
 * The production gap this file exists for.
 *
 * A person accepted one flagged article. The item moved to `approved`, then the
 * trail insert was rejected because the client invented an `item_override`
 * event kind the ledger's check constraint does not allow. The approval
 * survived; the record of it did not. These tests hold the two lines that
 * failure crossed: the ledger only ever sees a kind it accepts, and an item can
 * never stay approved when its decision was not written down.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { blogBatchSubmission } from "@/data/approvals/submissions";
import { readEventKind, storedEventKind, STORED_EVENT_KINDS } from "@/domain/approvals";

import { createFakeSupabase } from "./fake-supabase";

const db = createFakeSupabase();

/** Every kind the real `approval_events_kind_check` accepts. */
const ALLOWED = new Set<string>(STORED_EVENT_KINDS);

/** What the ledger was asked to store, and whether it refuses the next insert. */
const ledger = { kinds: [] as string[], failNextEvent: false };

vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: {
    from: (table: string) => {
      const real = db.from(table);
      if (table !== "approval_events") return real;
      return {
        ...real,
        insert: (body: Record<string, unknown>) => {
          const kind = String(body["kind"]);
          ledger.kinds.push(kind);
          if (ledger.failNextEvent || !ALLOWED.has(kind)) {
            ledger.failNextEvent = false;
            /* Exactly what Postgres answered in production. */
            return {
              then: (resolve: (value: unknown) => unknown) =>
                Promise.resolve(
                  resolve({
                    data: null,
                    error: {
                      code: "23514",
                      message:
                        'new row for relation "approval_events" violates check constraint "approval_events_kind_check"',
                    },
                  }),
                ),
            };
          }
          return real.insert(body);
        },
      };
    },
  },
}));

const { approvalsService } = await import("./approvals-service");

const CONTEXT = { organizationId: "org-1", userId: "user-1" };
const DECIDER = { id: "user-1", label: "Tai" };

beforeEach(() => {
  for (const key of Object.keys(db.tables)) db.tables[key] = [];
  ledger.kinds = [];
  ledger.failNextEvent = false;
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

const override = (requestId: string, itemId: string, reason = "Read it end to end.") =>
  approvalsService.overrideItem(CONTEXT, {
    requestId,
    itemId,
    reason,
    actor: DECIDER,
    refusal: null,
  });

describe("the event kind the database accepts", () => {
  it("stores an override as the canonical decision kind", () => {
    expect(storedEventKind("item_override")).toBe("decision");
    expect(ALLOWED.has(storedEventKind("item_override"))).toBe(true);
  });

  it("reads a scoped decision back as an override, and leaves others alone", () => {
    expect(readEventKind("decision", { scope: "item_override" })).toBe("item_override");
    expect(readEventKind("decision", {})).toBe("decision");
    expect(readEventKind("note", {})).toBe("note");
  });

  it("never sends a kind outside the check constraint", async () => {
    const { request, items } = await load();
    await override(request.id, items[1]!.id);
    expect(ledger.kinds.length).toBeGreaterThan(0);
    for (const kind of ledger.kinds) expect(ALLOWED.has(kind)).toBe(true);
  });
});

describe("state and audit move together", () => {
  it("records the item, its provenance and exactly one audit event", async () => {
    const { request, items } = await load();
    await override(request.id, items[1]!.id, "The claim holds.");

    const after = await approvalsService.get(CONTEXT, request.id);
    expect(after!.items[1]!.state).toBe("approved");
    const provenance = after!.items[1]!.facts["override"] as Record<string, unknown>;
    expect(provenance["reason"]).toBe("The claim holds.");
    expect((provenance["by"] as { id: string }).id).toBe("user-1");

    const events = (await approvalsService.events(CONTEXT, request.id)).filter(
      (event) => event.kind === "item_override",
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.actor.id).toBe("user-1");
    expect(events[0]!.metadata["itemId"]).toBe(items[1]!.id);
    expect(events[0]!.metadata["scope"]).toBe("item_override");
  });

  it("leaves the item flagged when the trail refuses the decision", async () => {
    const { request, items } = await load();
    ledger.failNextEvent = true;

    await expect(override(request.id, items[1]!.id)).rejects.toThrow(/not recorded/i);

    const after = await approvalsService.get(CONTEXT, request.id);
    expect(after!.items[1]!.state).toBe("exception");
    expect(after!.items[1]!.facts["override"]).toBeUndefined();
    const events = await approvalsService.events(CONTEXT, request.id);
    expect(events.some((event) => event.kind === "item_override")).toBe(false);
  });

  it("touches only the item that was accepted, and publishes nothing", async () => {
    const { request, items } = await load();
    await override(request.id, items[1]!.id);

    const after = await approvalsService.get(CONTEXT, request.id);
    expect(after!.items[0]!.state).toBe("ready");
    expect(after!.items[2]!.state).toBe("exception");
    expect(after!.request.status).toBe("needs_review");
    expect(after!.request.downstream).toBeUndefined();
    expect(db.tables["content_publish_attempts"] ?? []).toHaveLength(0);
  });
});

describe("repairing an approval whose event was lost", () => {
  /** Reproduce the production row: approved, with provenance, with no event. */
  async function partiallyCommitted() {
    const { request, items } = await load();
    ledger.failNextEvent = true;
    await override(request.id, items[1]!.id, "Looks good").catch(() => undefined);
    const row = db.tables["approval_items"]!.find((entry) => entry["id"] === items[1]!.id)!;
    row["state"] = "approved";
    row["facts"] = {
      ...(row["facts"] as Record<string, unknown>),
      override: {
        itemId: items[1]!.id,
        reason: "Looks good",
        by: DECIDER,
        at: "2026-09-06T05:35:03.324Z",
      },
    };
    return { request, items };
  }

  it("writes one event from the existing provenance, without re-deciding", async () => {
    const { request, items } = await partiallyCommitted();

    expect(
      await approvalsService.backfillItemOverrideEvent(CONTEXT, {
        requestId: request.id,
        itemId: items[1]!.id,
      }),
    ).toBe("written");

    const events = (await approvalsService.events(CONTEXT, request.id)).filter(
      (event) => event.kind === "item_override",
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.actor.id).toBe("user-1");
    expect(events[0]!.metadata["reason"]).toBe("Looks good");
    expect(events[0]!.metadata["at"]).toBe("2026-09-06T05:35:03.324Z");
    expect(events[0]!.createdAt).toBe("2026-09-06T05:35:03.324Z");

    const after = await approvalsService.get(CONTEXT, request.id);
    expect(after!.items[1]!.state).toBe("approved");
    expect(after!.items[0]!.state).toBe("ready");
    expect(after!.items[2]!.state).toBe("exception");
    expect(after!.request.downstream).toBeUndefined();
    expect(db.tables["content_publish_attempts"] ?? []).toHaveLength(0);
  });

  it("is idempotent on replay", async () => {
    const { request, items } = await partiallyCommitted();
    await approvalsService.backfillItemOverrideEvent(CONTEXT, {
      requestId: request.id,
      itemId: items[1]!.id,
    });
    expect(
      await approvalsService.backfillItemOverrideEvent(CONTEXT, {
        requestId: request.id,
        itemId: items[1]!.id,
      }),
    ).toBe("already_recorded");

    const events = (await approvalsService.events(CONTEXT, request.id)).filter(
      (event) => event.kind === "item_override",
    );
    expect(events).toHaveLength(1);
  });

  it("does nothing for an item that was never accepted", async () => {
    const { request, items } = await load();
    expect(
      await approvalsService.backfillItemOverrideEvent(CONTEXT, {
        requestId: request.id,
        itemId: items[2]!.id,
      }),
    ).toBe("not_applicable");
  });
});
