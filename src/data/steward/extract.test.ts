/**
 * Extraction quality.
 *
 * A real meeting is mostly conversation. These tests hold the line between
 * work and conversational debris, and keep Steward from inventing an owner.
 */

import { describe, expect, it } from "vitest";

import { extractProposals, groupProposals, resolveSpeaker, stitchSegments } from "./extract";
import type { NormalizedConversation, ProposalKind, TranscriptSegment } from "@/domain/steward";

function conversationOf(
  lines: [string, string, string][],
  participants: NormalizedConversation["participants"] = [
    { name: "arthuremmanuel270@gmail.com", email: "arthuremmanuel270@gmail.com" },
    { name: "henry@trust-tai.com", email: "henry@trust-tai.com" },
    { name: "Taye Shobajo", email: "tayeshobajo@gmail.com" },
  ],
): NormalizedConversation {
  const segments: TranscriptSegment[] = lines.map(([at, speaker, text], index) => ({
    index,
    at,
    speaker,
    text,
  }));
  return {
    sourceRef: { provider: "fathom", externalId: "test-call", url: "https://fathom.video/calls/1" },
    title: "Test call",
    occurredAt: "2026-08-10T16:09:00Z",
    participants,
    segments,
    sourceActionItems: [],
  };
}

function kindsOf(lines: [string, string, string][]): ProposalKind[] {
  return extractProposals(conversationOf(lines)).map((proposal) => proposal.kind);
}

describe("ability and self-description are not commitments", () => {
  it("ignores audio checks, capability and habit", () => {
    expect(
      kindsOf([
        ["00:00:10", "Henry Chigozie", "I can hear you now, it broke a little but I can hear you."],
        ["00:00:20", "Henry Chigozie", "I try to manage my time very well every single day."],
        ["00:00:30", "Henry Chigozie", "If I have something to learn, I can bookmark it."],
        ["00:00:40", "Taye Shobajo", "For me, it's a lot, there's a lot I can do here."],
        ["00:00:50", "Emmanuel Arthur", "I guess this, I can hear you fine."],
      ]),
    ).toEqual([]);
  });
});

describe("explicit future promises are commitments", () => {
  it("captures a promise with an actionable object", () => {
    const proposals = extractProposals(
      conversationOf([
        ["00:13:30", "Henry Chigozie", "I will share with you a template that you can use today."],
      ]),
    );
    expect(proposals).toHaveLength(1);
    const promise = proposals[0]!;
    expect(promise.kind).toBe("follow_up");
    expect(promise.tier).toBe("observed");
    expect(promise.ownerName).toBe("Henry Chigozie");
    expect(promise.ownerResolved).toBe(true);
    expect(promise.dueText).toBe("today");
    expect(promise.dueResolved).toBe(false);
    expect(promise.evidence[0]?.label).toContain("00:13:30");
  });

  it("keeps non-sharing work as an action", () => {
    expect(
      kindsOf([["00:20:00", "Taye Shobajo", "I'll update the weekly plan with the new dates."]]),
    ).toEqual(["action"]);
  });
});

describe("rhetorical talk is not a clarification item", () => {
  it("drops audio checks, coaching prompts and hypotheticals", () => {
    expect(
      kindsOf([
        ["00:00:05", "Henry Chigozie", "Can you hear me, are you there at all?"],
        ["00:01:00", "Henry Chigozie", "If you were working in a bank, would you take this kind of decision?"],
        ["00:02:00", "Henry Chigozie", "It's something that we need to review, right?"],
        ["00:03:00", "Henry Chigozie", "Do you mind sharing a little bit about the program?"],
        ["00:04:00", "Taye Shobajo", "Is it a fireable offense, honestly?"],
      ]),
    ).toEqual([]);
  });

  it("keeps a question that leaves real work unresolved", () => {
    const proposals = extractProposals(
      conversationOf([
        ["00:30:00", "Taye Shobajo", "One open question, who owns the analytics handover after go live."],
      ]),
    );
    expect(proposals.map((p) => p.kind)).toEqual(["question"]);
    expect(proposals[0]!.tier).toBe("inferred");
  });
});

