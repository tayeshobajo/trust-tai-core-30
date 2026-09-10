/**
 * Service-layer tests for governed LinkedIn actions.
 *
 * Runs the real service against the in-memory Supabase stand-in with a fake
 * transport, so the behaviour that matters is pinned: the human approval
 * boundary, the state machine's illegal-transition rejections, idempotent
 * execution (never double-send), the kill switch, daily caps, audit
 * appends, and terminal-failed retries as NEW rows.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActivityStream, ActivityEvent } from "@/domain/activity";
import type { LinkiActionType, LinkiExecutionReceipt } from "@/domain/linki-actions";

import { createFakeSupabase, type FakeRow } from "./fake-supabase";
import {
  createLinkiActionService,
  receiptHash,
  type LinkiTransport,
} from "./linki-actions-service";

const db = createFakeSupabase();

vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: {
    from: (table: string) => db.from(table),
  },
}));

const recorded: ActivityEvent[] = [];
const activity: Pick<ActivityStream, "record"> = {
  async record(event) {
    const full: ActivityEvent = { ...event, id: crypto.randomUUID() };
    recorded.push(full);
    return full;
  },
};

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const TAI = "33333333-3333-4333-8333-333333333333";
const OTHER_USER = "44444444-4444-4444-8444-444444444444";
const PROSPECT = "55555555-5555-4555-8555-555555555555";
const CONTACT = "66666666-6666-4666-8666-666666666666";

const CONTEXT = { organizationId: ORG, userId: TAI };

const LINKEDIN_URL = "https://www.linkedin.com/in/markwschaefer/";

function seedContact(): void {
  db.tables["contacts"] = [
    {
      id: CONTACT,
      organization_id: ORG,
      client_id: null,
      full_name: "Mark Schaefer",
      title: "Marketing Consultant",
      email: null,
      phone: null,
      metadata: { linkedin_url: LINKEDIN_URL, linkedin_confirmed: true },
      created_by: TAI,
      created_at: "2026-08-27T00:00:00Z",
      updated_at: "2026-08-27T00:00:00Z",
    },
  ];
}

function makeInput(
  over: Partial<Parameters<ReturnType<typeof createLinkiActionService>["create"]>[0]> = {},
) {
  return {
    prospectId: PROSPECT,
    personId: CONTACT,
    contactId: CONTACT,
    actionType: "message" as LinkiActionType,
    draftBody: "Mark, your {growth} piece changed how I think about category design.",
    channelContext: { thread: "comms-rel-1", route: LINKEDIN_URL },
    idempotencyKey: `act-${crypto.randomUUID()}`,
    ...over,
  };
}

/** Transport that records every send and (by default) succeeds once. */
function fakeTransport(opts: { failWith?: Error } = {}) {
  const sends: Array<{ linkedinUrl: string; draftBody: string; idempotencyKey: string }> = [];
  const transport: LinkiTransport = async (input) => {
    sends.push({ ...input });
    if (opts.failWith) throw opts.failWith;
    return {
      receipt: {
        provider: "linki",
        runId: `run-${sends.length}`,
        sentAt: new Date().toISOString(),
        response: { ok: true },
      },
    };
  };
  return { transport, sends };
}

function service(
  env: Record<string, string | undefined> = {},
  transport: LinkiTransport = fakeTransport().transport,
) {
  return createLinkiActionService(activity, transport, env, () => "2026-08-27T15:00:00.000Z");
}

function actions(): FakeRow[] {
  return db.tables["approved_linkedin_actions"] ?? [];
}

beforeEach(() => {
  db.tables["approved_linkedin_actions"] = [];
  seedContact();
  recorded.length = 0;
});

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

