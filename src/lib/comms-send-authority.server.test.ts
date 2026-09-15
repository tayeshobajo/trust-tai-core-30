/**
 * Boundary tests for the one send gate, exercised through a real dispatch
 * entrypoint (the email path behind the queue and Scout outreach).
 *
 * The database and the provider are both doubles. Nothing here reaches a real
 * workspace and nothing here sends a message to anybody. What these tests can
 * prove is the thing the rule exists for: in every refusal case the provider
 * is never called, and in every ambiguous case we do not claim a send we
 * cannot prove.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { outboundFingerprint } from "@/domain/comms-delivery";

const ORG = "org-1";
const DRAFT = "draft-1";
const USER = "user-1";

const DRAFT_ROW = {
  id: DRAFT,
  subject: "Re: dates",
  body: "Wednesday works.",
  relationship_id: "rel-1",
  rationale: null,
};
const REL_ROW = { id: "rel-1", email: "megan@northlight.example" };

const FINGERPRINT = outboundFingerprint({
  channel: "email_resend",
  subject: DRAFT_ROW.subject,
  body: DRAFT_ROW.body,
  recipient: REL_ROW.email,
  senderIdentity: "tai@trusttai.example",
  attachments: [],
  cc: [],
  bcc: [],
});

interface World {
  membership: { role: string; status: string } | null;
  session: Record<string, unknown> | null;
  /** A second open review of the same draft: nobody can say which one counts. */
  extraSession: Record<string, unknown> | null;
  /** The context as it stands now, recomputed rather than taken from the run. */
  current: { fingerprint: string; revision: number; currentVersionId: string | null };
  currentThrows: boolean;
  approval: Record<string, unknown> | null;
  run: Record<string, unknown> | null;
  findings: Record<string, unknown>[];
  claimFails: "unique" | "write" | null;
  /** The row already holding the key is some other attempt, not this one. */
  claimCollision: boolean;
  /** The settle matched nothing: the attempt was already settled. */
  settleNoRows: boolean;
  /** The caller's token names nobody. */
  noUser: boolean;
  inserted: Record<string, unknown>[];
  settled: Record<string, unknown>[];
  settleFails: boolean;
}

let world: World;

function freshWorld(): World {
  return {
    membership: { role: "owner", status: "active" },
    session: {
      id: "session-1",
      context_revision: 3,
      status: "open",
      draft_id: DRAFT,
      intended_channel: "email_resend",
      sender_identity: "tai@trusttai.example",
    },
    extraSession: null,
    current: { fingerprint: "ctx-1", revision: 3, currentVersionId: "version-1" },
    currentThrows: false,
    approval: {
      id: "approval-1",
      session_id: "session-1",
      run_id: "run-1",
      version_id: "version-1",
      payload_channel: "email_resend",
      payload_fingerprint: FINGERPRINT,
      context_fingerprint: "ctx-1",
      context_revision: 3,
    },
    run: {
      id: "run-1",
      session_id: "session-1",
      version_id: "version-1",
      status: "complete",
      context_revision: 3,
      context_fingerprint: "ctx-1",
    },
    findings: [],
    claimFails: null,
    claimCollision: false,
    settleNoRows: false,
    noUser: false,
    inserted: [],
    settled: [],
    settleFails: false,
  };
}

