import { describe, expect, it } from "vitest";

import {
  draftSeedFrom,
  entriesFromDrafts,
  entriesFromMessages,
  historyCounts,
  inHistoryFilter,
  matchesHistoryQuery,
  peopleById,
  sortHistory,
  type HistoryDraft,
} from "./comms-history";
import type { Relationship } from "./comms";
import type { StoredMailboxMessage } from "./comms-integrations";

const person = {
  id: "rel-1",
  organizationId: "org-1",
  fullName: "Robin Shah",
  companyName: "Thyme Care",
  email: "robin@thymecare.com",
  stage: "engaged",
  source: "manual",
  observed: [],
  inferred: [],
  decided: [],
  metadata: {},
  createdAt: "2026-09-01T00:00:00.000Z",
} as unknown as Relationship;

const outbound: StoredMailboxMessage = {
  id: "m-1",
  organizationId: "org-1",
  relationshipId: "rel-1",
  direction: "outbound",
  subject: "Kickoff timing",
  snippet: "Sharing two windows next week.",
  occurredAt: "2026-09-19T09:00:00.000Z",
  sentViaComms: true,
};

const inbound: StoredMailboxMessage = {
  id: "m-2",
  organizationId: "org-1",
  relationshipId: "rel-1",
  direction: "inbound",
  subject: "Re: Kickoff timing",
  bodyText: "Tuesday works for us.",
  fromEmail: "robin@thymecare.com",
  occurredAt: "2026-09-20T09:00:00.000Z",
};

const drafts: HistoryDraft[] = [
  {
    id: "d-1",
    relationshipId: "rel-1",
    subject: "Proposal",
    body: "The scope we discussed.",
    reviewState: "sent",
    createdAt: "2026-09-18T09:00:00.000Z",
  },
  {
    id: "d-2",
    relationshipId: "rel-1",
    subject: "Attempted note",
    body: "Never left.",
    reviewState: "send_failed",
    createdAt: "2026-09-17T09:00:00.000Z",
  },
  {
    id: "d-3",
    relationshipId: "rel-1",
    subject: "Still waiting on a review",
    body: "Not sent.",
    reviewState: "needs_human_review",
    createdAt: "2026-09-16T09:00:00.000Z",
  },
];

const people = peopleById([person]);

describe("comms history", () => {
  it("reads an outbound message as sent and an inbound one as a reply", () => {
    const entries = entriesFromMessages([outbound, inbound], people);
    expect(entries[0]?.kind).toBe("sent");
    expect(entries[0]?.channelLabel).toBe("Email, sent from Comms");
    expect(entries[1]?.kind).toBe("reply");
    expect(entries[1]?.personName).toBe("Robin Shah");
  });

  it("keeps only drafts whose review ended in a send, failures included", () => {
    const entries = entriesFromDrafts(drafts, people);
    expect(entries.map((entry) => entry.kind)).toEqual(["sent_draft", "failed_draft"]);
  });

  it("orders everything newest first", () => {
    const entries = sortHistory([
      ...entriesFromMessages([outbound, inbound], people),
      ...entriesFromDrafts(drafts, people),
    ]);
    expect(entries.map((entry) => entry.id)).toEqual([
      "message:m-2",
      "message:m-1",
      "draft:d-1",
      "draft:d-2",
    ]);
  });

  it("counts and filters each kind separately", () => {
    const entries = sortHistory([
      ...entriesFromMessages([outbound, inbound], people),
      ...entriesFromDrafts(drafts, people),
    ]);
    expect(historyCounts(entries)).toEqual({ all: 4, sent: 1, replies: 1, drafts: 2 });
    expect(entries.filter((entry) => inHistoryFilter(entry, "replies"))).toHaveLength(1);
  });

  it("searches on person, company and subject", () => {
    const entry = entriesFromMessages([inbound], people)[0]!;
    expect(matchesHistoryQuery(entry, "thyme")).toBe(true);
    expect(matchesHistoryQuery(entry, "kickoff")).toBe(true);
    expect(matchesHistoryQuery(entry, "invoice")).toBe(false);
  });

  it("prepares a new draft from a record without repeating Re: twice", () => {
    const [sent, reply] = entriesFromMessages([outbound, inbound], people);
    expect(draftSeedFrom(sent!).subject).toBe("Re: Kickoff timing");
    expect(draftSeedFrom(reply!).subject).toBe("Re: Kickoff timing");
    expect(draftSeedFrom(reply!).recipientEmail).toBe("robin@thymecare.com");
    expect(draftSeedFrom(reply!).body).toBe("Tuesday works for us.");
  });
});
