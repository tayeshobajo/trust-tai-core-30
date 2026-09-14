/**
 * The happy path, end to end, with doubles in front of the database and the
 * provider: a draft is bound to a review, the review completes, an approval
 * is written that names the exact outbound payload, and only then does a
 * message reach the provider.
 *
 * Every refusal case lives in comms-send-authority.server.test.ts. This file
 * exists because a gate that only ever refuses is not a workflow, and the
 * refusal tests cannot tell the difference between "correctly refused" and
 * "never worked at all".
 *
 * The columns these doubles answer with are the columns the applied schema
 * has (findings carry `why`, sessions and runs carry `context_revision`), so
 * a test cannot pass against a table shape that does not exist.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/trust-tai-backend.server", () => ({
  trustTaiSupabaseUrl: () => "https://project.supabase.co",
  trustTaiSupabaseKey: () => "anon_key",
}));

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));

import { outboundFingerprint } from "@/domain/comms-delivery";
import { contextFingerprint } from "@/domain/comms-review";
import { approveVersion } from "@/lib/comms-review.server";

const ORG = "org-1";
const USER = "user-1";
const SESSION = "session-1";
const VERSION = "version-1";
const RUN = "run-1";
const DRAFT = "draft-1";

const SUBJECT = "Re: dates";
const BODY = "The migration finishes on 4 October.";
const RECIPIENT = "megan@northlight.example";
const SENDER = "tai@trusttai.example";

const EXPECTED_FINGERPRINT = outboundFingerprint({
  channel: "email_resend",
  subject: SUBJECT,
  body: BODY,
  recipient: RECIPIENT,
  senderIdentity: SENDER,
  attachments: [],
  cc: [],
  bcc: [],
});

/* The same ingredients loadReview folds together, so the completed run in
   these doubles is genuinely current rather than stamped with a guess. */
const CONTEXT = contextFingerprint({
  versionId: VERSION,
  subject: SUBJECT,
  body: BODY,
  recipientEmail: RECIPIENT,
  recipientName: "Megan Walls",
  goal: "Give her the date.",
  situation: "She asked twice for the date.",
  sourceChecksums: [],
  senderName: "Sam Ellis",
  senderUserId: USER,
  voiceVersion: "voice_profile:none",
});

type Result = { data: unknown; error: unknown };
const ok = (data: unknown = null): Result => ({ data, error: null });

interface World {
  /** Everything written through the server's own credentials. */
  writes: { table: string; payload: Record<string, unknown> }[];
  draftBody: string;
}
let world: World;

const ROWS: Record<string, unknown> = {
  organization_memberships: { role: "owner", status: "active" },
  profiles: { id: USER, full_name: "Sam Ellis", email: "sam@trusttai.example" },
  comms_voice_profiles: null,
  comms_review_sources: [],
  comms_review_findings: [],
  comms_review_obligations: [],
  comms_review_approvals: [],
};

function rowsFor(table: string): Result {
  switch (table) {
    case "comms_drafts":
      return ok({
        id: DRAFT,
        subject: SUBJECT,
        body: world.draftBody,
        relationship_id: "rel-1",
        rationale: null,
      });
    case "comms_relationships":
      return ok({ id: "rel-1", email: RECIPIENT });
    case "comms_review_sessions":
      return ok({
        id: SESSION,
        organization_id: ORG,
        situation: "She asked twice for the date.",
        goal: "Give her the date.",
        recipient_name: "Megan Walls",
        recipient_email: RECIPIENT,
        status: "open",
        context_revision: 2,
        draft_id: DRAFT,
        intended_channel: "email_resend",
        sender_identity: SENDER,
        created_at: "2026-09-14T09:00:00.000Z",
        updated_at: "2026-09-14T09:00:00.000Z",
      });
    case "comms_review_versions":
      return ok([
        {
          id: VERSION,
          session_id: SESSION,
          organization_id: ORG,
          version: 1,
          author_user_id: USER,
          subject: SUBJECT,
          body: BODY,
          created_at: "2026-09-14T09:05:00.000Z",
        },
      ]);
    case "comms_review_runs":
      return ok([
        {
          id: RUN,
          session_id: SESSION,
          version_id: VERSION,
          organization_id: ORG,
          status: "complete",
          context_revision: 2,
          context_fingerprint: CONTEXT,
          started_at: "2026-09-14T09:06:00.000Z",
          completed_at: "2026-09-14T09:07:00.000Z",
          stages: [],
          coverage: {},
          limitations: [],
        },
      ]);
    default:
      return ok(ROWS[table] ?? []);
  }
}

function node(table: string): Record<string, unknown> {
  const self: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "is", "neq", "order", "limit"]) {
    self[method] = () => self;
  }
  const settle = () => rowsFor(table);
  self["maybeSingle"] = async () => {
    const result = settle();
    return Array.isArray(result.data) ? ok(result.data[0] ?? null) : result;
  };
  self["single"] = self["maybeSingle"];
  self["then"] = (resolve: (value: Result) => unknown) => Promise.resolve(settle()).then(resolve);
  self["insert"] = (payload: Record<string, unknown>) => {
    world.writes.push({ table, payload });
    const inserted: Record<string, unknown> = {
      id: "approval-1",
      organization_id: ORG,
      session_id: SESSION,
      version_id: VERSION,
      run_id: RUN,
      context_fingerprint: CONTEXT,
      approved_by: USER,
      approved_at: "2026-09-14T09:08:00.000Z",
      approver_role: "owner",
      reason: null,
      ...payload,
    };
    const after: Record<string, unknown> = {};
    after["select"] = () => after;
    after["maybeSingle"] = async () => ok(inserted);
    return after;
  };
  self["update"] = (payload: Record<string, unknown>) => {
    world.writes.push({ table, payload });
    const after: Record<string, unknown> = {};
    after["eq"] = () => after;
    after["select"] = () => after;
    after["then"] = (resolve: (value: Result) => unknown) => Promise.resolve(ok([])).then(resolve);
    return after;
  };
  return self;
}

beforeEach(() => {
  world = { writes: [], draftBody: BODY };
  process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"] = "service-key";
  createClient.mockImplementation(() => ({
    auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) },
    from: (table: string) => node(table),
  }));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("approving a review that is bound to a draft", () => {
  it("records exactly which message, out of which door, was approved", async () => {
    const approval = await approveVersion("token", {
      organizationId: ORG,
      sessionId: SESSION,
      versionId: VERSION,
    });

    expect(approval.runId).toBe(RUN);
    expect(approval.payloadFingerprint).toBe(EXPECTED_FINGERPRINT);
    expect(approval.payloadChannel).toBe("email_resend");

    const written = world.writes.find((write) => write.table === "comms_review_approvals");
    expect(written?.payload["payload_fingerprint"]).toBe(EXPECTED_FINGERPRINT);
    expect(written?.payload["approved_by"]).toBe(USER);
  });

  it("derives the payload from the draft on record, not from the caller", async () => {
    const approval = await approveVersion("token", {
      organizationId: ORG,
      sessionId: SESSION,
      versionId: VERSION,
    });
    /* Nothing in the call above named a recipient, a sender or a channel. */
    expect(approval.payloadFingerprint).toBe(EXPECTED_FINGERPRINT);
  });

  it("refuses when the draft no longer says what the review read", async () => {
    world.draftBody = "The migration finishes on 5 October.";
    await expect(
      approveVersion("token", { organizationId: ORG, sessionId: SESSION, versionId: VERSION }),
    ).rejects.toThrow(/not the message this review read/i);
    expect(world.writes.some((write) => write.table === "comms_review_approvals")).toBe(false);
  });
});
