/**
 * The shared delivery ledger, exercised through the Gmail send path.
 *
 * Everything outside this module is a double: the database, the mailbox, the
 * provider. Nothing here reaches a real workspace and no message is sent to
 * anybody — these are simulations, and they are labelled as such wherever
 * their result is reported.
 *
 * What they pin is the part the Gmail path was missing: a claim is opened
 * before the provider is called and it is *closed* afterwards with what
 * actually happened, so the delivery record is a receipt rather than a row
 * stuck at "attempting" forever.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const settleDelivery = vi.fn();
const claimDelivery = vi.fn();
const requireSendApproval = vi.fn();

vi.mock("@/lib/comms-send-authority.server", () => ({
  requireSendApproval,
  claimDelivery,
  settleDelivery,
  SendRefused: class extends Error {},
}));

const CONNECTION = {
  id: "int-1",
  account_email: "tai@trusttai.example",
  scopes: "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly",
  connected: true,
};

const draftRow = {
  id: "draft-1",
  relationship_id: "rel-1",
  subject: "Dates",
  body: "Wednesday works.",
  review_state: "draft",
  rationale: null,
  updated_at: "2026-01-01T00:00:00.000Z",
};

function table(name: string) {
  const rowFor = () => {
    if (name === "comms_drafts") return draftRow;
    if (name === "comms_relationships") {
      return { id: "rel-1", email: "megan@northlight.example", metadata: null };
    }
    return null;
  };
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "or", "order", "limit", "neq", "update", "insert", "upsert"]) {
    query[method] = vi.fn(() => query);
  }
  query["maybeSingle"] = vi.fn(async () => ({ data: rowFor(), error: null }));
  query["single"] = vi.fn(async () => ({ data: { id: "thread-1" }, error: null }));
  // An update reports one affected row, so the draft claim always succeeds.
  query["then"] = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null, count: 1 }).then(resolve);
  return query;
}

const fakeClient = {
  from: vi.fn((name: string) => table(name)),
  rpc: vi.fn(async () => ({ data: "sealed-secret", error: null })),
  storage: { from: () => ({ download: vi.fn(), remove: vi.fn() }) },
};

vi.mock("@/lib/comms-gmail.server", () => ({
  GMAIL_API: "https://gmail.example",
  supabaseFor: () => fakeClient,
  requireMember: vi.fn(async () => undefined),
  loadGmailConnections: vi.fn(async () => [CONNECTION]),
  refreshAccessToken: vi.fn(async () => "access-token"),
  gmailGet: vi.fn(async () => ({ messages: [] })),
}));

vi.mock("@/lib/comms-crypto.server", () => ({ openSecret: vi.fn(async () => "refresh-token") }));

const { sendDraftViaGmail } = await import("@/lib/comms-gmail-send.server");

const fetchSpy = vi.fn();

function send() {
  return sendDraftViaGmail({
    token: "token",
    organizationId: "org-1",
    draftId: "draft-1",
    threadTarget: { mode: "new" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchSpy);
  requireSendApproval.mockResolvedValue({
    approvalId: "approval-1",
    fingerprint: "fp-1",
    caller: { userId: "user-1" },
  });
  claimDelivery.mockResolvedValue({ fresh: true, id: "delivery-1", state: "attempting" });
  settleDelivery.mockResolvedValue({ recorded: true, note: "Sent." });
});

describe("a simulated send that the provider accepts", () => {
  it("writes the provider's own message id onto the open claim, once", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ id: "gmail-msg-1", threadId: "gmail-thread-1" }), {
        status: 200,
      }),
    );

    const outcome = await send();

    expect(outcome.state).toBe("sent");
    expect(settleDelivery).toHaveBeenCalledTimes(1);
    expect(settleDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: "delivery-1",
        state: "sent",
        providerMessageId: "gmail-msg-1",
      }),
    );
  });

  it("says so plainly when the receipt itself cannot be stored", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ id: "gmail-msg-1", threadId: "gmail-thread-1" }), {
        status: 200,
      }),
    );
    settleDelivery.mockResolvedValue({
      recorded: false,
      note: "The message went out, but the outcome could not be recorded.",
    });

    const outcome = await send();

    expect(outcome.state).toBe("sent");
    expect(outcome.note).toMatch(/could not be recorded/i);
  });
});

describe("a simulated send the provider refuses", () => {
  it("closes the claim as failed rather than leaving it open forever", async () => {
    fetchSpy.mockResolvedValue(new Response("nope", { status: 403 }));

    const outcome = await send();

    expect(outcome.state).toBe("failed");
    expect(settleDelivery).toHaveBeenCalledWith(expect.objectContaining({ state: "failed" }));
  });
});

describe("a simulated send whose answer never arrives", () => {
  it("is unknown, not failed, and is never offered as a retry", async () => {
    fetchSpy.mockRejectedValue(new Error("socket hang up"));

    const outcome = await send();

    expect(outcome.state).toBe("unknown");
    expect(settleDelivery).toHaveBeenCalledWith(expect.objectContaining({ state: "unknown" }));
  });

  it("is unknown when the provider answers without naming a message", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    const outcome = await send();

    expect(outcome.state).toBe("unknown");
    expect(settleDelivery).toHaveBeenCalledWith(expect.objectContaining({ state: "unknown" }));
  });
});

describe("a claim that is not ours", () => {
  it("never reaches the provider and never settles somebody else's attempt", async () => {
    claimDelivery.mockResolvedValue({ fresh: false, id: "delivery-1", state: "attempting" });

    const outcome = await send();

    expect(outcome.state).toBe("sending");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(settleDelivery).not.toHaveBeenCalled();
  });
});