describe("create", () => {
  it("starts at pending_tai_approval with the canonical linkage intact", async () => {
    const action = await service().create(makeInput(), CONTEXT);
    expect(action.status).toBe("pending_tai_approval");
    expect(action.prospectId).toBe(PROSPECT);
    expect(action.personId).toBe(CONTACT);
    expect(action.contactId).toBe(CONTACT);
    expect(action.createdBy).toBe(TAI);
    expect(action.approvedBy).toBeNull();
    expect(action.executionReceipt).toBeNull();
  });

  it("rejects a non-uuid linkage (identity must be canonical, never guessed)", async () => {
    await expect(
      service().create(makeInput({ contactId: "not-a-uuid" }), CONTEXT),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("rejects an empty draft (Comms owns the body, no message exists without it)", async () => {
    await expect(service().create(makeInput({ draftBody: "  " }), CONTEXT)).rejects.toMatchObject({
      code: "validation",
    });
  });

  it("rejects action types outside P2 scope", async () => {
    await expect(
      service().create(makeInput({ actionType: "auto_follow_up" as LinkiActionType }), CONTEXT),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("returns the existing row when the idempotency key repeats (no duplicate)", async () => {
    const input = makeInput({ idempotencyKey: "stable-key" });
    const first = await service().create(input, CONTEXT);
    const second = await service().create(input, CONTEXT);
    expect(second.id).toBe(first.id);
    expect(actions().length).toBe(1);
  });

  it("blocks creation when the contact has no confirmed LinkedIn route", async () => {
    db.tables["contacts"] = [{ ...db.tables["contacts"]![0]!, metadata: { email: "x@y.com" } }];
    await expect(service().create(makeInput(), CONTEXT)).rejects.toMatchObject({
      code: "validation",
    });
  });

  it("blocks creation when the contact does not exist in this org", async () => {
    db.tables["contacts"] = [];
    await expect(service().create(makeInput(), CONTEXT)).rejects.toMatchObject({
      code: "validation",
    });
  });
});

/* ------------------------------------------------------------------ */
/* Approve, the human boundary                                        */
/* ------------------------------------------------------------------ */

describe("approve", () => {
  it("moves pending → approved and stamps the approver forever", async () => {
    const created = await service().create(makeInput(), CONTEXT);
    const approved = await service().approve(created.id, CONTEXT);
    expect(approved.status).toBe("approved");
    expect(approved.approvedBy).toBe(TAI);
    expect(approved.approvedAt).toBe("2026-08-27T15:00:00.000Z");
  });

  it("rejects approving an already-approved action", async () => {
    const created = await service().create(makeInput(), CONTEXT);
    await service().approve(created.id, CONTEXT);
    await expect(service().approve(created.id, CONTEXT)).rejects.toMatchObject({
      code: "illegal_transition",
    });
  });

  it("rejects approving an executed action", async () => {
    const svc = service({ LINKI_EXECUTION_ENABLED: "true" });
    const created = await svc.create(makeInput(), CONTEXT);
    await svc.approve(created.id, CONTEXT);
    await svc.execute(created.id, CONTEXT);
    await expect(svc.approve(created.id, CONTEXT)).rejects.toMatchObject({
      code: "illegal_transition",
    });
  });

  it("stays organization-scoped: another org cannot approve", async () => {
    const created = await service().create(makeInput(), CONTEXT);
    await expect(
      service().approve(created.id, { organizationId: OTHER_ORG, userId: TAI }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

/* ------------------------------------------------------------------ */
/* Execute, the only send path                                        */
/* ------------------------------------------------------------------ */

describe("execute", () => {
  it("refuses to send without prior human approval", async () => {
    const created = await service({ LINKI_EXECUTION_ENABLED: "true" }).create(makeInput(), CONTEXT);
    await expect(
      service({ LINKI_EXECUTION_ENABLED: "true" }).execute(created.id, CONTEXT),
    ).rejects.toMatchObject({ code: "illegal_transition" });
  });

  it("kills the endpoint when the flag is off (kill switch, default)", async () => {
    const svc = service({});
    const created = await svc.create(makeInput(), CONTEXT);
    await svc.approve(created.id, CONTEXT);
    await expect(svc.execute(created.id, CONTEXT)).rejects.toMatchObject({
      code: "kill_switch",
      message: expect.stringContaining("LINKI_EXECUTION_ENABLED"),
    });
  });

  it("only the approver may execute, nobody else can trigger the send", async () => {
    const svc = service({ LINKI_EXECUTION_ENABLED: "true" });
    const created = await svc.create(makeInput(), CONTEXT);
    await svc.approve(created.id, CONTEXT);
    await expect(
      svc.execute(created.id, { organizationId: ORG, userId: OTHER_USER }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("sends exactly once: approved → executing → executed with a receipt", async () => {
    const { transport, sends } = fakeTransport();
    const svc = service({ LINKI_EXECUTION_ENABLED: "true" }, transport);
    const created = await svc.create(makeInput(), CONTEXT);
    await svc.approve(created.id, CONTEXT);
    const { action, alreadyDone } = await svc.execute(created.id, CONTEXT);

    expect(sends.length).toBe(1);
    expect(sends[0]!.linkedinUrl).toBe(LINKEDIN_URL);
    expect(sends[0]!.draftBody).toBe(created.draftBody);
    expect(sends[0]!.idempotencyKey).toBe(created.idempotencyKey);
    expect(action.status).toBe("executed");
    expect(action.executionReceipt?.provider).toBe("linki");
    expect(action.executionReceipt?.runId).toBe("run-1");
    expect(alreadyDone).toBe(false);
    expect(action.executedAt).toBe("2026-08-27T15:00:00.000Z");
  });

  it("IDEMPOTENT: a second execute of an executed action returns the same receipt and never re-sends", async () => {
    const { transport, sends } = fakeTransport();
    const svc = service({ LINKI_EXECUTION_ENABLED: "true" }, transport);
    const created = await svc.create(makeInput(), CONTEXT);
    await svc.approve(created.id, CONTEXT);
    const first = await svc.execute(created.id, CONTEXT);
    const second = await svc.execute(created.id, CONTEXT);

    expect(sends.length).toBe(1); // PROOF: single physical send
    expect(second.alreadyDone).toBe(true);
    expect(second.action.executionReceipt?.runId).toBe(first.action.executionReceipt?.runId);
    expect(second.action.status).toBe("executed");
  });

  it("IDEMPOTENT: an in-flight executing action is treated as done, never re-sent", async () => {
    const { transport, sends } = fakeTransport();
    const svc = service({ LINKI_EXECUTION_ENABLED: "true" }, transport);
    const created = await svc.create(makeInput(), CONTEXT);
    await svc.approve(created.id, CONTEXT);
    await svc.execute(created.id, CONTEXT);

    // Simulate a crashed client: force the row back to executing, then call
    // again, the guard must return it as already-done, not re-send.
    const row = actions().find((r) => r["id"] === created.id)!;
    row["status"] = "executing";
    const again = await svc.execute(created.id, CONTEXT);
    expect(sends.length).toBe(1);
    expect(again.alreadyDone).toBe(true);
  });

  it("transport failure marks the action failed (terminal) and records the reason", async () => {
    const boom = new Error("Linki send failed (500). Nothing was confirmed as sent.");
    const { transport } = fakeTransport({ failWith: boom });
    const svc = service({ LINKI_EXECUTION_ENABLED: "true" }, transport);
    const created = await svc.create(makeInput(), CONTEXT);
    await svc.approve(created.id, CONTEXT);
    await expect(svc.execute(created.id, CONTEXT)).rejects.toMatchObject({
      code: "send_failed",
    });

    const row = actions().find((r) => r["id"] === created.id)!;
    expect(row["status"]).toBe("failed");
    expect(String(row["failure_reason"])).toContain("Linki send failed");
  });

  it("a failed action can never execute again (terminal, in place)", async () => {
    const { transport } = fakeTransport({ failWith: new Error("boom") });
    const svc = service({ LINKI_EXECUTION_ENABLED: "true" }, transport);
    const created = await svc.create(makeInput(), CONTEXT);
    await svc.approve(created.id, CONTEXT);
    await expect(svc.execute(created.id, CONTEXT)).rejects.toBeTruthy();

    // Second attempt, even with transport fixed: still rejected.
    const fixed = service({ LINKI_EXECUTION_ENABLED: "true" }, fakeTransport().transport);
    await expect(fixed.execute(created.id, CONTEXT)).rejects.toMatchObject({
      code: "illegal_transition",
    });
  });

  it("re-checks the daily cap at execute time, even after approval", async () => {
    const { transport, sends } = fakeTransport();
    // Two actions created while the cap was 2; one approves for execution.
    const svc = service({ LINKI_EXECUTION_ENABLED: "true", LINKI_DAILY_MSG_CAP: "2" }, transport);
    const created = await svc.create(makeInput(), CONTEXT);
    await svc.create(makeInput({ idempotencyKey: "queued-earlier" }), CONTEXT); // consumes a slot
    await svc.approve(created.id, CONTEXT);

    // The cap is then lowered to 1 mid-day (operator decision). Execute must
    // notice the queued action already holds today's single slot.
    const afterCapChange = service(
      { LINKI_EXECUTION_ENABLED: "true", LINKI_DAILY_MSG_CAP: "1" },
      transport,
    );
    await expect(afterCapChange.execute(created.id, CONTEXT)).rejects.toMatchObject({
      code: "cap_exceeded",
    });
    expect(sends.length).toBe(0); // nothing sent
  });
});

/* ------------------------------------------------------------------ */
/* Verify + retry                                                      */
/* ------------------------------------------------------------------ */

describe("verify", () => {
  it("moves executed → verified (terminal)", async () => {
    const svc = service({ LINKI_EXECUTION_ENABLED: "true" });
    const created = await svc.create(makeInput(), CONTEXT);
    await svc.approve(created.id, CONTEXT);
    await svc.execute(created.id, CONTEXT);
    const verified = await svc.verify(created.id, CONTEXT);
    expect(verified.status).toBe("verified");
    // verified is terminal
    await expect(svc.verify(created.id, CONTEXT)).rejects.toMatchObject({
      code: "illegal_transition",
    });
  });

  it("cannot verify a pending action", async () => {
    const created = await service().create(makeInput(), CONTEXT);
    await expect(service().verify(created.id, CONTEXT)).rejects.toMatchObject({
      code: "illegal_transition",
    });
  });
});

describe("retry", () => {
  it("creates a NEW row referencing the failed original", async () => {
    const { transport } = fakeTransport({ failWith: new Error("boom") });
    const ok = fakeTransport();
    const env = { LINKI_EXECUTION_ENABLED: "true" };
    const svc = service(env, transport);
    const original = await svc.create(makeInput({ idempotencyKey: "orig" }), CONTEXT);
    await svc.approve(original.id, CONTEXT);
    await expect(svc.execute(original.id, CONTEXT)).rejects.toBeTruthy();

    const retrySvc = service(env, ok.transport);
    const retried = await retrySvc.retry(original.id, CONTEXT);
    expect(retried.id).not.toBe(original.id);
    expect(retried.parentActionId).toBe(original.id);
    expect(retried.status).toBe("pending_tai_approval"); // must earn approval again
    expect(retried.idempotencyKey).not.toBe(original.idempotencyKey);
  });

  it("refuses retry when the original is not failed", async () => {
    const svc = service();
    const created = await svc.create(makeInput(), CONTEXT);
    await expect(svc.retry(created.id, CONTEXT)).rejects.toMatchObject({
      code: "illegal_transition",
    });
  });

  it("the failed original stays terminal forever", async () => {
    const { transport } = fakeTransport({ failWith: new Error("boom") });
    const svc = service({ LINKI_EXECUTION_ENABLED: "true" }, transport);
    const original = await svc.create(makeInput(), CONTEXT);
    await svc.approve(original.id, CONTEXT);
    await expect(svc.execute(original.id, CONTEXT)).rejects.toBeTruthy();

    const row = actions().find((r) => r["id"] === original.id)!;
    expect(row["status"]).toBe("failed");
  });
});

/* ------------------------------------------------------------------ */
/* Daily caps                                                          */
/* ------------------------------------------------------------------ */

describe("daily caps", () => {
  it("hard-blocks creating beyond the message cap with a clear error", async () => {
    const svc = service({ LINKI_DAILY_MSG_CAP: "2" });
    await svc.create(makeInput(), CONTEXT);
    await svc.create(makeInput(), CONTEXT);
    await expect(svc.create(makeInput(), CONTEXT)).rejects.toMatchObject({
      code: "cap_exceeded",
      message: expect.stringContaining("message"),
    });
  });

  it("hard-blocks beyond the connection cap (independent of messages)", async () => {
    const svc = service({ LINKI_DAILY_CONN_CAP: "1" });
    await svc.create(makeInput({ actionType: "connection_request" }), CONTEXT);
    await expect(
      svc.create(makeInput({ actionType: "connection_request" }), CONTEXT),
    ).rejects.toMatchObject({ code: "cap_exceeded" });
    // Messages still allowed, the caps are per type.
    await expect(svc.create(makeInput(), CONTEXT)).resolves.toBeTruthy();
  });

  it("failed actions do NOT consume the cap", async () => {
    const { transport } = fakeTransport({ failWith: new Error("boom") });
    const svc = service({ LINKI_DAILY_MSG_CAP: "1", LINKI_EXECUTION_ENABLED: "true" }, transport);
    const first = await svc.create(makeInput(), CONTEXT);
    await svc.approve(first.id, CONTEXT);
    await expect(svc.execute(first.id, CONTEXT)).rejects.toBeTruthy();

    // The failed action must not block the next attempt.
    await expect(svc.create(makeInput(), CONTEXT)).resolves.toMatchObject({
      status: "pending_tai_approval",
    });
  });

  it("counts only same-org same-day actions (scopes to one workspace)", async () => {
    const svc = service({ LINKI_DAILY_MSG_CAP: "1" });
    await svc.create(makeInput(), CONTEXT);
    // Same cap, different org: unaffected (that org owns its own contact).
    db.tables["contacts"] = [
      ...db.tables["contacts"]!,
      {
        ...db.tables["contacts"]![0]!,
        id: "77777777-7777-4777-8777-777777777777",
        organization_id: OTHER_ORG,
      },
    ];
    const other = await service({ LINKI_DAILY_MSG_CAP: "1" }).create(
      makeInput({
        idempotencyKey: "other-org",
        personId: "77777777-7777-4777-8777-777777777777",
        contactId: "77777777-7777-4777-8777-777777777777",
      }),
      { organizationId: OTHER_ORG, userId: OTHER_USER },
    );
    expect(other.organizationId).toBe(OTHER_ORG);
    await expect(svc.create(makeInput(), CONTEXT)).rejects.toMatchObject({
      code: "cap_exceeded",
    });
  });
});

/* ------------------------------------------------------------------ */
/* Audit trail                                                         */
/* ------------------------------------------------------------------ */

describe("audit trail", () => {
  it("appends an event for every transition with actor + before/after + receipt hash", async () => {
    const svc = service({ LINKI_EXECUTION_ENABLED: "true" });
    const created = await svc.create(makeInput(), CONTEXT);
    await svc.approve(created.id, CONTEXT);
    await svc.execute(created.id, CONTEXT);
    await svc.verify(created.id, CONTEXT);

    const names = recorded.map((e) => e.name);
    expect(names).toEqual([
      "linki.status_changed",
      "linki.status_changed",
      "linki.status_changed",
      "linki.status_changed",
      "linki.status_changed",
    ]);

    const pairs = recorded.map((e) => ({
      before: e.payload?.["status_before"],
      after: e.payload?.["status_after"],
    }));
    expect(pairs).toEqual([
      { before: "pending_tai_approval", after: "pending_tai_approval" }, // creation event
      { before: "pending_tai_approval", after: "approved" },
      { before: "approved", after: "executing" },
      { before: "executing", after: "executed" },
      { before: "executed", after: "verified" },
    ]);

    for (const event of recorded) {
      expect(event.provenance.actor.id).toBe(TAI);
      expect(event.payload?.["linki_action_id"]).toBe(created.id);
      expect(event.payload?.["action_type"]).toBe("message");
    }

    // Receipt hash present on the executed event, and correct.
    const executedEvent = recorded[3]!;
    expect(typeof executedEvent.payload?.["receipt_hash"]).toBe("string");
    expect(String(executedEvent.payload?.["receipt_hash"])).toMatch(/^[0-9a-f]{16}$/);
    // Deterministic for the same receipt material.
    const row = actions().find((r) => r["id"] === created.id)!;
    const stored = row["execution_receipt"] as LinkiExecutionReceipt;
    expect(executedEvent.payload?.["receipt_hash"]).toBe(receiptHash(stored));
  });

  it("records the failure reason on a failed execution", async () => {
    const { transport } = fakeTransport({ failWith: new Error("session expired") });
    const svc = service({ LINKI_EXECUTION_ENABLED: "true" }, transport);
    const created = await svc.create(makeInput(), CONTEXT);
    await svc.approve(created.id, CONTEXT);
    await expect(svc.execute(created.id, CONTEXT)).rejects.toBeTruthy();

    const failure = recorded[recorded.length - 1]!;
    expect(failure.payload?.["failure_reason"]).toContain("session expired");
    expect(failure.payload?.["status_after"]).toBe("failed");
  });
});

describe("receiptHash", () => {
  it("hashes deterministically and never exposes receipt contents", () => {
    const receipt: LinkiExecutionReceipt = {
      provider: "linki",
      runId: "run-9",
      sentAt: "2026-08-27T10:00:00Z",
      response: null,
    };
    const hash = receiptHash(receipt);
    expect(hash).toBe(receiptHash(receipt));
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(receiptHash(null)).toBeNull();
  });
});
