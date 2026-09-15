/**
 * Writing saved by a person, with no model involved (P1.5 / F2.4).
 *
 * The reply bar's Save goes through the same draft service every other draft
 * uses. What matters here: the saved draft belongs to the relationship it was
 * written under, it is parked at the human boundary, its record says a person
 * wrote it, and it is still there on the next read.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { rawWritingDraft } from "@/domain/comms-raw-draft";

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

async function relationship() {
  return commsService.create(
    { fullName: "Dana Reid", email: "dana@example.invalid", source: "in_person" },
    CONTEXT,
  );
}

describe("saving writing of your own", () => {
  it("binds the draft to that relationship and survives a reload", async () => {
    const dana = await relationship();

    const saved = await commsService.saveDraft(
      {
        relationship: dana,
        ...rawWritingDraft({ register: "follow_up", text: "  Sending the notes tonight.  " }),
      },
      CONTEXT,
    );

    expect(saved.body).toBe("Sending the notes tonight.");
    expect(saved.reviewState).toBe("needs_human_review");
    expect(saved.rationale["generated"]).toBe(false);
    expect(saved.rationale["writtenBy"]).toBe("person");
    expect(saved.evidence).toHaveLength(0);

    /* Reload: the same record, still pointing at the same person. */
    const again = await commsService.listDrafts(dana.id);
    expect(again).toHaveLength(1);
    expect(again[0]?.id).toBe(saved.id);
    expect(again[0]?.body).toBe("Sending the notes tonight.");
    expect(db.tables["comms_drafts"]![0]!["relationship_id"]).toBe(dana.id);
  });

  it("writes to the one draft store, not a second one of its own", async () => {
    const dana = await relationship();
    await commsService.saveDraft(
      { relationship: dana, ...rawWritingDraft({ register: "logistics", text: "Quick check in." }) },
      CONTEXT,
    );
    expect(db.tables["comms_drafts"]).toHaveLength(1);
  });

  it("keeps the writing on screen when the save fails", async () => {
    const dana = await relationship();
    const original = db.from;
    const broken = vi
      .spyOn(db, "from")
      .mockImplementation((table: string) =>
        table === "comms_drafts"
          ? ({
              insert: () => ({
                select: () => ({
                  single: async () => ({ data: null, error: { message: "network down" } }),
                }),
              }),
            } as never)
          : original.call(db, table),
      );

    await expect(
      commsService.saveDraft(
        { relationship: dana, ...rawWritingDraft({ register: "follow_up", text: "Still mine." }) },
        CONTEXT,
      ),
    ).rejects.toThrow();

    broken.mockRestore();
    /* Nothing was written, so nothing is lost: the reply bar keeps the text. */
    expect(db.tables["comms_drafts"] ?? []).toHaveLength(0);
  });
});
