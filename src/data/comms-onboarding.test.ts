import { describe, expect, it, vi } from "vitest";

import {
  addMailboxCandidateToComms,
  clampBackfillDays,
  HISTORY_IMPORT_WARNING,
  ONBOARDING_BACKFILL_DAYS,
} from "@/data/comms-onboarding";
import type { Relationship } from "@/domain/comms";
import type { RelationshipInput } from "@/data/supabase/comms-service";

const relationship = { id: "rel-1", fullName: "Jane Example" } as unknown as Relationship;

const input: RelationshipInput = {
  fullName: "Jane Example",
  email: "jane@example.com",
  source: "inbound",
  stage: "new",
};

describe("addMailboxCandidateToComms", () => {
  it("creates once, then backfills, and reports no warning on success", async () => {
    const createRelationship = vi.fn().mockResolvedValue(relationship);
    const backfillHistory = vi.fn().mockResolvedValue({ messagesStored: 4 });

    const result = await addMailboxCandidateToComms(input, { createRelationship, backfillHistory });

    expect(createRelationship).toHaveBeenCalledTimes(1);
    expect(createRelationship).toHaveBeenCalledWith(input);
    expect(backfillHistory).toHaveBeenCalledTimes(1);
    expect(result.relationship).toBe(relationship);
    expect(result.historyWarning).toBeNull();
  });

  it("keeps the relationship and warns when the history import fails", async () => {
    const createRelationship = vi.fn().mockResolvedValue(relationship);
    const backfillHistory = vi.fn().mockRejectedValue(new Error("Google refused the read."));

    const result = await addMailboxCandidateToComms(input, { createRelationship, backfillHistory });

    expect(result.relationship).toBe(relationship);
    expect(result.historyWarning).toBe(HISTORY_IMPORT_WARNING);
    // No rollback: creation is never called again to undo anything.
    expect(createRelationship).toHaveBeenCalledTimes(1);
  });

  it("runs creation first: a creation failure never reaches the backfill", async () => {
    const createRelationship = vi.fn().mockRejectedValue(new Error("Not a member of this workspace."));
    const backfillHistory = vi.fn().mockResolvedValue({});

    await expect(
      addMailboxCandidateToComms(input, { createRelationship, backfillHistory }),
    ).rejects.toThrow("Not a member of this workspace.");
    expect(backfillHistory).not.toHaveBeenCalled();
  });

  it("treats an already-tracked person as success: the existing relationship comes back and the backfill is still safe to run", async () => {
    // commsService.create returns the existing relationship on an email match;
    // the backfill upserts on provider message id, so nothing doubles.
    const createRelationship = vi.fn().mockResolvedValue(relationship);
    const backfillHistory = vi.fn().mockResolvedValue({ messagesStored: 0 });

    const result = await addMailboxCandidateToComms(input, { createRelationship, backfillHistory });

    expect(result.relationship.id).toBe("rel-1");
    expect(result.historyWarning).toBeNull();
    expect(createRelationship).toHaveBeenCalledTimes(1);
    expect(backfillHistory).toHaveBeenCalledTimes(1);
  });
});

describe("clampBackfillDays", () => {
  it("clamps the window to 1–90 days and rounds", () => {
    expect(clampBackfillDays(ONBOARDING_BACKFILL_DAYS)).toBe(30);
    expect(clampBackfillDays(0)).toBe(1);
    expect(clampBackfillDays(-10)).toBe(1);
    expect(clampBackfillDays(365)).toBe(90);
    expect(clampBackfillDays(44.6)).toBe(45);
  });
});
