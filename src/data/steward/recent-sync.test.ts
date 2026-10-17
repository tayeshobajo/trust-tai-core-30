import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NormalizedConversation } from "@/domain/steward";
import type { StoredConversation } from "@/data/supabase/steward-service";

vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
  },
}));

const saveConversation = vi.fn(async (_input: unknown) => ({}) as never);
const findConversationBySource = vi.fn(async (_input: unknown) => null as StoredConversation | null);
vi.mock("@/data/supabase/steward-service", () => ({
  stewardService: {
    saveConversation: (input: unknown) => saveConversation(input),
    findConversationBySource: (input: unknown) => findConversationBySource(input),
  },
}));

import { callIdentity, syncRecentMeetings } from "./recent-sync";

const incoming = (over: {
  externalId?: string;
  shareToken?: string;
  url?: string;
  segments?: number;
}): NormalizedConversation =>
  ({
    sourceRef: {
      provider: "fathom",
      ...(over.url ? { url: over.url } : { url: "https://fathom.video/calls/1" }),
      ...(over.externalId ? { externalId: over.externalId } : {}),
      ...(over.shareToken ? { shareToken: over.shareToken } : {}),
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

const stored = (over: {
  sourceExternalId?: string;
  externalId?: string;
  url?: string;
  segments?: number;
}): StoredConversation =>
  ({
    id: "s1",
    organizationId: "o",
    title: "Call",
    occurredAt: "",
    ingestedAt: "",
    provider: "fathom",
    sourceExternalId: over.sourceExternalId ?? over.externalId ?? over.url ?? "",
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

const stubFetch = (conversations: NormalizedConversation[], hasMore = false) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ conversations, hasMore }),
    })),
  );

describe("recent sync identity", () => {
  it("identifies calls by stable external id, then by source url", () => {
    expect(callIdentity({ externalId: "779145597", url: "x" })).toBe("id:779145597");
    expect(callIdentity({ url: "https://fathom.video/calls/1" })).toBe(
      "url:https://fathom.video/calls/1",
    );
    expect(callIdentity({})).toBeNull();
  });
});

