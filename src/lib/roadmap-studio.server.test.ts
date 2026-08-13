/**
 * Studio composition, server side.
 *
 * The three things that must never slip: nothing composes without workspace
 * access, nothing composes without a configured provider, and nothing is saved
 * when the model asserted a fact the approved packet cannot back. A voice
 * problem is an edit. A fabricated figure is a refusal.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RoadmapMilestone, RoadmapStrategy, StrategyItem } from "@/domain/roadmap-intel";

const access = vi.fn(async () => true);
const provider = vi.fn(async () => ({ raw: "{}", provider: "openai", model: "gpt-5-mini" }));

vi.mock("./roadmap-research.server", () => ({
  requireRoadmapAccess: (...args: unknown[]) => access(...(args as [])),
  callRoadmapProvider: (...args: unknown[]) => provider(...(args as [])),
}));

const { runStudioComposition } = await import("./roadmap-studio.server");

const CHECKED = "2026-01-05T00:00:00.000Z";
const source = { label: "About", url: "https://acme.com/about", checkedAt: CHECKED };

function item(overrides: Partial<StrategyItem> = {}): StrategyItem {
  return {
    key: "k",
    statement: "They serve regional operators.",
    because: "Stated on their own site.",
    tier: "decided",
    confidence: "high",
    sources: [source],
    approval: "approved",
    ...overrides,
  };
}

function strategy(overrides: Partial<RoadmapStrategy> = {}): RoadmapStrategy {
  return {
    id: "s1",
    organizationId: "org",
    roadmapId: "r1",
    pointA: [item({ key: "a" })],
    anchorProof: [item({ key: "anchor", statement: "Twelve years of field crews." })],
    horizon: [],
    pointB: item({ key: "b", statement: "Own the intake experience." }),
    pointC: null,
    centralTruth: item({ key: "truth", statement: "The work is trusted, the front door is not." }),
    gaps: [item({ key: "gap", statement: "No competitor publishes real availability." })],
    leveragePoint: null,
    createdAt: CHECKED,
    updatedAt: CHECKED,
    ...overrides,
  };
}

const MILESTONES: RoadmapMilestone[] = [];

async function run(input?: { strategy?: RoadmapStrategy | null }) {
  const stages = [];
  for await (const stage of runStudioComposition({
    token: "t",
    organizationId: "org",
    kind: "preview",
    subjectLabel: "Acme",
    strategy: input?.strategy === undefined ? strategy() : input.strategy,
    milestones: MILESTONES,
  })) {
    stages.push(stage);
  }
  return stages;
}

function composed(sections: unknown) {
  return JSON.stringify({ sections });
}

beforeEach(() => {
  access.mockReset().mockResolvedValue(true);
  provider.mockReset().mockResolvedValue({
    raw: composed([
      {
        key: "point-a",
        title: "Point A: current position",
        body: ["The work is trusted, the front door is not."],
        sources: [{ label: "About", url: source.url, checked_at: CHECKED }],
      },
    ]),
    provider: "openai",
    model: "gpt-5-mini",
  });
});

describe("runStudioComposition", () => {
  it("stops before the model when the caller is not in the workspace", async () => {
    access.mockResolvedValue(false);
    const stages = await run();
    expect(stages.at(-1)?.stage).toBe("error");
    expect(provider).not.toHaveBeenCalled();
  });

  it("stops before the model when the packet is not ready", async () => {
    const stages = await run({ strategy: null });
    expect(stages.at(-1)?.stage).toBe("error");
    expect(stages.at(-1)?.message).toContain("not ready");
    expect(provider).not.toHaveBeenCalled();
  });

  it("fails closed and truthfully when no provider is configured", async () => {
    provider.mockRejectedValue(new Error("No intelligence provider is configured"));
    const stages = await run();
    expect(stages.at(-1)?.stage).toBe("error");
    expect(stages.at(-1)?.message).toContain("No intelligence provider is configured");
  });

  it("never sends anything the packet did not approve", async () => {
    await run({
      strategy: strategy({ gaps: [item({ key: "gap", statement: "Deferred idea", approval: "deferred" })] }),
    });
    // Not ready without an approved gap, so the model is never called at all.
    expect(provider).not.toHaveBeenCalled();
  });

  it("only ships approved evidence in the prompt", async () => {
    await run({
      strategy: strategy({
        pointA: [
          item({ key: "a", statement: "Approved fact." }),
          item({ key: "a2", statement: "Rejected idea.", approval: "rejected" }),
        ],
      }),
    });
    const sent = String(provider.mock.calls[0]?.[1] ?? "");
    expect(sent).toContain("Approved fact.");
    expect(sent).not.toContain("Rejected idea.");
  });

  it("saves nothing when the model invents a figure", async () => {
    provider.mockResolvedValue({
      raw: composed([
        {
          key: "point-a",
          title: "Point A",
          body: ["They grew 42% last year."],
          sources: [{ label: "About", url: source.url, checked_at: CHECKED }],
        },
      ]),
      provider: "openai",
      model: "gpt-5-mini",
    });
    const last = (await run()).at(-1);
    expect(last?.stage).toBe("error");
    expect(last?.message).toContain("does not support");
  });

  it("saves nothing when the model cites a source the packet never had", async () => {
    provider.mockResolvedValue({
      raw: composed([
        {
          key: "point-a",
          title: "Point A",
          body: ["The front door is the constraint."],
          sources: [{ label: "Elsewhere", url: "https://elsewhere.example", checked_at: CHECKED }],
        },
      ]),
      provider: "openai",
      model: "gpt-5-mini",
    });
    expect((await run()).at(-1)?.stage).toBe("error");
  });

  it("completes with the provider recorded when every line is backed", async () => {
    const last = (await run()).at(-1);
    expect(last?.stage).toBe("complete");
    const data = last?.data as { provider: string; model: string; sections: unknown[] };
    expect(data.provider).toBe("openai");
    expect(data.model).toBe("gpt-5-mini");
    expect(data.sections).toHaveLength(1);
  });

  it("keeps the run server side and web search off", async () => {
    await run();
    const options = provider.mock.calls[0]?.[2] as { webSearch: boolean };
    expect(options.webSearch).toBe(false);
  });
});
