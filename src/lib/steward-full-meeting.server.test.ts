import { describe, expect, it, vi } from "vitest";
import type { NormalizedConversation } from "@/domain/steward";
import type { InterpretInput } from "./steward-interpret.server";
import { groundedTimeline, transcriptDigest } from "@/data/steward/meeting-process";
import { reasonFullMeeting, transcriptChunks } from "./steward-full-meeting.server";
const conversation: NormalizedConversation = {
  title: "Fixture delivery review",
  occurredAt: "2026-10-19T16:00:00Z",
  sourceRef: { provider: "fixture", url: "https://example.test/call" },
  participants: [{ name: "Alex" }],
  sourceActionItems: [],
  segments: [
    {
      index: 0,
      speaker: "Alex",
      at: "00:00:00",
      text: "The dashboard is already coded, but we have not checked the browser.",
    },
    {
      index: 1,
      speaker: "Alex",
      at: "00:10:00",
      text: "The invitation journey needs checking. Yes, that is mine through this week unless priorities change.",
    },
    {
      index: 2,
      speaker: "Alex",
      at: "00:30:00",
      text: "The release notes need an owner. Nobody has accepted that yet.",
    },
  ],
};
const input = (c = conversation): InterpretInput => ({
  conversation: c,
  commitments: [],
  memory: {
    available: true,
    because: "Fixture memory",
    people: [],
    projects: [],
    openCommitments: [],
  },
});
const finding = (overrides: Record<string, unknown> = {}) => ({
  disposition: "commitment",
  meaning: "Check the invitation journey in a browser",
  owner: "Alex",
  owner_basis: "explicit",
  criteria_basis: "proposed",
  due_text: "through this week unless priorities change",
  definition_of_done: "Record the invitation journey outcome and evidence.",
  dependency: null,
  ambiguity: "Conditional timing needs clarification.",
  evidence: [{ index: 1, quote: conversation.segments[1]!.text }],
  duplicate_of: null,
  ...overrides,
});
const model = (findings = [finding()]) =>
  vi.fn(async () => ({
    raw: JSON.stringify({
      findings,
      summary: "Review invitations; code completion still needs verification.",
    }),
    provider: "fixture",
    model: "fixture",
  }));
