/**
 * The graduated auto-send orchestrator, exercised end to end against a database
 * double and a provider double.
 *
 * What these prove is the thing the gate exists for:
 *   - the provider is NEVER called on any queue path;
 *   - a send only happens when the graduation gate, the confident pass and the
 *     never-replied-before failsafe all hold;
 *   - a first-EVER contact always queues, even when graduated;
 *   - when it does send, it writes a system approval and settles the system
 *     delivery ledger — it never touches voice_gate_feedback.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "org-1";
const DRAFT = "draft-1";
const REL = "rel-1";

interface World {
  authority: { id: string; autonomy_state: string } | null;
  anyPriorCount: number;
  inboundCount: number;
  approvalInsertError: { code?: string; message?: string } | null;
  deliveryInsertError: { code?: string; message?: string } | null;
  provider: { state: "sent" | "failed" | "unknown"; providerMessageId: string | null };
  credsNull: boolean;
  // Captured writes.
  approvals: Record<string, unknown>[];
  deliveries: Record<string, unknown>[];
  deliverySettles: Record<string, unknown>[];
  draftUpdates: Record<string, unknown>[];
  feedbackInserts: Record<string, unknown>[];
  postToResendCalls: number;
}

let world: World;

function fresh(): World {
  return {
    authority: { id: "auth-1", autonomy_state: "auto_send" },
    anyPriorCount: 1,
    inboundCount: 0,
    approvalInsertError: null,
    deliveryInsertError: null,
    provider: { state: "sent", providerMessageId: "resend-1" },
    credsNull: false,
    approvals: [],
    deliveries: [],
    deliverySettles: [],
    draftUpdates: [],
    feedbackInserts: [],
    postToResendCalls: 0,
  };
}

/** A query double answering per table, ignoring filter order and count-only reads. */
function table(name: string) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const method of ["select", "eq", "in", "order", "limit", "gte"]) {
    chain[method] = self;
  }

  // Count-only reads: comms_messages head:true count.
  chain["select"] = (_cols?: unknown, opts?: { count?: string; head?: boolean }) => {
    if (name === "comms_messages" && opts?.head) {
      // The second .eq("direction","inbound") narrows to inbound; detect via a flag.
      const messageChain: Record<string, unknown> = {};
      let inboundOnly = false;
      messageChain["eq"] = (col: string) => {
        if (col === "direction") inboundOnly = true;
        return messageChain;
      };
      messageChain["then"] = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({
          count: inboundOnly ? world.inboundCount : world.anyPriorCount,
          error: null,
        }).then(resolve);
      return messageChain;
    }
    return chain;
  };

  chain["insert"] = (row: Record<string, unknown>) => {
    if (name === "comms_autosend_approvals") {
      if (world.approvalInsertError) {
        return {
          select: () => ({ maybeSingle: async () => ({ data: null, error: world.approvalInsertError }) }),
        };
      }
      const id = `approval-${world.approvals.length + 1}`;
      world.approvals.push({ id, ...row });
      return {
        select: () => ({
          maybeSingle: async () => ({
            data: { id, payload_fingerprint: row["payload_fingerprint"] },
            error: null,
          }),
        }),
      };
    }
    if (name === "comms_autosend_deliveries") {
      if (world.deliveryInsertError) {
        return {
          select: () => ({ maybeSingle: async () => ({ data: null, error: world.deliveryInsertError }) }),
        };
      }
      const id = `delivery-${world.deliveries.length + 1}`;
      world.deliveries.push({ id, ...row });
      return {
        select: () => ({
          maybeSingle: async () => ({ data: { id, status: "attempting" }, error: null }),
        }),
      };
    }
    if (name === "voice_gate_feedback") {
      world.feedbackInserts.push(row);
      return { select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) };
    }
    return { select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) };
  };

  chain["update"] = (row: Record<string, unknown>) => {
    if (name === "comms_autosend_deliveries") world.deliverySettles.push(row);
    if (name === "comms_drafts") world.draftUpdates.push(row);
    const updateChain: Record<string, unknown> = {};
    for (const m of ["eq", "in", "select"]) updateChain[m] = () => updateChain;
    updateChain["then"] = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: [{ id: "delivery-1", status: row["status"] }], error: null }).then(resolve);
    return updateChain;
  };

  chain["maybeSingle"] = async () => {
    switch (name) {
      case "voice_gate_authority":
        return { data: world.authority, error: null };
      case "comms_drafts":
        return {
          data: { id: DRAFT, subject: "A thought", body: "Hi there\n\nTrust,\nTai", relationship_id: REL, rationale: {} },
          error: null,
        };
      case "comms_relationships":
        return { data: { id: REL, email: "prospect@example.com" }, error: null };
      default:
        return { data: null, error: null };
    }
  };
  return chain;
}