describe("recent sync persistence", () => {
  beforeEach(() => {
    saveConversation.mockClear();
    saveConversation.mockImplementation(async () => ({}) as never);
    findConversationBySource.mockClear();
    findConversationBySource.mockImplementation(async () => null);
    vi.unstubAllGlobals();
  });

  it("looks up each call by exact org+provider identity, never a capped listing", async () => {
    const call = incoming({ externalId: "42", shareToken: "tok", url: "https://f.video/1" });
    stubFetch([call]);
    await syncRecentMeetings({ organizationId: "o", userId: "u" });
    expect(findConversationBySource).toHaveBeenCalledWith({
      organizationId: "o",
      provider: "fathom",
      externalIds: ["42", "tok"],
      url: "https://f.video/1",
    });
  });

  it("a match beyond any listing window is found by lookup, not duplicated", async () => {
    /* The stored row exists somewhere deep in the table — no listing slice
       is involved at all, so position cannot matter. */
    findConversationBySource.mockImplementation(async () =>
      stored({ sourceExternalId: "old-149", externalId: "old-149", segments: 5 }),
    );
    stubFetch([incoming({ externalId: "old-149", url: "z", segments: 9 })]);
    const outcome = await syncRecentMeetings({ organizationId: "o", userId: "u" });
    expect(saveConversation).not.toHaveBeenCalled();
    expect(outcome.added).toBe(0);
    expect(outcome.refreshed).toBe(0);
    expect(outcome.warnings).toHaveLength(1);
  });

  it("a url-stored row upgraded by a numeric-id read writes the SAME row (stored conflict identity)", async () => {
    findConversationBySource.mockImplementation(async () =>
      stored({
        sourceExternalId: "https://fathom.video/calls/1",
        url: "https://fathom.video/calls/1",
        segments: 0,
      }),
    );
    stubFetch([incoming({ externalId: "42", url: "https://fathom.video/calls/1", segments: 9 })]);
    const outcome = await syncRecentMeetings({ organizationId: "o", userId: "u" });
    expect(saveConversation).toHaveBeenCalledTimes(1);
    const written = saveConversation.mock.calls[0]![0] as unknown as {
      conversation: NormalizedConversation;
    };
    /* The write carries the stored row's ACTUAL source_external_id — its
       URL — so the upsert conflict key hits that same row in place. The
       incoming numeric id and any share token stay out of the key path. */
    expect(written.conversation.sourceRef.externalId).toBe("https://fathom.video/calls/1");
    expect(written.conversation.sourceRef.shareToken).toBeUndefined();
    expect(written.conversation.sourceRef.url).toBe("https://fathom.video/calls/1");
    expect(outcome.added).toBe(0);
    expect(outcome.refreshed).toBe(1);
    expect(outcome.checkedAt).not.toBeNull();
  });

  it("a shareToken-keyed row matched by a different incoming token upgrades the SAME row", async () => {
    findConversationBySource.mockImplementation(async () =>
      stored({ sourceExternalId: "tok-stored", url: "https://fathom.video/calls/7", segments: 0 }),
    );
    stubFetch([
      incoming({ externalId: "99", shareToken: "tok-new", url: "https://fathom.video/calls/7" }),
    ]);
    const outcome = await syncRecentMeetings({ organizationId: "o", userId: "u" });
    expect(saveConversation).toHaveBeenCalledTimes(1);
    const written = saveConversation.mock.calls[0]![0] as unknown as {
      conversation: NormalizedConversation;
    };
    /* Stored key wins: the write carries tok-stored, not the incoming
       token, so no second row is inserted. */
    expect(written.conversation.sourceRef.externalId).toBe("tok-stored");
    expect(written.conversation.sourceRef.shareToken).toBeUndefined();
    expect(outcome.refreshed).toBe(1);
  });

  it("never overwrites a stored transcript on segment count alone; it skips with a warning", async () => {
    findConversationBySource.mockImplementation(async () =>
      stored({ sourceExternalId: "7", externalId: "7", segments: 20 }),
    );
    stubFetch([incoming({ externalId: "7", segments: 30 })]);
    const grown = await syncRecentMeetings({ organizationId: "o", userId: "u" });
    expect(saveConversation).not.toHaveBeenCalled();
    expect(grown.warnings).toHaveLength(1);

    stubFetch([incoming({ externalId: "7", segments: 3 })]);
    const shorter = await syncRecentMeetings({ organizationId: "o", userId: "u" });
    expect(saveConversation).not.toHaveBeenCalled();
    expect(shorter.warnings).toHaveLength(1);
  });

  it("a call with no stable identity is skipped with a warning, never stored or looked up", async () => {
    const call = incoming({ segments: 5 });
    call.sourceRef.url = undefined as unknown as string;
    stubFetch([call]);
    const outcome = await syncRecentMeetings({ organizationId: "o", userId: "u" });
    expect(findConversationBySource).not.toHaveBeenCalled();
    expect(saveConversation).not.toHaveBeenCalled();
    expect(outcome.warnings).toHaveLength(1);
  });

  it("never stores a call whose transcript is not ready; it is retried later", async () => {
    stubFetch([incoming({ externalId: "9", segments: 0 })]);
    const outcome = await syncRecentMeetings({ organizationId: "o", userId: "u" });
    expect(saveConversation).not.toHaveBeenCalled();
    expect(outcome.pendingTranscript).toBe(1);
  });

  it("a failed or ambiguous lookup skips the write and reports an error", async () => {
    findConversationBySource.mockImplementation(async () => {
      throw new Error("more than one stored record");
    });
    stubFetch([incoming({ externalId: "5", segments: 4 })]);
    const outcome = await syncRecentMeetings({ organizationId: "o", userId: "u" });
    expect(saveConversation).not.toHaveBeenCalled();
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0]).toContain("left untouched");
    expect(outcome.checkedAt).toBeNull();
  });

  it("counts added and refreshed honestly and keeps checkedAt null when a write fails", async () => {
    const upgrade = incoming({ externalId: "9", url: "https://fathom.video/calls/9", segments: 4 });
    const fresh = incoming({ externalId: "10", url: "https://fathom.video/calls/10", segments: 4 });
    findConversationBySource.mockImplementation(async (input) => {
      const ids = (input as { externalIds: string[] }).externalIds;
      return ids.includes("9")
        ? stored({ sourceExternalId: "9", externalId: "9", segments: 0 })
        : null;
    });
    stubFetch([upgrade, fresh], true);
    /* Writes run in incoming order: the upgrade's write fails, the new
       call's succeeds — added/refreshed must reflect that exactly. */
    saveConversation.mockRejectedValueOnce(new Error("write denied"));
    saveConversation.mockImplementationOnce(async () => ({}) as never);
    const outcome = await syncRecentMeetings({ organizationId: "o", userId: "u" });
    expect(outcome.refreshed).toBe(0);
    expect(outcome.added).toBe(1);
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.checkedAt).toBeNull();
    expect(outcome.hasMore).toBe(true);
  });
});
