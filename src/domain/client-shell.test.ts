import { describe, expect, it } from "vitest";

import type { ApprovalRequest } from "./approvals";
import { deriveClientCard } from "./clients-book";
import {
  approvalEntityIds,
  approvalsForClient,
  CLIENT_TABS,
  clientHeaderFacts,
  currentStage,
  lastTouchLine,
  parseClientTab,
  projectsForClient,
  relationshipSnapshotFor,
  siteHost,
  siteSubmissionsFor,
  reviewCadenceFor,
  roadmapForClient,
  roadmapOutcomeFor,
} from "./client-shell";
import type { Relationship } from "./comms";
import type { ExecutionProject } from "./projects";
import type { Roadmap, RoadmapStage } from "./roadmap";

/* Noon UTC on 3 September 2026 is 07:00 in Chicago, the same calendar day. */
const NOW = new Date("2026-09-03T12:00:00.000Z");
const CHICAGO = "America/Chicago";

function roadmap(overrides: Partial<Roadmap> = {}): Roadmap {
  return {
    id: overrides.id ?? "rm-1",
    organizationId: "org",
    clientId: "client-1",
    title: "Northlight, next 90 days",
    subjectLabel: "Northlight Systems",
    objective: "Ship the booking flow",
    status: "in_progress",
    pointA: [],
    pointB: {
      statement: "Bookings taken online without a phone call",
      tier: "inferred",
      because: "",
      evidence: [],
    },
    nextMove: { action: "Confirm the scope of phase two", because: "", tier: "decided" },
    metadata: {},
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

function stage(overrides: Partial<RoadmapStage>): RoadmapStage {
  return {
    id: overrides.id ?? "st",
    organizationId: "org",
    roadmapId: "rm-1",
    position: 0,
    title: "Stage",
    state: "mapped",
    tier: "decided",
    evidence: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function project(overrides: Partial<ExecutionProject>): ExecutionProject {
  return {
    id: overrides.id ?? "p",
    organizationId: "org",
    name: "Booking flow",
    state: "in_flight",
    clientId: "client-1",
    pointA: "",
    pointB: "",
    evidence: [],
    dependencies: [],
    origin: { kind: "manual" } as ExecutionProject["origin"],
    lastMovedAt: "2026-08-20T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

function relationship(overrides: Partial<Relationship>): Relationship {
  return {
    id: overrides.id ?? "r",
    organizationId: "org",
    clientId: "client-1",
    fullName: "Dana Okafor",
    stage: "client",
    source: "manual" as Relationship["source"],
    observed: [],
    inferred: [],
    decided: [],
    metadata: {},
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

function approval(overrides: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    id: overrides.id ?? "apr",
    organizationId: "org",
    sourceApp: "roadmap",
    category: "strategy" as ApprovalRequest["category"],
    approvalType: "roadmap_change" as ApprovalRequest["approvalType"],
    title: "Approve phase two",
    summary: "",
    whyItNeedsYou: "",
    status: "needs_review",
    urgency: "soon" as ApprovalRequest["urgency"],
    impact: "medium" as ApprovalRequest["impact"],
    sourceEntity: { type: "roadmap", id: "rm-1" },
    submittedBy: { type: "user", id: "u", label: "Tai" },
    sourceKey: "k",
    requiredCapability: "roadmap.write",
    boundary: { willDo: [], willNotDo: [] },
    evidence: [],
    payload: {},
    revision: 1,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("the client shell has exactly six tabs, in order", () => {
  it("names Overview, Projects, Relationship, Commercial, Files, Chat", () => {
    expect(CLIENT_TABS).toEqual([
      "overview",
      "work",
      "relationship",
      "commercial",
      "files",
      "chat",
    ]);
  });

  it("opens Overview for anything it does not recognise, including the old tabs", () => {
    expect(parseClientTab("commercial")).toBe("commercial");
    expect(parseClientTab("roadmap")).toBe("overview");
    expect(parseClientTab("site")).toBe("overview");
    expect(parseClientTab("billing")).toBe("overview");
    expect(parseClientTab(undefined)).toBe("overview");
  });
});


describe("the header states only what is recorded, in the organization's day", () => {
  it("shows Sep 19 as Sep 19 in Chicago and names a missing renewal plainly", () => {
    const card = deriveClientCard(
      {
        id: "client-1",
        name: "Northlight Systems",
        tier: "run",
        mrrCents: 350_000,
        renewalAt: null,
        nextReviewAt: "2026-09-19T05:00:00.000Z",
      },
      NOW,
      CHICAGO,
    );
    const facts = clientHeaderFacts(card, NOW, CHICAGO);
    expect(facts.tierAndValue).toBe("Run · $3,500/mo");
    expect(facts.nextReview).toBe("Next review Sep 19");
    expect(facts.renewal).toBe("No renewal date recorded");
    expect(facts.reviewOverdue).toBe(false);
  });

  it("calls a review overdue only once its own day has passed", () => {
    const today = reviewCadenceFor(
      { nextReviewAt: "2026-09-03T05:00:00.000Z", renewalAt: null },
      NOW,
      CHICAGO,
    );
    expect(today.state).toBe("due");
    expect(today.line).toBe("Review due today");

    const late = reviewCadenceFor(
      { nextReviewAt: "2026-08-20T05:00:00.000Z", renewalAt: "2026-10-03T05:00:00.000Z" },
      NOW,
      CHICAGO,
    );
    expect(late.state).toBe("overdue");
    expect(late.line).toBe("Review overdue since Aug 20");
    expect(late.renewalLine).toBe("Renews Oct 3");
  });
});

describe("Roadmap speaks in its own words", () => {
  it("prefers the active roadmap moved most recently", () => {
    const chosen = roadmapForClient(
      [
        roadmap({ id: "old", status: "complete", updatedAt: "2026-09-01T00:00:00.000Z" }),
        roadmap({ id: "live", updatedAt: "2026-08-15T00:00:00.000Z" }),
        roadmap({ id: "other", clientId: "client-2", updatedAt: "2026-09-02T00:00:00.000Z" }),
      ],
      "client-1",
    );
    expect(chosen?.id).toBe("live");
  });

  it("names the blocked stage before anything in build, and counts open decisions", () => {
    const stages = [
      stage({ id: "a", position: 0, title: "Discovery", state: "live" }),
      stage({ id: "b", position: 1, title: "Booking flow", state: "in_build" }),
      stage({ id: "c", position: 2, title: "Payments", state: "blocked" }),
    ];
    expect(currentStage(stages)?.title).toBe("Payments");
    const outcome = roadmapOutcomeFor(roadmap(), stages, [
      { roadmapId: "rm-1" } as never,
      { roadmapId: "rm-9" } as never,
    ]);
    expect(outcome.destination).toBe("Bookings taken online without a phone call");
    expect(outcome.destinationTier).toBe("inferred");
    expect(outcome.milestone).toBe("Payments");
    expect(outcome.milestoneBlocked).toBe(true);
    expect(outcome.openDecisions).toBe(1);
    expect(outcome.stagesLive).toBe(1);
    expect(outcome.stagesTotal).toBe(3);
  });
});

describe("Projects and Comms are read, never re-stated", () => {
  it("puts blocked delivery first, then what moved last", () => {
    const ordered = projectsForClient(
      [
        project({ id: "quiet", lastMovedAt: "2026-08-01T00:00:00.000Z" }),
        project({
          id: "blocked",
          state: "blocked",
          blockedBecause: "Waiting on copy",
          lastMovedAt: "2026-07-01T00:00:00.000Z",
        }),
        project({ id: "fresh", lastMovedAt: "2026-09-01T00:00:00.000Z" }),
        project({ id: "elsewhere", clientId: "client-2" }),
      ],
      "client-1",
    );
    expect(ordered.map((entry) => entry.id)).toEqual(["blocked", "fresh", "quiet"]);
  });

  it("leads with the person touched most recently and counts overdue follow-ups", () => {
    const snapshot = relationshipSnapshotFor(
      [
        relationship({ id: "a", fullName: "Dana Okafor", lastTouchAt: "2026-08-30T00:00:00.000Z" }),
        relationship({
          id: "b",
          fullName: "Sam Reyes",
          lastTouchAt: "2026-08-10T00:00:00.000Z",
          followUpDueAt: "2026-08-25T05:00:00.000Z",
        }),
        relationship({ id: "c", clientId: "client-2" }),
      ],
      "client-1",
      NOW,
      CHICAGO,
    );
    expect(snapshot.people.map((person) => person.id)).toEqual(["b", "a"]);
    expect(snapshot.lead?.id).toBe("a");
    expect(snapshot.overdue).toBe(1);
    expect(lastTouchLine(snapshot.lastTouchAt, NOW, CHICAGO)).toBe("Last touch Aug 29");
    expect(lastTouchLine(null, NOW, CHICAGO)).toBe("No touch recorded");
  });
});

describe("Approvals are matched on canonical ids only", () => {
  const links = {
    clientId: "client-1",
    roadmapIds: ["rm-1"],
    projectIds: ["p-1"],
    relationshipIds: ["r-1"],
  };

  it("claims decisions filed under this client's roadmaps, projects and people", () => {
    const mine = approvalsForClient(
      [
        approval({ id: "roadmap", sourceEntity: { type: "roadmap", id: "rm-1" } }),
        approval({ id: "project", sourceEntity: { type: "project", id: "p-1" } }),
        approval({ id: "person", sourceEntity: { type: "comms_relationship", id: "r-1" } }),
        approval({ id: "someone-else", sourceEntity: { type: "roadmap", id: "rm-2" } }),
        approval({
          id: "named-alike",
          sourceEntity: { type: "prospect", id: "pr-1" },
          title: "Northlight Systems",
        }),
      ],
      links,
    );
    expect(mine.map((request) => request.id)).toEqual(["roadmap", "project", "person"]);
  });

  it("asks the ledger only about ids it can ground", () => {
    expect(approvalEntityIds(links).sort()).toEqual(["client-1", "p-1", "r-1", "rm-1"]);
  });
});

describe("site matching", () => {
  const sub = (website: string | null, name: string | null, submittedAt: string) => ({
    submittedAt,
    company: { website, name },
  });

  it("matches on the same host, ignoring www and scheme", () => {
    const matched = siteSubmissionsFor(
      [sub("https://www.northlight.io/contact", null, "2026-01-02T00:00:00.000Z")],
      { name: "Northlight Systems", websiteUrl: "northlight.io" },
    );
    expect(matched).toHaveLength(1);
  });

  it("matches on the exact company name when no address was recorded", () => {
    const matched = siteSubmissionsFor(
      [sub(null, "northlight systems", "2026-01-02T00:00:00.000Z")],
      {
        name: "Northlight Systems",
        websiteUrl: null,
      },
    );
    expect(matched).toHaveLength(1);
  });

  it("never matches on resemblance", () => {
    const matched = siteSubmissionsFor(
      [sub("https://northlight.co", "Northlight", "2026-01-02T00:00:00.000Z")],
      {
        name: "Northlight Systems",
        websiteUrl: "https://northlight.io",
      },
    );
    expect(matched).toHaveLength(0);
  });

  it("returns the newest submission first", () => {
    const matched = siteSubmissionsFor(
      [
        sub("northlight.io", null, "2026-01-02T00:00:00.000Z"),
        sub("northlight.io", null, "2026-03-02T00:00:00.000Z"),
      ],
      { name: "Northlight Systems", websiteUrl: "northlight.io" },
    );
    expect(matched[0]?.submittedAt).toBe("2026-03-02T00:00:00.000Z");
  });

  it("reads no host from an empty address", () => {
    expect(siteHost(null)).toBeNull();
    expect(siteHost("   ")).toBeNull();
  });
});
