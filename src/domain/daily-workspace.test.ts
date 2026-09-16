import { describe, expect, it } from "vitest";
import {
  buildWorkspace,
  conductorReply,
  measureDisplay,
  peopleFromMemberships,
  prepareDelegationPolicy,
  routeApproval,
  stewardDisplay,
  WORKSPACE_VERBS,
  WORK_GROUP_ORDER,
  type MembershipRecord,
  type WorkItem,
  type WorkItemDraft,
} from "./daily-workspace";

const ORG = "org-fixture-0000-0000-0000-000000000001";
const NOW = "2026-04-10T09:00:00.000Z";

const memberships: MembershipRecord[] = [
  { userId: "u1", organizationId: ORG, role: "owner", active: true, displayName: "Person One" },
  { userId: "u2", organizationId: ORG, role: "member", active: true, displayName: "Person Two" },
  { userId: "u3", organizationId: ORG, role: "member", active: false, displayName: "Person Three" },
  { userId: "u4", organizationId: "other-org", role: "admin", active: true, displayName: "Elsewhere" },
];

const people = peopleFromMemberships(memberships, ORG);

function item(over: Partial<WorkItemDraft> = {}): WorkItemDraft {
  return {
    id: "w1",
    group: "my_next_actions",
    title: "Reply to Northwind about the plan",
    because: "They asked a question that has not been answered.",
    ownerId: "u1",
    ownerName: "Person One",
    verb: { verb: "Review", href: "/modules/comms/drafts" },
    source: { owningApp: "comms", href: "/modules/comms/drafts", label: "Drafts and reviews" },
    updatedAt: NOW,
    ...over,
  };
}

describe("people", () => {
  it("comes only from active memberships in this workspace", () => {
    expect(people.map((person) => person.userId)).toEqual(["u1", "u2"]);
  });
});

describe("work items", () => {
  it("keeps the same three lists in the same order", () => {
    const { lists } = buildWorkspace({ items: [], people, viewerId: "u1" });
    expect(lists.map((list) => list.group)).toEqual(WORK_GROUP_ORDER);
    expect(lists[0]?.emptyState).toContain("Open a client");
  });

  it("refuses an item with no reason", () => {
    const { rejected } = buildWorkspace({ items: [item({ because: " " })], people, viewerId: "u1" });
    expect(rejected[0]?.because).toContain("No reason");
  });

  it("keeps work whose owner has left, as an exception for a lead to assign", () => {
    const read = buildWorkspace({
      items: [item({ ownerId: "u3", ownerName: "Person Three" })],
      people,
      viewerId: "u1",
      viewerRole: "owner",
    });
    expect(read.rejected).toHaveLength(0);
    expect(read.exceptions[0]?.ownership).toBe("owner_departed");
    // It is nobody's personal work until somebody takes it.
    expect(read.lists[0]?.items).toHaveLength(0);
  });

  it("keeps work nobody owns and never hides the obligation", () => {
    const read = buildWorkspace({
      items: [item({ ownerId: "", ownerName: "" })],
      people,
      viewerId: "u1",
      viewerRole: "admin",
    });
    expect(read.exceptions[0]?.ownership).toBe("unassigned");
    expect(read.exceptions[0]?.ownerName).toBe("Nobody yet");
  });

  it("renames from the membership instead of dropping the work", () => {
    const read = buildWorkspace({
      items: [item({ ownerName: "Old Name" })],
      people,
      viewerId: "u1",
    });
    expect(read.rejected).toHaveLength(0);
    expect(read.lists[0]?.items[0]?.ownerName).toBe("Person One");
  });

  it("refuses an item that opens nowhere, or anywhere outside the app", () => {
    for (const href of ["nowhere", "//evil.example", "/\\evil.example", "/javascript:alert(1)"]) {
      const { rejected } = buildWorkspace({
        items: [item({ verb: { verb: "Review", href } })],
        people,
        viewerId: "u1",
      });
      expect(rejected[0]?.because).toContain("does not open anywhere");
    }
  });

  it("uses only the familiar verbs", () => {
    expect(WORKSPACE_VERBS).toEqual(["Open", "Review", "Edit", "Approve", "Assign", "Done"]);
  });

  it("puts dated work before undated and newest movement first", () => {
    const { lists } = buildWorkspace({
      items: [
        item({ id: "a", updatedAt: "2026-04-09T09:00:00.000Z" }),
        item({ id: "b", updatedAt: "2026-04-10T09:00:00.000Z" }),
        item({ id: "c", dueAt: "2026-04-12T09:00:00.000Z" }),
      ],
      people,
      viewerId: "u1",
    });
    expect(lists[0]?.items.map((row) => row.id)).toEqual(["c", "b", "a"]);
  });

  it("shows another person's actions to them, not to me", () => {
    const { lists } = buildWorkspace({
      items: [item({ id: "mine" }), item({ id: "theirs", ownerId: "u2", ownerName: "Person Two" })],
      people,
      viewerId: "u1",
    });
    expect(lists[0]?.items.map((row) => row.id)).toEqual(["mine"]);
  });

  it("does not show me work prepared for somebody else", () => {
    const prepared = item({
      id: "prep",
      group: "prepared_for_you",
      ownerId: "u2",
      ownerName: "Person Two",
      preparedDetail: "A short read of the conversation.",
    });
    const mine = buildWorkspace({ items: [prepared], people, viewerId: "u1", viewerRole: "owner" });
    expect(mine.lists[1]?.items).toHaveLength(0);

    const theirs = buildWorkspace({ items: [prepared], people, viewerId: "u2" });
    expect(theirs.lists[1]?.items.map((row) => row.id)).toEqual(["prep"]);
  });

  it("gives a lead the team view and refuses it to everybody else", () => {
    const lead = buildWorkspace({
      items: [item({ id: "theirs", ownerId: "u2", ownerName: "Person Two" })],
      people,
      viewerId: "u1",
      viewerRole: "owner",
      view: "team",
    });
    expect(lead.view).toBe("team");
    expect(lead.lists[0]?.items.map((row) => row.id)).toEqual(["theirs"]);

    const member = buildWorkspace({
      items: [item({ id: "theirs", ownerId: "u1", ownerName: "Person One" })],
      people,
      viewerId: "u2",
      viewerRole: "member",
      view: "team",
    });
    expect(member.view).toBe("personal");
    expect(member.viewRefusedBecause).toContain("owner or admin");
    expect(member.exceptions).toHaveLength(0);
  });
});


