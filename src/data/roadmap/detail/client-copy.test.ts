import { describe, expect, it } from "vitest";

import { clientCopyBody, clientCopySubject } from "./client-copy";
import type { RoadmapExport } from "@/domain/roadmap-exports";

function exportEntry(overrides: Partial<RoadmapExport> = {}): RoadmapExport {
  return {
    id: "export-1",
    organizationId: "org-1",
    roadmapId: "roadmap-1",
    version: "v1",
    status: "ready",
    createdAt: "2026-01-02T10:00:00.000Z",
    snapshot: {
      company: "Northwind",
      pointA: ["Two founders, no repeatable pipeline"],
      pointB: "A predictable inbound channel",
      pointBProposed: false,
      milestones: [
        {
          ordinal: "01",
          name: "Positioning",
          whatWeBuild: "One clear promise",
          whatItUnlocks: "Every message downstream",
          status: "Ready to start",
        },
      ],
      evidence: [{ label: "Pricing page read 2 Jan", url: "https://example.com/pricing" }],
      frozenAt: "2026-01-02T10:00:00.000Z",
    },
    ...overrides,
  } as RoadmapExport;
}

describe("client copy", () => {
  it("names the company and version in the subject", () => {
    const entry = exportEntry();
    expect(clientCopySubject(entry.snapshot, entry.version)).toBe("Northwind roadmap, version v1");
  });

  it("carries only what the snapshot holds", () => {
    const body = clientCopyBody(exportEntry());
    expect(body).toContain("Two founders, no repeatable pipeline");
    expect(body).toContain("01. Positioning");
    expect(body).toContain("https://example.com/pricing");
  });

  it("labels an unapproved destination as proposed", () => {
    const entry = exportEntry();
    const body = clientCopyBody({
      ...entry,
      snapshot: { ...entry.snapshot, pointBProposed: true },
    });
    expect(body).toContain("Where this could go (proposed)");
  });
});
