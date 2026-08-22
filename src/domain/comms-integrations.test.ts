import { describe, expect, it } from "vitest";

import {
  readGmailRunSummary,
  summarizeMailboxCoverage,
} from "@/domain/comms-integrations";

describe("readGmailRunSummary", () => {
  it("reads a well-formed last run from the cursor", () => {
    const summary = readGmailRunSummary({
      last_pass_at: "2026-08-22T18:00:00.000Z",
      last_run: {
        at: "2026-08-22T18:00:00.000Z",
        messages_read: 14,
        messages_stored: 13,
        relationships_touched: 1,
        skipped_unknown_people: 5,
        pending_people: 2,
        events_emitted: 7,
        drafts_verified: 1,
      },
    });
    expect(summary).toEqual({
      at: "2026-08-22T18:00:00.000Z",
      messagesRead: 14,
      messagesStored: 13,
      relationshipsTouched: 1,
      skippedUnknownPeople: 5,
      pendingPeople: 2,
      eventsEmitted: 7,
      draftsVerified: 1,
    });
  });

  it("is absent when nothing has been recorded yet", () => {
    expect(readGmailRunSummary({})).toBeNull();
    expect(readGmailRunSummary({ last_run: null })).toBeNull();
    expect(readGmailRunSummary({ last_run: "not-an-object" })).toBeNull();
  });

  it("requires a timestamp — a run without one is not a run", () => {
    expect(readGmailRunSummary({ last_run: { messages_read: 3 } })).toBeNull();
    expect(readGmailRunSummary({ last_run: { at: "" } })).toBeNull();
  });

  it("clamps malformed counts to zero rather than failing or lying", () => {
    const summary = readGmailRunSummary({
      last_run: {
        at: "2026-08-22T18:00:00.000Z",
        messages_read: "fourteen",
        pending_people: -2,
        drafts_verified: 1.9,
      },
    });
    expect(summary).toMatchObject({
      messagesRead: 0,
      pendingPeople: 0,
      draftsVerified: 1,
      eventsEmitted: 0,
    });
  });
});

describe("summarizeMailboxCoverage", () => {
  it("splits labeled correspondents into tracked and pending", () => {
    const coverage = summarizeMailboxCoverage(
      [
        { alreadyTracked: true },
        { alreadyTracked: true },
        { alreadyTracked: false },
        { alreadyTracked: false },
        { alreadyTracked: false },
      ],
      30,
    );
    expect(coverage).toEqual({
      windowDays: 30,
      correspondents: 5,
      tracked: 2,
      pending: 3,
    });
  });

  it("reports an empty labeled window honestly as zeros", () => {
    expect(summarizeMailboxCoverage([], 30)).toEqual({
      windowDays: 30,
      correspondents: 0,
      tracked: 0,
      pending: 0,
    });
  });

  it("counts everyone tracked as full coverage", () => {
    const coverage = summarizeMailboxCoverage([{ alreadyTracked: true }], 2);
    expect(coverage.pending).toBe(0);
    expect(coverage.correspondents).toBe(1);
  });
});