describe("steward", () => {
  it("does not show a recommendation with no evidence", () => {
    const result = stewardDisplay({
      recommendation: { id: "r1", text: "Chase the plan", evidenceRefs: [], ownerId: "u1" },
      people,
    });
    expect(result.shown).toBe(false);
  });

  it("does not show a recommendation with no current owner", () => {
    const result = stewardDisplay({
      recommendation: { id: "r1", text: "Chase", evidenceRefs: ["fixture:note/1"], ownerId: "u3" },
      people,
    });
    expect(result.shown).toBe(false);
  });

  it("shows evidence and the current owner together", () => {
    const result = stewardDisplay({
      recommendation: { id: "r1", text: "Chase", evidenceRefs: ["fixture:note/1"], ownerId: "u2" },
      people,
    });
    expect(result).toMatchObject({ shown: true, ownerName: "Person Two" });
  });
});

describe("measures", () => {
  it("does not show a figure that was never measured", () => {
    const result = measureDisplay({
      reading: { key: "margin", label: "Margin", value: null, denominator: null, measuredAt: null, unit: "percent" },
      now: NOW,
    });
    expect(result).toMatchObject({ shown: false, because: "Not measured yet." });
  });

  it("does not show a share with no base", () => {
    const result = measureDisplay({
      reading: { key: "win_rate", label: "Win rate", value: 0.4, denominator: null, measuredAt: NOW, unit: "share" },
      now: NOW,
    });
    expect(result.shown).toBe(false);
  });

  it("shows the base and the freshness", () => {
    const result = measureDisplay({
      reading: {
        key: "win_rate",
        label: "Win rate",
        value: 0.4,
        denominator: { of: 10, describes: "proposals sent" },
        measuredAt: "2026-04-01T09:00:00.000Z",
        unit: "share",
      },
      now: NOW,
    });
    expect(result.shown).toBe(true);
    if (result.shown) {
      expect(result.denominatorNote).toContain("Out of 10 proposals sent");
      expect(result.freshnessNote).toContain("out of date");
    }
  });
});

describe("conductor", () => {
  it("gives no answer without a source", () => {
    const reply = conductorReply({
      answer: { text: "Everything is fine", sources: [] },
      prepared: [],
      permittedApps: ["comms"],
    });
    expect(reply.answered).toBe(false);
  });

  it("hands prepared work to the owning room and keeps people in charge", () => {
    const reply = conductorReply({
      answer: { text: "Two drafts are waiting", sources: [{ label: "Drafts", href: "/modules/comms/drafts" }] },
      prepared: [
        { owningApp: "comms", href: "/modules/comms/drafts", summary: "Review the two drafts" },
        { owningApp: "ops", href: "/modules/ops", summary: "Restart something" },
      ],
      permittedApps: ["comms"],
    });
    expect(reply.answered).toBe(true);
    if (reply.answered) {
      expect(reply.prepared).toHaveLength(1);
      expect(reply.prepared[0]?.needsPersonToCarryOut).toBe(true);
    }
  });
});

describe("approvals", () => {
  const policies = [
    { decisionKey: "roadmap.destination", permittedRoles: ["owner" as const], routineForLeads: false },
    { decisionKey: "projects.task_owner", permittedRoles: ["owner" as const, "admin" as const], routineForLeads: true },
  ];

  it("routes nowhere without a recorded policy", () => {
    expect(routeApproval({ decisionKey: "unknown", policies }).routed).toBe(false);
  });

  it("routes only to roles already permitted", () => {
    const routed = routeApproval({ decisionKey: "roadmap.destination", policies });
    expect(routed).toMatchObject({ routed: true, toRoles: ["owner"] });
  });

  it("recognises an existing routine allowance for leads", () => {
    const routed = routeApproval({ decisionKey: "projects.task_owner", policies });
    if (routed.routed) expect(routed.because).toContain("routine decision for a lead");
  });

  it("prepares a delegation that stays switched off", () => {
    const prepared = prepareDelegationPolicy({
      decisionKey: "projects.task_owner",
      proposedRoles: ["member"],
      because: "Leads already assign this work day to day.",
    });
    expect(prepared.prepared).toBe(true);
    if (prepared.prepared) expect(prepared.proposal.enabled).toBe(false);
  });

  it("never prepares a delegation of a Comms approval", () => {
    const prepared = prepareDelegationPolicy({
      decisionKey: "comms.send_approval",
      proposedRoles: ["member"],
      because: "Faster replies",
    });
    expect(prepared.prepared).toBe(false);
  });
});
