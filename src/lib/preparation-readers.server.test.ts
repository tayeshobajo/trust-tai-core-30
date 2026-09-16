/**
 * The adapters between the rooms' own tables and the runner.
 *
 * A small fake workspace stands behind them: it answers the same filters the
 * real database would, and refuses anything the caller should not see, so the
 * tests are about the reading rules rather than about Postgres.
 */

import { afterEach, describe, expect, it } from "vitest";

import type { PreparationRequest } from "@/domain/preparation-jobs";
import {
  conversationReader,
  enquiryReader,
  milestoneReader,
  setCallerClientFactory,
  SubjectUnreadable,
} from "@/lib/preparation-readers.server";

type Row = Record<string, unknown>;

/** A fake table set that honours eq filters, ordering and limits. */
function fakeWorkspace(tables: Record<string, Row[]>, broken: string[] = []) {
  function query(table: string) {
    let rows = [...(tables[table] ?? [])];
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        rows = rows.filter((row) => row[column] === value);
        return builder;
      },
      order: (column: string, options?: { ascending?: boolean }) => {
        rows.sort((a, b) =>
          String(a[column] ?? "").localeCompare(String(b[column] ?? "")) *
          (options?.ascending === false ? -1 : 1),
        );
        return builder;
      },
      limit: (count: number) => {
        rows = rows.slice(0, count);
        return builder;
      },
      maybeSingle: async () =>
        broken.includes(table)
          ? { data: null, error: { message: `relation "${table}" does not exist` } }
          : { data: rows[0] ?? null, error: null },
      then: (resolve: (value: unknown) => unknown) =>
        resolve(
          broken.includes(table)
            ? { data: null, error: { message: `relation "${table}" does not exist` } }
            : { data: rows, error: null },
        ),
    };
    return builder;
  }
  return { from: (table: string) => query(table) } as never;
}

function request(overrides: Partial<PreparationRequest>): PreparationRequest {
  return {
    organizationId: "org-1",
    jobId: "conversation_summary",
    subjectRef: "subject-1",
    inputRevision: "rev-1",
    ...overrides,
  };
}

afterEach(() => setCallerClientFactory(null));

describe("the enquiry adapter", () => {
  const submission: Row = {
    id: "row-1",
    organization_id: "org-1",
    submission_id: "ws-001",
    source_channel: "website",
    received_at: "2026-09-16T09:00:00.000Z",
    link_state: "unlinked",
    processing_state: "held",
    person: { email: "" },
    company: { name: "Northwind Fixture Ltd", website: "" },
    consent: { marketing_opt_in: null },
    verbatim: [{ answer_text: "We need the whole site rebuilt before spring." }],
  };
  const enquiry = request({ jobId: "enquiry_qualification_packet", subjectRef: "ws-001" });

  it("reads a workspace's own enquiry and refuses another workspace's", async () => {
    setCallerClientFactory(() => fakeWorkspace({ website_intake_submissions: [submission] }));
    expect(await enquiryReader.belongsToWorkspace(enquiry, "token")).toBe(true);
    expect(
      await enquiryReader.belongsToWorkspace(
        { ...enquiry, organizationId: "org-someone-else" },
        "token",
      ),
    ).toBe(false);
  });

  it("moves the revision when the enquiry moves", async () => {
    setCallerClientFactory(() => fakeWorkspace({ website_intake_submissions: [submission] }));
    const before = await enquiryReader.currentRevision(enquiry, "token");
    setCallerClientFactory(() =>
      fakeWorkspace({
        website_intake_submissions: [{ ...submission, link_state: "linked", processing_state: "routed" }],
      }),
    );
    expect(await enquiryReader.currentRevision(enquiry, "token")).not.toBe(before);
  });

  it("counts what they said, names what is unknown and refuses to claim fit without an ICP", async () => {
    setCallerClientFactory(() =>
      fakeWorkspace({ website_intake_submissions: [submission], icp_profiles: [] }),
    );
    const read = await enquiryReader.read(enquiry, "token");
    expect(read.figures["answersGiven"]).toBe(1);
    expect(read.figures["icpCriteria"]).toBe(0);
    expect(read.figures["unknownsAtIntake"]).toBe(4);
    expect(read.material[0]?.text).toContain("There is no ICP recorded. Do not claim fit.");
    expect(read.needsDecisionBecause).toContain("which company this enquiry belongs to");
  });

  it("says a source it cannot read is unreadable, never empty", async () => {
    setCallerClientFactory(() => fakeWorkspace({}, ["website_intake_submissions"]));
    await expect(enquiryReader.read(enquiry, "token")).rejects.toBeInstanceOf(SubjectUnreadable);
  });
});

