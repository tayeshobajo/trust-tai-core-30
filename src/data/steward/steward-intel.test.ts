/**
 * Steward inside shared intelligence.
 *
 * These tests check the three things that must stay true when Steward feeds
 * Ask Trust Tai and Pulse: promises appear as decided truth with the evidence
 * they rest on, every signal routes back to Steward rather than creating a
 * second copy of the work elsewhere, and a link Steward cannot honestly read
 * is refused instead of guessed at.
 */

import { describe, expect, it } from "vitest";

import { answer, deriveSignals, contextBlocks, emptySnapshot } from "@/data/intelligence/derive";
import { parseConversationLink, parseFathomRef } from "@/lib/conversation-source";
import { extractProposals } from "@/data/steward/extract";
import { rehearsalConversation } from "@/data/steward/fixture";
import type { Commitment } from "@/domain/steward";

const NOW = "2026-03-10T12:00:00.000Z";
const ORG = "org-1";

function commitment(overrides: Partial<Commitment> = {}): Commitment {
  return {
    id: "commit-1",
    organizationId: ORG,
    conversationId: "conv-1",
    ownerName: "Dana",
    what: "email the client's IT lead about DNS access",
    status: "open",
    sourceKey: "conv-1:dns",
    evidence: [{ label: "Northwind rollout check-in, 00:02:38", kind: "human" }],
    createdAt: "2026-03-01T12:00:00.000Z",
    updatedAt: "2026-03-01T12:00:00.000Z",
    ...overrides,
  };
}

function snapshotWith(commitments: Commitment[]) {
  const base = emptySnapshot(ORG, NOW);
  return {
    ...base,
    steward: {
      commitments,
      conversations: [
        {
          id: "conv-1",
          title: "Northwind rollout check-in",
          occurredAt: "2026-03-01T12:00:00.000Z",
          url: "https://fathom.video/calls/123456",
        },
      ],
    },
  };
}

describe("Steward evidence in Ask Trust Tai", () => {
  it("contributes a decided context block carrying the line it came from", () => {
    const blocks = contextBlocks(snapshotWith([commitment()]));
    const block = blocks.find((entry) => entry.id === "steward-commitment-commit-1");

    expect(block).toBeDefined();
    expect(block?.appId).toBe("steward");
    expect(block?.tier).toBe("decided");
    expect(block?.fact).toContain("Dana committed to");
    expect(block?.evidence[0]?.label).toContain("00:02:38");
  });

  it("answers 'what needs my attention today' with the Steward signal and its evidence", () => {
    const overdue = commitment({
      dueAt: "2026-03-05T12:00:00.000Z",
      updatedAt: "2026-03-05T12:00:00.000Z",
    });
    const read = answer(snapshotWith([overdue]), "What needs my attention today?");

    expect(read.sufficient).toBe(true);
    expect(read.contributingApps).toContain("steward");
    expect(read.signals.some((signal) => signal.category === "stewardship")).toBe(true);
    expect(read.blocks.some((block) => block.appId === "steward")).toBe(true);
  });

  it("recommends the Steward move, and routes to the room that owns it", () => {
    const overdue = commitment({
      dueAt: "2026-03-05T12:00:00.000Z",
      updatedAt: "2026-03-05T12:00:00.000Z",
    });
    const read = answer(snapshotWith([overdue]), "What should happen next, and why?");

    expect(read.signals[0]?.destination).toEqual({
      appId: "steward",
      label: "Open in Steward",
      route: "/modules/steward",
    });
  });

  it("reports Steward as having no data rather than implying silence is safety", () => {
    const read = answer(emptySnapshot(ORG, NOW), "What needs my attention today?");
    expect(read.withheld.some((source) => source.appId === "steward" && source.reason === "no_data")).toBe(
      true,
    );
  });
});

describe("Steward risk and follow-up in Pulse", () => {
  it("raises an overdue promise as an at-risk stewardship signal", () => {
    const signals = deriveSignals(
      snapshotWith([
        commitment({ dueAt: "2026-03-05T12:00:00.000Z", updatedAt: "2026-03-05T12:00:00.000Z" }),
      ]),
    );
    const signal = signals.find((entry) => entry.id === "steward-commit-1");

    expect(signal?.category).toBe("stewardship");
    expect(signal?.title).toContain("slipping");
    expect(signal?.urgency).toBeGreaterThanOrEqual(90);
    expect(signal?.contextRefs).toEqual(["steward-commitment-commit-1"]);
  });

  it("raises an unresolved blocker that is waiting on someone else", () => {
    const signals = deriveSignals(
      snapshotWith([
        commitment({ status: "waiting", updatedAt: "2026-03-04T12:00:00.000Z" }),
      ]),
    );
    const signal = signals.find((entry) => entry.id === "steward-commit-1");

    expect(signal?.title).toContain("waiting");
    expect(signal?.recommendedNextMove).toContain("who is being waited on");
  });

  it("never emits a second entity for the same promise", () => {
    const signals = deriveSignals(
      snapshotWith([
        commitment({ dueAt: "2026-03-05T12:00:00.000Z", updatedAt: "2026-03-05T12:00:00.000Z" }),
        commitment({
          id: "commit-2",
          sourceKey: "conv-1:outline",
          ownerName: "Marcus",
          what: "send the revised outline",
          status: "waiting",
          updatedAt: "2026-03-02T12:00:00.000Z",
        }),
      ]),
    );
    const stewardSignals = signals.filter((signal) => signal.category === "stewardship");

    expect(stewardSignals).toHaveLength(2);
    expect(new Set(stewardSignals.map((signal) => signal.subject?.id)).size).toBe(2);
    /* Steward reports on promises. It does not mint projects or prospects. */
    expect(stewardSignals.every((signal) => signal.subject?.type === "task")).toBe(true);
  });

  it("stays silent about promises that were kept or released", () => {
    const signals = deriveSignals(
      snapshotWith([
        commitment({ status: "kept" }),
        commitment({ id: "commit-3", sourceKey: "conv-1:x", status: "released" }),
      ]),
    );
    expect(signals.filter((signal) => signal.category === "stewardship")).toHaveLength(0);
  });
});

describe("Fathom link validation", () => {
  it("reads a call link", () => {
    expect(parseFathomRef("https://fathom.video/calls/123456789")).toEqual({
      provider: "fathom",
      externalId: "123456789",
      url: "https://fathom.video/calls/123456789",
    });
  });

  it("reads a share link as a share token, not an id", () => {
    const ref = parseFathomRef("https://fathom.video/share/abc-XYZ_123");
    expect(ref?.shareToken).toBe("abc-XYZ_123");
    expect(ref?.externalId).toBeUndefined();
  });

  it("accepts a bare call id", () => {
    expect(parseFathomRef("987654")?.externalId).toBe("987654");
  });

  it("refuses anything it cannot honestly read", () => {
    for (const input of [
      "",
      "   ",
      "not a link",
      "https://example.com/calls/123456",
      "https://fathom.video.evil.com/calls/123456",
      "https://zoom.us/rec/share/abc",
      "https://fathom.video/",
    ]) {
      expect(parseConversationLink(input)).toBeNull();
    }
  });
});

describe("Rehearsal transcript stays a rehearsal", () => {
  it("is labelled, and extraction over it is deterministic", () => {
    const conversation = rehearsalConversation();
    expect(conversation.rehearsal).toBe(true);
    expect(conversation.sourceRef.provider).toBe("fixture");

    const first = extractProposals(conversation);
    const second = extractProposals(conversation);
    expect(first.length).toBeGreaterThan(0);
    expect(second.map((p) => p.id)).toEqual(first.map((p) => p.id));
  });
});