describe("full meeting reasoning", () => {
  it("reads every turn including unflagged late context then reconciles; never invents a Friday deadline", async () => {
    const call = model();
    const run = await reasonFullMeeting(input(), call, {});

    expect(run.coverage).toMatchObject({
      segmentsRead: 3,
      segmentsTotal: 3,
      sourceCompleteness: "unverified",
    });
    expect(run.signals[0]).toMatchObject({
      dueAt: null,
      ownerName: "Alex",
      truthTier: "inferred",
      timeline: { basis: "ambiguous", suggestedDate: null },
    });
    expect(call).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({
        responseFormat: expect.objectContaining({ type: "json_schema", strict: true }),
      }),
    );
  });
  it("covers all chunk boundaries without truncation and reconciles once at the end", async () => {
    const c = {
      ...conversation,
      segments: Array.from({ length: 5 }, (_, index) => ({
        index,
        speaker: "Alex",
        at: "00:00:00",
        text: "context ".repeat(1800),
      })),
    };
    expect(
      transcriptChunks(c)
        .flat()
        .map((s) => s.index),
    ).toEqual([0, 1, 2, 3, 4]);
    const packets: { stage: string; turns?: { index: number }[] }[] = [];
    const call = vi.fn(async (request: { input: string }) => {
      packets.push(JSON.parse(request.input));
      return {
        raw: JSON.stringify({ findings: [], summary: "Context only" }),
        provider: "fixture",
        model: "fixture",
      };
    });
    const run = await reasonFullMeeting(input(c), call as never, {});
    expect(
      packets
        .filter((p) => p.stage === "read_every_turn")
        .flatMap((p) => (p.turns ?? []).map((t) => t.index)),
    ).toEqual([0, 1, 2, 3, 4]);
    expect(packets.at(-1)?.stage).toBe("reconcile_whole_meeting");
    expect(run.coverage?.segmentsRead).toBe(5);
  });
  it("rejects unsupported evidence and invented timeline phrases", async () => {
    await expect(
      reasonFullMeeting(
        input(),
        model([finding({ evidence: [{ index: 1, quote: "Made up quote" }] })]),
        {},
      ),
    ).rejects.toThrow("unsupported transcript citation");
    await expect(
      reasonFullMeeting(input(), model([finding({ due_text: "Friday" })]), {}),
    ).rejects.toThrow("timeline");
  });
  it("repairs once using original turns without relaxing exact quotation checks", async () => {
    const requests: Record<string, unknown>[] = [];
    const call = vi.fn(async (request: { input: string }) => {
      const packet = JSON.parse(request.input);
      requests.push(packet);
      const findings =
        requests.length === 1
          ? [finding({ evidence: [{ index: 0, quote: conversation.segments[1]!.text }] })]
          : [finding()];
      return {
        raw: JSON.stringify({ findings, summary: "Grounded invitation review" }),
        provider: "fixture",
        model: "fixture",
      };
    });
    const result = await reasonFullMeeting(input(), call, {});
    expect(requests.map((p) => p["stage"])).toEqual([
      "read_every_turn",
      "repair_grounding",
      "reconcile_whole_meeting",
    ]);
    expect(requests[1]?.["turns"]).toEqual(conversation.segments);
    expect(requests[1]?.["validation_issues"]).toEqual([
      expect.objectContaining({ index: 0, exactTurnIds: [1] }),
    ]);
    expect(requests[1]).not.toHaveProperty("retrieval");
    expect(requests[0]).not.toHaveProperty("retrieval");
    expect(requests[0]).not.toHaveProperty("existing_work");
    expect(result.signals[0]?.quote).toBe(conversation.segments[1]!.text);
    expect(requests[2]?.["turns"]).toEqual(conversation.segments);
  });
  it("rejects punctuation changes, fabricated quotes and a still-invalid repair without looping", async () => {
    for (const quote of [
      conversation.segments[1]!.text.replace(/\.$/, ","),
      "Morgan will send a plan template.",
    ]) {
      const call = model([finding({ evidence: [{ index: 1, quote }] })]);
      await expect(reasonFullMeeting(input(), call, {})).rejects.toThrow(
        "unsupported transcript citation",
      );
      expect(call).toHaveBeenCalledTimes(2);
    }
  });
  it("does not accept a citation from a different chunk even when its turn exists globally", async () => {
    const c = {
      ...conversation,
      segments: conversation.segments.map((s) => ({
        ...s,
        text: s.text + " context".repeat(2000),
      })),
    };
    const call = model([
      finding({ evidence: [{ index: 2, quote: c.segments[2]!.text }], due_text: null }),
    ]);
    await expect(reasonFullMeeting(input(c), call, {})).rejects.toThrow(
      "unsupported transcript citation",
    );
    expect(call).toHaveBeenCalledTimes(2);
  });
  it("keeps inferred owners unresolved and reported completion unverified", async () => {
    const run = await reasonFullMeeting(
      input(),
      model([
        finding({ owner_basis: "inferred" }),
        finding({
          disposition: "already_completed",
          meaning: "Dashboard code was reported complete",
          due_text: null,
          evidence: [{ index: 0, quote: conversation.segments[0]!.text }],
        }),
      ]),
      {},
    );
    expect(run.signals[0]?.ownerName).toBeNull();
    expect(run.signals[0]?.ambiguity).toContain("not explicitly assigned");
    expect(run.signals[1]).toMatchObject({
      disposition: "already_completed",
      truthTier: "inferred",
    });
  });
  it("keeps stable confirmation identity and reconciles against existing board work", async () => {
    const args = input();
    args.memory.openCommitments = [
      { id: "board-1", statement: "Invitation QA", ownerName: "Alex", status: "done" },
    ];
    const call = model([finding({ duplicate_of: "board-1" })]);
    const a = await reasonFullMeeting(args, call, {});
    const b = await reasonFullMeeting(args, call, {});
    expect(a.signals[0]?.candidateId).toBe(b.signals[0]?.candidateId);
    expect(a.signals[0]).toMatchObject({ disposition: "duplicate", duplicateOfId: "board-1" });
  });
  it("fails the entire review when a later model call fails", async () => {
    const call = model();
    call
      .mockImplementationOnce(async () => ({
        raw: JSON.stringify({ findings: [finding()], summary: "First pass" }),
        provider: "fixture",
        model: "fixture",
      }))
      .mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(reasonFullMeeting(input(), call, {})).rejects.toThrow("provider unavailable");
  });
  it("changes the durable fingerprint when transcript, date or participant changes", async () => {
    const hash = await transcriptDigest(conversation);
    expect(await transcriptDigest({ ...conversation })).toBe(hash);
    expect(
      await transcriptDigest({
        ...conversation,
        segments: [
          ...conversation.segments,
          { index: 3, speaker: "Alex", at: "00:31:00", text: "Correction: hold that work." },
        ],
      }),
    ).not.toBe(hash);
    expect(await transcriptDigest({ ...conversation, occurredAt: "2026-10-20" })).not.toBe(hash);
  });
  it("anchors precise relative dates but leaves vague and invalid dates unresolved", () => {
    expect(groundedTimeline("tomorrow", conversation.occurredAt)).toMatchObject({
      suggestedDate: "2026-10-20",
      basis: "relative",
    });
    expect(groundedTimeline("afterwards", conversation.occurredAt).suggestedDate).toBeNull();
    expect(groundedTimeline("2026-02-31", conversation.occurredAt).suggestedDate).toBeNull();
    expect(groundedTimeline(null, conversation.occurredAt).basis).toBe("missing");
  });
});