describe("conditional dependencies surface as blockers", () => {
  it("reads once/then as a dependency with evidence", () => {
    const proposals = extractProposals(
      conversationOf([
        ["00:49:38", "Henry Chigozie", "Once I get the template back, then I will share the weekly plan."],
      ]),
    );
    expect(proposals.map((p) => p.kind)).toEqual(["blocker"]);
    expect(proposals[0]!.evidence[0]?.label).toContain("00:49:38");
    expect(proposals[0]!.confidence).toBe("moderate");
  });

  it("does not call ordinary sequencing a blocker", () => {
    expect(kindsOf([["00:10:00", "Taye Shobajo", "After the call we all went back to work."]])).toEqual(
      [],
    );
  });
});

describe("owner reconciliation fails closed", () => {
  const conversation = conversationOf([["00:00:10", "Emmanuel Arthur", "Hello."]]);

  it("matches a display name against an email local part", () => {
    expect(resolveSpeaker("Emmanuel Arthur", conversation).resolved).toBe(true);
    expect(resolveSpeaker("Henry Chigozie", conversation).resolved).toBe(true);
    expect(resolveSpeaker("Taye Shobajo", conversation).resolved).toBe(true);
  });

  it("refuses to resolve a speaker who is not a participant", () => {
    expect(resolveSpeaker("Lillian Okafor", conversation).resolved).toBe(false);
  });

  it("never resolves a third party merely named in the words", () => {
    const proposals = extractProposals(
      conversationOf([
        ["00:12:00", "Taye Shobajo", "Can you please send Lillian the updated plan document?"],
      ]),
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.ownerName).not.toBe("Lillian");
  });
});

describe("sentence stitching", () => {
  const segments: TranscriptSegment[] = [
    { index: 0, at: "00:09:57", speaker: "Henry", text: "And I will share with you" },
    { index: 1, at: "00:10:02", speaker: "Henry", text: "the weekly plan template today." },
    { index: 2, at: "00:10:20", speaker: "Taye", text: "Understood." },
  ];

  it("joins a mid-sentence segment from the same speaker and keeps the first timestamp", () => {
    const windows = stitchSegments(segments);
    expect(windows).toHaveLength(2);
    expect(windows[0]!.at).toBe("00:09:57");
    expect(windows[0]!.text).toBe("And I will share with you the weekly plan template today.");
    expect(windows[0]!.segments).toHaveLength(2);
  });

  it("never crosses a speaker boundary", () => {
    const windows = stitchSegments([
      { index: 0, at: "00:00:01", speaker: "Henry", text: "And I will send" },
      { index: 1, at: "00:00:04", speaker: "Taye", text: "the plan tomorrow." },
    ]);
    expect(windows).toHaveLength(2);
  });

  it("never bridges a long pause", () => {
    const windows = stitchSegments([
      { index: 0, at: "00:00:01", speaker: "Henry", text: "And I will send" },
      { index: 1, at: "00:05:00", speaker: "Henry", text: "the plan tomorrow." },
    ]);
    expect(windows).toHaveLength(2);
  });

  it("keeps evidence spans for every stitched segment", () => {
    const conversation: NormalizedConversation = {
      ...conversationOf([]),
      segments,
    };
    const proposals = extractProposals(conversation);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.at).toBe("00:09:57");
    expect(proposals[0]!.evidence).toHaveLength(2);
  });
});

describe("provider action items stay provider interpretation", () => {
  it("never becomes observed truth or a resolved owner", () => {
    const conversation: NormalizedConversation = {
      ...conversationOf([]),
      sourceActionItems: [{ description: "Share weekly plan template", assigneeName: "Henry Chigozie" }],
    };
    const grouped = groupProposals(extractProposals(conversation));
    expect(grouped.action).toHaveLength(1);
    expect(grouped.action[0]!.tier).toBe("inferred");
    expect(grouped.action[0]!.ownerResolved).toBe(false);
  });
});