const service = { from: (name: string) => table(name) } as unknown as import("@supabase/supabase-js").SupabaseClient;

const { postToResend, resendCredentials } = vi.hoisted(() => ({
  postToResend: vi.fn(),
  resendCredentials: vi.fn(),
}));

vi.mock("@/lib/comms-resend-send.server", () => ({ postToResend, resendCredentials }));

beforeEach(() => {
  world = fresh();
  resendCredentials.mockImplementation(() =>
    world.credsNull ? null : { apiKey: "k", from: "tai@trusttai.example" },
  );
  postToResend.mockImplementation(async () => {
    world.postToResendCalls += 1;
    return { state: world.provider.state, providerMessageId: world.provider.providerMessageId, detail: null };
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

async function run(overrides: Partial<Parameters<typeof import("./comms-autosend.server").considerAutoSend>[1]> = {}) {
  const { considerAutoSend } = await import("./comms-autosend.server");
  return considerAutoSend(service, {
    organizationId: ORG,
    draftId: DRAFT,
    relationshipId: REL,
    gate: { verdict: "pass", confidence: null, grade: null, hardOverride: false, reasons: [] },
    ...overrides,
  });
}

describe("considerAutoSend orchestrator", () => {
  it("(ii) graduated + confident pass + prior contact + no inbound reply => auto-sends via the shared provider path", async () => {
    const outcome = await run();
    expect(outcome.attempted).toBe(true);
    expect(outcome.state).toBe("sent");
    expect(world.postToResendCalls).toBe(1);
    // A system approval was written, and the system delivery ledger settled.
    expect(world.approvals).toHaveLength(1);
    expect(world.deliveries).toHaveLength(1);
    expect(world.deliverySettles.at(-1)?.["status"]).toBe("sent");
    // The draft is marked sent, and voice_gate_feedback is NEVER touched.
    expect(world.draftUpdates.some((u) => u["review_state"] === "sent")).toBe(true);
    expect(world.feedbackInserts).toHaveLength(0);
  });

  it("(i) first-EVER contact ALWAYS queues, even when graduated — provider never called", async () => {
    world.anyPriorCount = 0;
    const outcome = await run();
    expect(outcome.attempted).toBe(false);
    expect(outcome.hold).toBe("first_ever_contact");
    expect(world.postToResendCalls).toBe(0);
    expect(world.approvals).toHaveLength(0);
  });

  it("(iii) non-graduated (bounce_only) => queues — provider never called", async () => {
    world.authority = { id: "auth-1", autonomy_state: "bounce_only" };
    const outcome = await run();
    expect(outcome.attempted).toBe(false);
    expect(outcome.hold).toBe("not_graduated");
    expect(world.postToResendCalls).toBe(0);
  });

  it("(iii) absent authority row => queues — provider never called", async () => {
    world.authority = null;
    const outcome = await run();
    expect(outcome.attempted).toBe(false);
    expect(outcome.hold).toBe("not_graduated");
    expect(world.postToResendCalls).toBe(0);
  });

  it("(iv) a bounce verdict => queues — provider never called", async () => {
    const outcome = await run({
      gate: { verdict: "bounce", confidence: null, grade: null, hardOverride: false, reasons: [] },
    });
    expect(outcome.attempted).toBe(false);
    expect(outcome.hold).toBe("gate_not_pass");
    expect(world.postToResendCalls).toBe(0);
  });

  it("(v) a relationship with a prior inbound reply => queues — provider never called", async () => {
    world.inboundCount = 1;
    const outcome = await run();
    expect(outcome.attempted).toBe(false);
    expect(outcome.hold).toBe("has_inbound_reply");
    expect(world.postToResendCalls).toBe(0);
  });

  it("a lost provider answer settles as unknown and does NOT mark the draft sent", async () => {
    world.provider = { state: "unknown", providerMessageId: null };
    const outcome = await run();
    expect(outcome.attempted).toBe(true);
    expect(outcome.state).toBe("unknown");
    expect(world.postToResendCalls).toBe(1);
    expect(world.draftUpdates.some((u) => u["review_state"] === "sent")).toBe(false);
    expect(world.deliverySettles.at(-1)?.["status"]).toBe("unknown");
  });

  it("holds (never sends) when the server has no provider credentials", async () => {
    world.credsNull = true;
    const outcome = await run();
    expect(outcome.attempted).toBe(false);
    expect(outcome.hold).toBe("server_not_configured");
    expect(world.postToResendCalls).toBe(0);
    expect(world.approvals).toHaveLength(0);
  });
});
