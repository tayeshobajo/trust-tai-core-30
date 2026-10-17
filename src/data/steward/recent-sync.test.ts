import { describe, expect, it } from "vitest";

import type { NormalizedConversation } from "@/domain/steward";
import type { StoredConversation } from "@/data/supabase/steward-service";

import { callIdentity, missingCalls } from "./recent-sync";

const incoming = (over: {
 quality?: number;
  externalId?: string;
  url?: string;
  segments?: number;
}): NormalizedConversation =>
  ({
    sourceRef: {
      provider: "fathom",
      url: over.url ?? "https://fathom.video/calls/1",
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

const stored = (over: { externalId?: string; url?: string }): StoredConversation =>
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
      sourceRef: { provider: "fathom", url: over.url ?? "", ...(over.externalId ? { externalId: over.externalId } : {}) },
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
      [stored({ externalId: "1" }), stored({ url: "b" })],
    );
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]!.sourceRef.externalId).toBe("3");
  });

  it("never stores a call whose transcript is not ready; it is retried later", () => {
    const result = missingCalls([incoming({ externalId: "9", segments: 0 })], []);
    expect(result.missing).toHaveLength(0);
    expect(result.pendingTranscript).toBe(1);
  });
});