/** A query double that answers per table, ignoring filter order. */
function table(name: string) {
  const result = (): { data: unknown; error: unknown } => {
    switch (name) {
      case "organization_memberships":
        return { data: world.membership, error: null };
      case "comms_drafts":
        return { data: DRAFT_ROW, error: null };
      case "comms_relationships":
        return { data: REL_ROW, error: null };
      case "comms_review_sessions":
        return {
          data: [world.session, world.extraSession].filter(Boolean),
          error: null,
        };
      case "comms_review_approvals":
        return { data: world.approval ? [world.approval] : [], error: null };
      case "comms_review_runs":
        return { data: world.run, error: null };
      case "comms_review_findings":
        return { data: world.findings, error: null };
      default:
        return { data: null, error: null };
    }
  };

  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const method of ["select", "eq", "neq", "order", "limit", "update"]) {
    chain[method] = self;
  }
  chain["insert"] = (row: Record<string, unknown>) => {
    if (name === "comms_review_deliveries") {
      if (world.claimFails === "write") {
        return {
          select: () => ({
            maybeSingle: async () => ({
              data: null,
              error: { code: "XX000", message: "disk full" },
            }),
          }),
        };
      }
      if (world.claimFails === "unique") {
        return {
          select: () => ({
            maybeSingle: async () => ({
              data: null,
              error: { code: "23505", message: "duplicate key" },
            }),
          }),
        };
      }
      world.inserted.push(row);
      return {
        select: () => ({
          maybeSingle: async () => ({
            data: { id: "delivery-1", status: "attempting" },
            error: null,
          }),
        }),
      };
    }
    return { select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) };
  };
  chain["update"] = (row: Record<string, unknown>) => {
    if (name === "comms_review_deliveries") world.settled.push(row);
    const done = async () => ({
      data: world.settleFails ? null : world.settleNoRows ? [] : [{ id: "delivery-1", status: row["status"] }],
      error: world.settleFails ? { code: "XX000", message: "write failed" } : null,
    });
    const updateChain: Record<string, unknown> = {};
    updateChain["eq"] = () => updateChain;
    updateChain["neq"] = () => updateChain;
    updateChain["select"] = () => updateChain;
    updateChain["then"] = (resolve: (value: unknown) => unknown) => done().then(resolve);
    return updateChain;
  };
  chain["maybeSingle"] = async () => {
    const r = result();
    return Array.isArray(r.data) ? { data: r.data[0] ?? null, error: r.error } : r;
  };
  chain["then"] = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve);
  // Deliveries lookups after a unique violation.
  if (name === "comms_review_deliveries") {
    chain["maybeSingle"] = async () => ({
      data: {
        id: "delivery-1",
        status: "attempting",
        draft_id: world.claimCollision ? "draft-somebody-else" : DRAFT,
        approval_id: "approval-1",
        payload_fingerprint: FINGERPRINT,
        channel: "email_resend",
      },
      error: null,
    });
  }
  return chain;
}

const { createClient } = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient }));
/* The context as it stands now is recomputed through the shared review
   loader. Here that loader is a double, so a test can move the voice rules or
   the situation underneath an approval. */
