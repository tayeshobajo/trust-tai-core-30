import { describe, expect, it } from "vitest";

import { clientContextPacket, PACKET_BOUNDARIES } from "./client-context-packet";
import { answered, unreadable } from "./client-shell";
import type { ExecutionProject } from "./projects";

const project = {
  id: "p1",
  name: "Mental Dental Academy",
  state: "in_flight",
  nextMove: "Send the draft",
  lastMovedAt: "2026-09-01T00:00:00.000Z",
} as unknown as ExecutionProject;

const base = {
  identity: { clientId: "c1", name: "Mental Dental", websiteUrl: "https://mentaldental.com" },
  commercial: {
    headline: "Run · $3,500/mo",
    review: "Review due 15 Sep",
    renewal: "Renews 1 Aug",
    provenance: "Last recorded 2026-08-01 by Tai.",
  },
  projects: answered([project]),
  relationship: answered({
    people: [
      {
        id: "r1",
        fullName: "Fiona Reid",
        stageLabel: "Client",
        lastTouchAt: "2026-09-02T00:00:00.000Z",
        nextAction: "Send the recap",
        overdue: true,
      },
    ],
    lead: null,
    lastTouchAt: "2026-09-02T00:00:00.000Z",
    overdue: 1,
  }),
  roadmap: answered([]),
  sources: answered([]),
  history: answered([]),
  attention: [{ key: "review", line: "Review overdue", because: "Owned by Clients" }],
};

describe("clientContextPacket", () => {
  it("composes account truth and nothing else", () => {
    const packet = clientContextPacket(base);
    expect(packet.client.name).toBe("Mental Dental");
    expect(packet.projects).toEqual([
      {
        id: "p1",
        name: "Mental Dental Academy",
        state: expect.any(String),
        open: expect.any(Boolean),
        nextMove: "Send the draft",
      },
    ]);
    expect((packet.people as string[])[0]).toContain("Fiona Reid");
    expect(packet.attention[0]).toContain("Review overdue");
  });

  it("carries no raw message text anywhere in the packet", () => {
    const serialized = JSON.stringify(clientContextPacket(base));
    expect(serialized).not.toContain("message_body");
    expect(serialized).not.toContain("bodyText");
  });

  it("says a room could not be read instead of showing an absence", () => {
    const packet = clientContextPacket({
      ...base,
      relationship: unreadable("Comms did not answer."),
    });
    expect(packet.people).toEqual({ unreadable: "Comms did not answer." });
  });

  it("marks a room that has not answered yet as not read", () => {
    const packet = clientContextPacket({ ...base, history: null });
    expect(packet.recentActivity).toEqual({ unreadable: "Not read yet." });
  });

  it("states its own boundaries so an answer never claims it can act", () => {
    expect(clientContextPacket(base).boundaries).toEqual(PACKET_BOUNDARIES);
  });
});