describe("the conversation adapter", () => {
  const relationship: Row = { id: "rel-1", organization_id: "org-1", owner_label: "Priya" };
  const messages: Row[] = [
    {
      id: "msg-1",
      organization_id: "org-1",
      relationship_id: "rel-1",
      direction: "inbound",
      subject: "Phase one",
      snippet: "What does a first phase involve?",
      occurred_at: "2026-09-15T10:00:00.000Z",
    },
  ];
  const conversation = request({ subjectRef: "rel-1" });

  it("reads this client's own messages and names the owner from the record", async () => {
    setCallerClientFactory(() =>
      fakeWorkspace({ comms_relationships: [relationship], comms_messages: messages }),
    );
    const read = await conversationReader.read(conversation, "token");
    expect(read.ownerLabel).toBe("Priya");
    expect(read.figures["sourcesRead"]).toBe(1);
    expect(read.evidenceRefs).toEqual(["comms_message:msg-1"]);
  });

  it("moves the revision when a message arrives", async () => {
    setCallerClientFactory(() =>
      fakeWorkspace({ comms_relationships: [relationship], comms_messages: messages }),
    );
    const before = await conversationReader.currentRevision(conversation, "token");
    setCallerClientFactory(() =>
      fakeWorkspace({
        comms_relationships: [relationship],
        comms_messages: [
          ...messages,
          { ...messages[0], id: "msg-2", occurred_at: "2026-09-16T08:00:00.000Z" },
        ],
      }),
    );
    expect(await conversationReader.currentRevision(conversation, "token")).not.toBe(before);
  });

  it("refuses to prepare from a conversation with nothing recorded", async () => {
    setCallerClientFactory(() =>
      fakeWorkspace({ comms_relationships: [relationship], comms_messages: [] }),
    );
    const read = await conversationReader.read(conversation, "token");
    expect(read.cannotPrepareBecause).toContain("nothing recorded");
    expect(read.material).toHaveLength(0);
  });
});

describe("the milestone adapter", () => {
  const milestone: Row = {
    id: "ms-1",
    organization_id: "org-1",
    name: "Intake tidy-up",
    status: "in_progress",
    updated_at: "2026-09-16T09:00:00.000Z",
  };
  const criteria: Row[] = [
    { id: "c-1", organization_id: "org-1", milestone_id: "ms-1", label: "Form live", met: true },
    { id: "c-2", organization_id: "org-1", milestone_id: "ms-1", label: "Routing checked", met: null },
  ];
  const change = request({ jobId: "milestone_status_draft", subjectRef: "ms-1" });

  it("counts measures and keeps an unrecorded one unknown, never met or failed", async () => {
    setCallerClientFactory(() =>
      fakeWorkspace({ roadmap_milestones: [milestone], roadmap_milestone_criteria: criteria }),
    );
    const read = await milestoneReader.read(change, "token");
    expect(read.figures).toMatchObject({
      successMeasures: 2,
      measuresMet: 1,
      measuresNotMet: 0,
      measuresUnknown: 1,
    });
    expect(read.needsDecisionBecause).toContain("Nobody has accepted this milestone yet");
  });

  it("moves the revision when the milestone moves", async () => {
    setCallerClientFactory(() =>
      fakeWorkspace({ roadmap_milestones: [milestone], roadmap_milestone_criteria: criteria }),
    );
    const before = await milestoneReader.currentRevision(change, "token");
    setCallerClientFactory(() =>
      fakeWorkspace({
        roadmap_milestones: [{ ...milestone, status: "accepted", updated_at: "2026-09-16T11:00:00.000Z" }],
        roadmap_milestone_criteria: criteria,
      }),
    );
    expect(await milestoneReader.currentRevision(change, "token")).not.toBe(before);
  });
});