vi.mock("@/lib/comms-review.server", () => ({
  currentReviewContext: async () => {
    if (world.currentThrows) throw new Error("unreadable");
    return world.current;
  },
}));
vi.mock("@/lib/trust-tai-backend.server", () => ({
  trustTaiSupabaseUrl: () => "https://example.supabase.co",
  trustTaiSupabaseKey: () => "anon-key",
}));

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  world = freshWorld();
  createClient.mockImplementation(() => ({
    auth: {
      getUser: async () =>
        world.noUser
          ? { data: { user: null }, error: { message: "no session" } }
          : { data: { user: { id: USER } }, error: null },
    },
    from: (name: string) => table(name),
  }));
  process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"] = "service-key";
  process.env["RESEND_API_KEY"] = "resend-key";
  process.env["RESEND_FROM_EMAIL"] = "tai@trusttai.example";
  fetchSpy = vi.fn(async () => new Response(JSON.stringify({ id: "provider-1" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env["RESEND_API_KEY"];
  delete process.env["RESEND_FROM_EMAIL"];
});

async function send() {
  const { sendDraftViaResend } = await import("@/lib/comms-resend-send.server");
  return sendDraftViaResend({ token: "token", organizationId: ORG, draftId: DRAFT });
}

async function refusal(): Promise<{ code: string; message: string }> {
  try {
    await send();
  } catch (error) {
    const refused = error as { code?: string; message: string };
    return { code: refused.code ?? "", message: refused.message };
  }
  throw new Error("Expected the send to be refused.");
}

describe("a send that is genuinely approved", () => {
  it("calls the provider once and records the receipt", async () => {
    const result = await send();
    expect(result.state).toBe("sent");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.providerMessageId).toBe("provider-1");
  });

  it("records the attempt before asking the provider anything", async () => {
    await send();
    expect(world.inserted).toHaveLength(1);
    expect(world.inserted[0]?.["status"]).toBe("attempting");
    expect(world.inserted[0]?.["approval_id"]).toBe("approval-1");
  });
});

describe("refusals reach no provider at all", () => {
  it.each([
    [
      "nobody reviewed it",
      () => {
        world.session = null;
        world.approval = null;
      },
    ],
    [
      "it was never approved",
      () => {
        world.approval = null;
      },
    ],
    [
      "the review never finished",
      () => {
        world.run = { ...world.run, status: "failed" };
      },
    ],
    [
      "the words were edited after approval",
      () => {
        world.approval = { ...world.approval, payload_fingerprint: "other" };
      },
    ],
    [
      "the voice rules or the material moved after the review",
      () => {
        world.current = { ...world.current, fingerprint: "ctx-2" };
      },
    ],
    [
      "the conversation was revised",
      () => {
        world.current = { ...world.current, revision: 9 };
      },
    ],
    [
      "the draft has been edited into a newer version since approval",
      () => {
        world.current = { ...world.current, currentVersionId: "version-2" };
      },
    ],
    [
      "two open reviews both claim this draft",
      () => {
        world.extraSession = { ...world.session, id: "session-2" };
      },
    ],
    [
      "the approval belongs to another review",
      () => {
        world.approval = { ...world.approval, session_id: "session-9" };
      },
    ],
    [
      "the run behind the approval read a different version",
      () => {
        world.run = { ...world.run, version_id: "version-9" };
      },
    ],
    [
      "the review still holds a must-fix",
      () => {
        world.findings = [{ severity: "must_fix", why: "The price is wrong." }];
      },
    ],
    [
      "the person may only view",
      () => {
        world.membership = { role: "member", status: "active" };
      },
    ],
    [
      "the membership is not active",
      () => {
        world.membership = { role: "owner", status: "invited" };
      },
    ],
    [
      "they belong to no such workspace",
      () => {
        world.membership = null;
      },
    ],
    [
      "the membership was suspended",
      () => {
        world.membership = { role: "admin", status: "suspended" };
      },
    ],
    [
      "the membership is only an invitation nobody accepted",
      () => {
        world.membership = { role: "admin", status: "pending" };
      },
    ],
    [
      "the token names nobody",
      () => {
        world.noUser = true;
      },
    ],
    [
      "the attempt could not be written down at all",
      () => {
        world.claimFails = "write";
      },
    ],
    [
      "the key is already held by an attempt on a different draft",
      () => {
        world.claimFails = "unique";
        world.claimCollision = true;
      },
    ],
  ])("refuses when %s", async (_label, arrange) => {
    arrange();
    const refused = await refusal();
    expect(refused.message).toMatch(/nothing was sent/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses honestly when the server has no credentials of its own", async () => {
    delete process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"];
    delete process.env["SUPABASE_SERVICE_ROLE_KEY"];
    const refused = await refusal();
    expect(refused.code).toBe("server_not_configured");
    expect(fetchSpy).not.toHaveBeenCalled();
    process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"] = "service-key";
  });
});

describe("the same message twice", () => {
  it("does not send again when this exact attempt is already on record", async () => {
    world.claimFails = "unique";
    const result = await send();
    expect(result.state).toBe("duplicate");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("two people pressing send at the same moment", () => {
  it("asks the provider once, and the loser is told it is already in progress", async () => {
    /* The database decides this, not the application: the second insert of
       the same key violates the unique constraint and never reaches the
       provider. */
    const first = send();
    world.claimFails = "unique";
    const second = await send();
    const won = await first;

    expect(won.state).toBe("sent");
    expect(second.state).toBe("duplicate");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("a receipt that is already written", () => {
  it("is not rewritten, and says the attempt needs a person", async () => {
    world.settleNoRows = true;
    const result = await send();
    expect(result.note).toMatch(/could not be recorded|reconcil/i);
    expect(result.note).not.toMatch(/^Sent\.$/);
  });
});

describe("what the provider did", () => {
  it("calls a refusal a refusal", async () => {
    fetchSpy.mockResolvedValue(new Response("no", { status: 422 }));
    const result = await send();
    expect(result.state).toBe("failed");
  });

  it("calls a lost answer unknown, never sent and never retried", async () => {
    fetchSpy.mockRejectedValue(new Error("socket hang up"));
    const result = await send();
    expect(result.state).toBe("unknown");
    expect(result.note).toMatch(/cannot be confirmed|could not be recorded/i);
  });

  it("stays unknown when the receipt itself cannot be stored", async () => {
    world.settleFails = true;
    const result = await send();
    expect(result.note).toMatch(/could not be recorded|check/i);
  });
});
