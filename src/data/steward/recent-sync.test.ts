import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NormalizedConversation } from "@/domain/steward";
import type { StoredConversation } from "@/data/supabase/steward-service";

vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
  },
}));

const saveConversation = vi.fn(async () => ({}) as never);
vi.mock("@/data/supabase/steward-service", () => ({
  stewardService: { saveConversation: (...args: unknown[]) => saveConversation(...args) },
}));

import { callIdentity, missingCalls, syncRecentMeetings } from "./recent-sync";

const incoming = (over: {
  externalId?: string;
  url?: string;
  segments?: number;
}): NormalizedConversation =>
  ({
    sourceRef: {
      provider: "fathom",
      ...(over.url ? { url: over.url } : { url: "https://fathom.video/calls/1" }),
      ...(over.externalId ? { externalId: over.externalId } : {}),
    },
    title: "Call",
    occurredAt: "2026-10-17T10:00:00Z",
    participants: [],
    segments: Array.from({ length: over.segments ?? 5 }, (_, i) => ({
      index: i,
      speaker: "A",
      at: "00:00:10",
      text: "…",
    })),
    sourceActionItems: [],
  }) as NormalizedConversation;

const stored = (over: { externalId?: string; url?: string; segments?: number }): StoredConversation =>
  ({
    id: "s1",
    organizationId: "o",
    title: "Call",
    occurredAt: "",
    ingestedAt: "",
    provider: "fathom",
    sourceUrl: over.url ?? "",
    participants: [],
    conversation: {
      sourceRef: {
        provider: "fathom",
        url: over.url ?? "",
        ...(over.externalId ? { externalId: over.externalId } : {}),
      },
      segments: Array.from({ length: over.segments ?? 0 }, (_, i) => ({ index: i })),
    },
  }) as unknown as StoredConversation;

describe("recent sync dedupe", () => {
  it("identifies calls by stable external id, then by source url", () => {
    expect(callIdentity({ externalId: "779145597", url: "x" })).toBe("id:779145597");
    expect(callIdentity({ url: "https://fathom.video/calls/1" })).toBe(
      "url:https://fathom.video/calls/1",
    );
    expect(callIdentity({})).toBeNull();
  });

  it("skips calls already stored by external id or url, and repeats in one pass", () => {
    const result = missingCalls(
      [
        incoming({ externalId: "1", url: "a" }),
        incoming({ externalId: "2", url: "b" }),
        incoming({ externalId: "2", url: "b" }),
        incoming({ externalId: "3", url: "c" }),
      ],
      [stored({ externalId: "1", segments: 5 }), stored({ url: "b", segments: 5 })],
    );
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]!.sourceRef.externalId).toBe("3");
  });

  it("never stores a call whose transcript is not ready; it is retried later", () => {
    const result = missingCalls([incoming({ externalId: "9", segments: 0 })], []);
    expect(result.missing).toHaveLength(0);
    expect(result.pendingTranscript).toBe(1);
  });

  it("a numeric id arriving later does not duplicate a url-stored row", () => {
    const result = missingCalls(
      [incoming({ externalId: "42", url: "https://fathom.video/calls/1" })],
      [stored({ url: "https://fathom.video/calls/1", segments: 5 })],
    );
    expect(result.missing).toHaveLength(0);
    expect(result.upgrades).toHaveLength(0);
  });

  it("an empty stored transcript upgrades to a late one through the SAME stored identity", () => {
    const existing = stored({ url: "https://fathom.video/calls/1", segments: 0 });
    const result = missingCalls(
      [incoming({ externalId: "42", url: "https://fathom.video/calls/1", segments: 12 })],
      [existing],
    );
    expect(result.missing).toHaveLength(0);
    expect(result.upgrades).toHaveLength(1);
    /* The upsert conflict key is org+provider+source_external_id. The
       upgrade must carry the stored row's identity — no externalId, stored
       URL — or it would insert a duplicate second row. */
    const upgrade = result.upgrades[0]!;
    expect(upgrade.sourceRef.externalId).toBeUndefined();
    expect(upgrade.sourceRef.url).toBe("https://fathom.video/calls/1");
  });

  it("never overwrites a stored transcript on segment count alone; it skips with a warning", () => {
    const full = stored({ externalId: "7", segments: 20 });
    const grown = missingCalls([incoming({ externalId: "7", segments: 30 })], [full]);
    expect(grown.upgrades).toHaveLength(0);
    expect(grown.warnings).toHaveLength(1);
    const shorter = missingCalls([incoming({ externalId: "7", segments: 3 })], [full]);
    expect(shorter.upgrades).toHaveLength(0);
    expect(shorter.warnings).toHaveLength(1);
  });

  it("a call with no stable identity is skipped with a warning, never stored", () => {
    const call = incoming({ segments: 5 });
    call.sourceRef.url = undefined as unknown as string;
    const result = missingCalls([call], []);
    expect(result.missing).toHaveLength(0);
    expect(result.upgrades).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
  });

  it("a match anywhere in the full stored list is found, not just a recent slice", () => {
    const many = Array.from({ length: 150 }, (_, i) =>
      stored({ externalId: `old-${i}`, segments: 5 }),
    );
    const result = missingCalls([incoming({ externalId: "old-149", url: "z" })], many);
    expect(result.missing).toHaveLength(0);
    expect(result.upgrades).toHaveLength(0);
  });
});

describe("recent sync persistence", () => {
  beforeEach(() => {
    saveConversation.mockClear();
    vi.restoreAllMocks();
  });

  it("a url-stored row upgraded by a numeric-id read writes the SAME row (same conflict identity)", async () => {
    const existing = stored({ url: "https://fathom.video/calls/1", segments: 0 });
    const fresh = incoming({ externalId: "42", url: "https://fathom.video/calls/1", segments: 9 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ conversations: [fresh], hasMore: false }),
      })),
    );
    const outcome = await syncRecentMeetings({
      organizationId: "o",
      userId: "u",
      stored: [existing],
    });
    expect(saveConversation).toHaveBeenCalledTimes(1);
    const written = saveConversation.mock.calls[0]![0] as {
      conversation: NormalizedConversation;
    };
    /* Same conflict key as the stored row: source_external_id falls back to
       the stored URL, so the upsert updates that row in place. */
    expect(written.conversation.sourceRef.externalId).toBeUndefined();
    expect(written.conversation.sourceRef.url).toBe("https://fathom.video/calls/1");
    expect(outcome.added).toBe(0);
    expect(outcome.refreshed).toBe(1);
    expect(outcome.checkedAt).not.toBeNull();
  });

  it("counts added and refreshed honestly and keeps checkedAt null when a write fails", async () => {
    const existing = stored({ url: "https://fathom.video/calls/9", segments: 0 });
    const upgrade = incoming({ externalId: "9", url: "https://fathom.video/calls/9", segments: 4 });
    const fresh = incoming({ externalId: "10", url: "https://fathom.video/calls/10", segments: 4 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ conversations: [upgrade, fresh], hasMore: true }),
      })),
    );
    saveConversation.mockImplementationOnce(async () => ({}) as never);
    saveConversation.mockRejectedValueOnce(new Error("write denied"));
    const outcome = await syncRecentMeetings({
      organizationId: "o",
      userId: "u",
      stored: [existing],
    });
    expect(outcome.refreshed).toBe(1);
    expect(outcome.added).toBe(0);
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.checkedAt).toBeNull();
    expect(outcome.hasMore).toBe(true);
  });
});
