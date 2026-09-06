/**
 * Approved has to mean a person decided.
 *
 * These pin the production gap found on a real draft: a row saying
 * `review_state = 'approved'` with no record of who approved it or when.
 * The rules proved here are that approval writes provenance in the same
 * operation as the state, that an approval without a signed-in human never
 * reaches the database at all, that a legacy approval cannot be sent, and
 * that approving sends nothing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildDraftApproval,
  isLegacyApproved,
  readDraftApproval,
  writeDraftApproval,
} from "@/domain/comms-approval";
import { decideSendClaim } from "@/domain/comms-send";
import type { Relationship } from "@/domain/comms";

import { createFakeSupabase } from "./fake-supabase";

const db = createFakeSupabase();

vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: { from: (table: string) => db.from(table) },
}));

const { commsService } = await import("./comms-service");

const CONTEXT = { organizationId: "org-1", userId: "user-1" };

beforeEach(() => {
  for (const key of Object.keys(db.tables)) db.tables[key] = [];
});

function relationship(): Relationship {
  return { id: "rel-1", fullName: "Megan Walls" } as Relationship;
}

async function seedDraft(rationale: Record<string, unknown>) {
  return commsService.saveDraft(
    {
      relationship: relationship(),
      register: "warm_intro",
      intent: "Reply",
      subject: "Re: Enquiries",
      body: "Megan,\n\nOne question.\n\nTrust,\nTai",
      reviewState: "needs_human_review",
      rationale,
      evidence: [],
    },
    CONTEXT,
  );
}

describe("comms draft approval provenance", () => {
  it("reads nothing back from an approval missing an actor or a time", () => {
    expect(readDraftApproval(null)).toBeNull();
    expect(readDraftApproval({ approval: { state: "approved" } })).toBeNull();
    expect(readDraftApproval({ approval: { state: "approved", at: "2026-09-04T13:36:00Z" } })).toBeNull();
    expect(readDraftApproval({ approval: { state: "approved", by: { id: "u1" } } })).toBeNull();
    expect(
      readDraftApproval({ approval: { state: "approved", by: { id: "u1" }, at: "not a date" } }),
    ).toBeNull();
  });

  it("keeps the rest of the rationale when the stamp is written", () => {
    const stamp = buildDraftApproval({ actorId: "u1", actorLabel: "Tai", reason: "Looks right" });
    const next = writeDraftApproval({ violations: [], note: "agent note" }, stamp);
    expect(next["note"]).toBe("agent note");
    expect(readDraftApproval(next)?.by).toEqual({ id: "u1", label: "Tai" });
    expect(readDraftApproval(next)?.reason).toBe("Looks right");
  });

  it("refuses to build an approval with no signed-in human", () => {
    expect(() => buildDraftApproval({ actorId: null })).toThrow();
    expect(() => buildDraftApproval({ actorId: "  " })).toThrow();
  });

  it("writes state and provenance together, and sends nothing", async () => {
    const draft = await seedDraft({ violations: [] });
    const approved = await commsService.setDraftState(draft, "approved", relationship(), CONTEXT, {
      reason: "Reads true",
      actorLabel: "Tai",
    });

    expect(approved.reviewState).toBe("approved");
    const stamp = readDraftApproval(approved.rationale);
    expect(stamp?.by.id).toBe("user-1");
    expect(stamp?.reason).toBe("Reads true");
    expect(new Date(stamp!.at).getTime()).toBeGreaterThan(0);
    expect(isLegacyApproved(approved.reviewState, approved.rationale)).toBe(false);

    // Nothing on the row claims a send happened.
    expect(approved.rationale?.["send"]).toBeUndefined();

    const decided = db.tables["activities"]!.filter((row) =>
      String(row["kind"]).includes("conversation.decided"),
    );
    expect(decided).toHaveLength(1);
  });

  it("never reaches the database when there is no actor to name", async () => {
    const draft = await seedDraft({ violations: [] });
    const before = JSON.stringify(db.tables["comms_drafts"]);
    await expect(
      commsService.setDraftState(draft, "approved", relationship(), {
        organizationId: "org-1",
        userId: "",
      }),
    ).rejects.toThrow();
    expect(JSON.stringify(db.tables["comms_drafts"])).toBe(before);
  });

  it("changes only the draft it was given", async () => {
    const first = await seedDraft({ violations: [] });
    const second = await seedDraft({ violations: [] });
    await commsService.setDraftState(first, "approved", relationship(), CONTEXT);

    const rows = db.tables["comms_drafts"]!;
    const other = rows.find((row) => row["id"] === second.id)!;
    expect(other["review_state"]).toBe("needs_human_review");
    expect(readDraftApproval(other["rationale"] as Record<string, unknown>)).toBeNull();
  });

  it("refuses to send a legacy approval, and allows it once re-approved", async () => {
    const legacy = {
      reviewState: "approved" as const,
      rationale: { violations: [], note: "agent note" },
      updatedAt: new Date().toISOString(),
    };
    expect(isLegacyApproved(legacy.reviewState, legacy.rationale)).toBe(true);
    const refusal = decideSendClaim(legacy, new Date());
    expect(refusal.kind).toBe("not_sendable");

    const draft = await seedDraft(legacy.rationale);
    const reapproved = await commsService.setDraftState(
      draft,
      "approved",
      relationship(),
      CONTEXT,
      { reason: "Still right" },
    );
    expect(isLegacyApproved(reapproved.reviewState, reapproved.rationale)).toBe(false);
    expect(
      decideSendClaim(
        {
          reviewState: reapproved.reviewState,
          rationale: reapproved.rationale ?? {},
          updatedAt: reapproved.updatedAt,
        },
        new Date(),
      ).kind,
    ).toBe("claim");
    // Re-approving is not sending.
    expect(reapproved.rationale?.["send"]).toBeUndefined();
  });
});
