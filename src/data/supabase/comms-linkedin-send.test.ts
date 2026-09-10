/**
 * Integration tests for the manual LinkedIn send record.
 *
 * These run the real server logic, the real claim machinery, and the real
 * rationale IO against the in-memory Supabase stand-in: what a mark-as-sent
 * writes, what a second click does (replays, never doubles), and how the
 * relationship's stage moves (forward only).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { readDraftSend } from "@/domain/comms-send";
import {
  EMAIL_CONFIRMED_KEY,
  LINKEDIN_CONFIRMED_KEY,
  LINKEDIN_URL_KEY,
  manualLinkedinMessageId,
} from "@/domain/comms-routes";

import { recordLinkedinSend } from "@/lib/comms-linkedin-send.server";
import { sendDraftViaGmail } from "@/lib/comms-gmail-send.server";
import { createFakeSupabase, type FakeRow } from "./fake-supabase";

// The Gmail gate tests below run the real sendDraftViaGmail against the
// in-memory stand-in: only `supabaseFor` is swapped so the member's client
// is the fake; everything else in the module stays real.
vi.mock("@/lib/comms-gmail.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/comms-gmail.server")>();
  return { ...actual, supabaseFor: () => gmailClient };
});

const db = createFakeSupabase();
const client = db as unknown as SupabaseClient;

/** The fake, with just enough auth for `requireMember` to pass. */
const gmailClient = {
  from: (table: string) => db.from(table),
  auth: {
    getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
  },
} as unknown as SupabaseClient;

const ORG = "org-1";
const USER = "user-1";

function seedRelationship(overrides: FakeRow = {}): FakeRow {
  const row: FakeRow = {
    id: "rel-1",
    organization_id: ORG,
    full_name: "Ada Rowe",
    stage: "ready_to_reach",
    email: null,
    last_touch_at: null,
    metadata: {
      [LINKEDIN_URL_KEY]: "https://www.linkedin.com/in/ada-rowe",
      [LINKEDIN_CONFIRMED_KEY]: true,
      scout_handoff: { prospect_id: "prospect-1" },
    },
    ...overrides,
  };
  db.tables["comms_relationships"] = [row];
  return row;
}

function seedDraft(overrides: FakeRow = {}): FakeRow {
  const row: FakeRow = {
    id: "draft-1",
    organization_id: ORG,
    relationship_id: "rel-1",
    subject: null,
    body: "Saw the wholesale expansion announcement. Worth a short conversation?",
    review_state: "draft",
    rationale: {},
    updated_at: new Date().toISOString(),
    ...overrides,
  };
  db.tables["comms_drafts"] = [row];
  return row;
}

beforeEach(() => {
  for (const key of Object.keys(db.tables)) db.tables[key] = [];
});

