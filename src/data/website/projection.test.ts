import { describe, expect, it } from "vitest";

import type { WebsiteEvent, WebsiteSubmission } from "@/domain/website";
import { EMPTY_STRUCTURED } from "@/domain/website";

import {
  formatKnown,
  intakeFunnel,
  modalityUsage,
  sourceToQualified,
  websiteHeadline,
} from "./projection";

function submission(partial: Partial<WebsiteSubmission>): WebsiteSubmission {
  return {
    id: "s1",
    organizationId: "org1",
    submissionId: "sub_1",
    sourceApp: "website",
    sourceChannel: "website",
    sourceType: "roadmap_intake",
    submittedAt: "2026-08-20T09:00:00.000Z",
    receivedAt: "2026-08-20T09:00:01.000Z",
    attribution: { utm: { source: "linkedin", campaign: "founders" } },
    person: {},
    company: {},
    verbatim: [],
    structured: EMPTY_STRUCTURED,
    signals: {},
    consent: {},
    linkState: "linked",
    linkReason: "",
    scoutStatus: "discovered",
    ...partial,
  };
}

function event(partial: Partial<WebsiteEvent>): WebsiteEvent {
  return {
    id: "e1",
    organizationId: "org1",
    eventName: "page_view",
    occurredAt: "2026-08-20T08:00:00.000Z",
    eventKey: "k1",
    utm: {},
    properties: {},
    ...partial,
  };
}

describe("intakeFunnel", () => {
  it("reports unmeasured stages as unknown, never zero", () => {
    const stages = intakeFunnel([], [submission({})]);
    expect(stages[0]!.value).toBeNull();
    expect(formatKnown(stages[0]!.value)).toBe("—");
    expect(stages.find((s) => s.key === "submitted")!.value).toBe(1);
  });

  it("counts submitted and qualified from Core's own rows", () => {
    const stages = intakeFunnel(
      [],
      [submission({ scoutStatus: "ready_for_comms" }), submission({ id: "s2" })],
    );
    expect(stages.find((s) => s.key === "qualified")!.value).toBe(1);
  });

  it("counts sessions once events exist", () => {
    const stages = intakeFunnel(
      [
        event({ eventName: "intake_view", sessionId: "a", eventKey: "k1" }),
        event({ eventName: "intake_view", sessionId: "a", eventKey: "k2" }),
        event({ eventName: "intake_view", sessionId: "b", eventKey: "k3" }),
      ],
      [],
    );
    expect(stages[0]!.value).toBe(2);
  });
});

describe("modalityUsage", () => {
  it("is unknown until answer events arrive", () => {
    expect(modalityUsage([])).toEqual({ text: null, voice: null, resumed: null });
  });

  it("splits text and voice", () => {
    const usage = modalityUsage([
      event({ eventName: "intake_answered", modality: "voice", eventKey: "a" }),
      event({ eventName: "intake_answered", modality: "text", eventKey: "b" }),
      event({ eventName: "intake_resumed", eventKey: "c" }),
    ]);
    expect(usage).toEqual({ text: 1, voice: 1, resumed: 1 });
  });
});

describe("sourceToQualified", () => {
  it("attributes submissions even with no traffic events", () => {
    const rows = sourceToQualified([], [submission({ scoutStatus: "qualified" })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: "linkedin",
      campaign: "founders",
      visits: null,
      starts: null,
      submissions: 1,
      qualified: 1,
    });
  });

  it("never counts an unqualified submission as qualified", () => {
    const rows = sourceToQualified([], [submission({ scoutStatus: "discovered" })]);
    expect(rows[0]!.qualified).toBe(0);
  });
});

describe("websiteHeadline", () => {
  it("keeps sessions unknown and surfaces held submissions", () => {
    const headline = websiteHeadline([], [
      submission({ linkState: "unlinked", scoutProspectId: null }),
      submission({ id: "s2", scoutStatus: "converted" }),
    ]);
    expect(headline).toEqual({ visits: null, submissions: 2, awaitingReview: 1, qualified: 1 });
  });
});
