import { describe, expect, it } from "vitest";

import type { Relationship, Touch } from "@/domain/comms";
import type { ConversationHealth, RelationshipStrengthRead } from "@/domain/comms-health";
import { retractedProvenance } from "@/domain/comms-touch-record";

import type { NextRelationshipMove } from "./comms-next-move";
import {
  relationshipSummaryHtml,
  relationshipSummarySections,
  relationshipSummaryText,
  summaryFileName,
} from "./comms-summary";

const relationship: Relationship = {
  id: "rel-1",
  organizationId: "org-1",
  fullName: "Mara Whitlock",
  companyName: "Northlight Systems",
  email: "mara@northlight.test",
  stage: "warm",
  metWhere: "Founders dinner",
  lastTouchAt: "2026-02-01T10:00:00.000Z",
  decided: [
    {
      id: "m1",
      label: "Worth remembering",
      value: "Prefers a short call over email",
      tier: "decided",
      at: "2026-01-10T10:00:00.000Z",
      addedBy: "Tai",
    },
  ],
  observed: [
    {
      id: "m2",
      label: "Promise",
      value: "Send the delivery outline",
      tier: "observed",
      at: "2026-01-20T10:00:00.000Z",
      category: "commitment",
      metadata: { owner: "us", due: "2026-02-10T10:00:00.000Z", status: "open" },
    },
  ],
  inferred: [],
  createdAt: "2026-01-01T10:00:00.000Z",
  updatedAt: "2026-02-01T10:00:00.000Z",
} as unknown as Relationship;

const health: ConversationHealth = {
  status: "needs_attention",
  reasons: ["Nothing has been said for 21 days."],
} as ConversationHealth;

const strength: RelationshipStrengthRead = {
  band: "warm",
  score: 58,
  factors: [{ label: "Interactions", value: "6 recorded" }],
} as unknown as RelationshipStrengthRead;

const move: NextRelationshipMove = {
  needed: true,
  action: "Send the delivery outline you promised",
  whyNow: "It was promised on 20 January and is still open.",
  goal: "Keep the promise visible and answered.",
  urgency: "this_week",
} as unknown as NextRelationshipMove;

const touches: Touch[] = [
  {
    id: "t1",
    organizationId: "org-1",
    relationshipId: "rel-1",
    channel: "call",
    direction: "outbound",
    occurredAt: "2026-01-20T10:00:00.000Z",
    summary: "Talked through the pilot",
  },
  {
    id: "t2",
    organizationId: "org-1",
    relationshipId: "rel-1",
    channel: "email",
    direction: "inbound",
    occurredAt: "2026-01-05T10:00:00.000Z",
    summary: "Asked about timelines",
    provenance: retractedProvenance(undefined, { at: "2026-01-06T10:00:00.000Z" }),
  },
] as unknown as Touch[];

const input = { relationship, health, strength, move, touches, exportedBy: "Tai" };

describe("relationship summary", () => {
  it("says who this is, what is remembered, and what was promised", () => {
    const sections = relationshipSummarySections(input);
    const headings = sections.map((section) => section.heading);
    expect(headings).toContain("Who this is");
    expect(headings).toContain("What we know");
    expect(headings).toContain("Promises and commitments");
    expect(headings).toContain("Next relationship move");

    const memory = sections.find((s) => s.heading === "What we know")!;
    expect(memory.lines.join(" ")).toContain("Prefers a short call");

    const promises = sections.find((s) => s.heading === "Promises and commitments")!;
    expect(promises.lines.join(" ")).toContain("Send the delivery outline");
  });

  it("keeps a promise out of the plain memory list so nothing reads twice", () => {
    const memory = relationshipSummarySections(input).find(
      (section) => section.heading === "What we know",
    )!;
    expect(memory.lines.join(" ")).not.toContain("Send the delivery outline");
  });

  it("carries the reason for the next move, not just the move", () => {
    const next = relationshipSummarySections(input).find(
      (section) => section.heading === "Next relationship move",
    )!;
    expect(next.lines.join(" ")).toContain("still open");
  });

  it("marks a retracted interaction rather than hiding it", () => {
    const recent = relationshipSummarySections(input).find(
      (section) => section.heading === "Recent interactions",
    )!;
    expect(recent.lines.join(" ")).toContain("[retracted]");
  });

  it("renders copyable text and printable html without leaking markup", () => {
    const text = relationshipSummaryText(input);
    expect(text).toContain("Mara Whitlock");
    expect(text).toContain("PROMISES AND COMMITMENTS");

    const html = relationshipSummaryHtml({
      ...input,
      relationship: { ...relationship, fullName: "Mara <script>" },
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("names the file after the person and the day", () => {
    expect(summaryFileName(relationship, new Date("2026-02-01T00:00:00.000Z"))).toBe(
      "mara-whitlock-summary-2026-02-01",
    );
  });
});