describe("manual LinkedIn send record", () => {
  it("records one message row, settles the draft as sent, and advances the stage", async () => {
    seedRelationship();
    seedDraft();

    const outcome = await recordLinkedinSend(client, {
      organizationId: ORG,
      userId: USER,
      draftId: "draft-1",
    });

    expect(outcome.state).toBe("sent");
    expect(outcome.replayed).toBeUndefined();
    expect(outcome.providerMessageId).toBe(manualLinkedinMessageId("draft-1"));

    // Exactly one evidence row, with the manual provider and deterministic id.
    const messages = db.tables["comms_messages"]!;
    expect(messages).toHaveLength(1);
    const message = messages[0]!;
    expect(message["provider"]).toBe("manual_linkedin");
    expect(message["provider_message_id"]).toBe(manualLinkedinMessageId("draft-1"));
    expect(message["direction"]).toBe("outbound");
    expect(message["to_emails"]).toEqual([]);
    const provenance = message["provenance"] as Record<string, unknown>;
    expect(provenance["source"]).toBe("manual-linkedin-send");
    expect(provenance["linkedin_url"]).toBe("https://www.linkedin.com/in/ada-rowe");
    expect(provenance["recorded_by"]).toBe(USER);

    // The draft ended `sent` with the send record on its rationale.
    const draft = db.tables["comms_drafts"]![0]!;
    expect(draft["review_state"]).toBe("sent");
    const send = readDraftSend(draft["rationale"] as Record<string, unknown>);
    expect(send?.state).toBe("sent");
    expect(send?.providerMessageId).toBe(manualLinkedinMessageId("draft-1"));

    // The relationship moved forward and its touch clock advanced.
    const relationship = db.tables["comms_relationships"]![0]!;
    expect(relationship["stage"]).toBe("reached_out");
    expect(relationship["last_touch_at"]).toBeTruthy();
  });

  it("replays a second mark-as-sent: one row, same id, no second write", async () => {
    seedRelationship();
    seedDraft();

    const first = await recordLinkedinSend(client, {
      organizationId: ORG,
      userId: USER,
      draftId: "draft-1",
    });
    const second = await recordLinkedinSend(client, {
      organizationId: ORG,
      userId: USER,
      draftId: "draft-1",
    });

    expect(second.state).toBe("sent");
    expect(second.replayed).toBe(true);
    expect(second.providerMessageId).toBe(first.providerMessageId);
    expect(db.tables["comms_messages"]).toHaveLength(1);
    expect(db.tables["comms_drafts"]![0]!["review_state"]).toBe("sent");
  });

  it("never regresses a later stage: a client stays a client", async () => {
    seedRelationship({ stage: "client" });
    seedDraft();

    await recordLinkedinSend(client, { organizationId: ORG, userId: USER, draftId: "draft-1" });

    const relationship = db.tables["comms_relationships"]![0]!;
    expect(relationship["stage"]).toBe("client");
    // The send is still on the record even though the stage held.
    expect(relationship["last_touch_at"]).toBeTruthy();
    expect(db.tables["comms_messages"]).toHaveLength(1);
  });

  it("advances from new as well, the other pre-outreach stage", async () => {
    seedRelationship({ stage: "new" });
    seedDraft();
    await recordLinkedinSend(client, { organizationId: ORG, userId: USER, draftId: "draft-1" });
    expect(db.tables["comms_relationships"]![0]!["stage"]).toBe("reached_out");
  });

  it("refuses when the relationship has no LinkedIn route on record", async () => {
    seedRelationship({ metadata: { scout_handoff: { prospect_id: "prospect-1" } } });
    seedDraft();
    await expect(
      recordLinkedinSend(client, { organizationId: ORG, userId: USER, draftId: "draft-1" }),
    ).rejects.toThrow(/LinkedIn profile/i);
    // Nothing was claimed or written.
    expect(db.tables["comms_messages"] ?? []).toHaveLength(0);
    expect(db.tables["comms_drafts"]![0]!["review_state"]).toBe("draft");
  });

  it("refuses a discarded draft through the shared claim decision", async () => {
    seedRelationship();
    seedDraft({ review_state: "discarded" });
    await expect(
      recordLinkedinSend(client, { organizationId: ORG, userId: USER, draftId: "draft-1" }),
    ).rejects.toThrow(/discarded/i);
    expect(db.tables["comms_messages"] ?? []).toHaveLength(0);
  });

  it("a failed message write settles send_failed, moves no stage, and stays claimable", async () => {
    seedRelationship();
    seedDraft();

    // Same fake underneath, except the evidence write itself fails.
    const failing = {
      from: (table: string) => {
        if (table === "comms_messages") {
          return {
            upsert: () => Promise.resolve({ error: { message: "insert refused" } }),
          };
        }
        return db.from(table);
      },
    } as unknown as SupabaseClient;

    const outcome = await recordLinkedinSend(failing, {
      organizationId: ORG,
      userId: USER,
      draftId: "draft-1",
    });

    // A typed failure, not a throw and not a phantom "sent".
    expect(outcome.state).toBe("failed");
    expect(outcome.error).toMatch(/could not be recorded/i);

    // No evidence row, no settled send, and the stage never moved.
    expect(db.tables["comms_messages"] ?? []).toHaveLength(0);
    const draft = db.tables["comms_drafts"]![0]!;
    expect(draft["review_state"]).toBe("send_failed");
    const send = readDraftSend(draft["rationale"] as Record<string, unknown>);
    expect(send?.state).toBe("failed");
    const relationship = db.tables["comms_relationships"]![0]!;
    expect(relationship["stage"]).toBe("ready_to_reach");
    expect(relationship["last_touch_at"]).toBeNull();

    // The member can safely click again: the retry records the send cleanly.
    const retry = await recordLinkedinSend(client, {
      organizationId: ORG,
      userId: USER,
      draftId: "draft-1",
    });
    expect(retry.state).toBe("sent");
    expect(db.tables["comms_messages"]).toHaveLength(1);
    expect(db.tables["comms_drafts"]![0]!["review_state"]).toBe("sent");
  });
});

describe("gmail send email-confirmation gate", () => {
  function seedMembership(): void {
    db.tables["organization_memberships"] = [
      { organization_id: ORG, user_id: USER, status: "active" },
    ];
  }

  function seedEmailRelationship(metadata: FakeRow): void {
    seedRelationship({ email: "ada@northbeam.example", metadata });
  }

  it("blocks a send when the address is explicitly unconfirmed", async () => {
    seedMembership();
    seedEmailRelationship({ [EMAIL_CONFIRMED_KEY]: false });
    seedDraft();

    await expect(
      sendDraftViaGmail({ token: "t", organizationId: ORG, draftId: "draft-1" }),
    ).rejects.toThrow(/confirm it in the profile panel/i);
    // Refused before any claim: the draft is exactly as it was.
    expect(db.tables["comms_drafts"]![0]!["review_state"]).toBe("draft");
  });

  it("still sends when the key is absent: a legacy address keeps working", async () => {
    seedMembership();
    seedEmailRelationship({ scout_handoff: { prospect_id: "prospect-1" } });
    seedDraft();

    // Past the gate, the next refusal is the missing mailbox, which proves
    // the confirmation check let the legacy address through.
    await expect(
      sendDraftViaGmail({ token: "t", organizationId: ORG, draftId: "draft-1" }),
    ).rejects.toThrow(/no mailbox is connected/i);
  });

  it("sends when the address is confirmed true", async () => {
    seedMembership();
    seedEmailRelationship({ [EMAIL_CONFIRMED_KEY]: true });
    seedDraft();

    await expect(
      sendDraftViaGmail({ token: "t", organizationId: ORG, draftId: "draft-1" }),
    ).rejects.toThrow(/no mailbox is connected/i);
  });

  it("confirming clears a previous explicit false", async () => {
    seedMembership();
    seedEmailRelationship({ [EMAIL_CONFIRMED_KEY]: false });
    seedDraft();
    await expect(
      sendDraftViaGmail({ token: "t", organizationId: ORG, draftId: "draft-1" }),
    ).rejects.toThrow(/confirm it in the profile panel/i);

    // The member ticks the box and saves; the same send now clears the gate.
    db.tables["comms_relationships"]![0]!["metadata"] = { [EMAIL_CONFIRMED_KEY]: true };
    await expect(
      sendDraftViaGmail({ token: "t", organizationId: ORG, draftId: "draft-1" }),
    ).rejects.toThrow(/no mailbox is connected/i);
  });
});
