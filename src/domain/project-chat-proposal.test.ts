/**
 * Chat is a doorway, never a second mutation path.
 *
 * These tests hold the line: a message can only prepare a bounded proposal,
 * the proposal shows what the record says today, a person's approval is the
 * only thing that makes it real, truth that moved underneath refuses the
 * write, and an approval replayed twice records nothing twice.
 */

import { describe, expect, it } from "vitest";

import {
  alreadyApplied,
  currentValueFor,
  prepareProposal,
  receiptFor,
  staleReason,
  OTHER_ROOM_TRUTH,
} from "./project-chat-proposal";
import type { ExecutionProject } from "./projects";

const PROJECT: ExecutionProject = {
  id: "p1",
  organizationId: "org1",
  name: "Mental Dental Academy",
  state: "in_flight",
  pointA: "Course outline drafted",
  pointB: "First cohort enrolled",
  nextMove: "Send the draft to Fiona",
  evidence: [],
  dependencies: [],
  origin: { kind: "manual", subjectLabel: "Mental Dental" },
  lastMovedAt: "2026-09-01T10:00:00.000Z",
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

describe("prepareProposal", () => {
  it("shows the value today beside the value proposed, and writes nothing", () => {
    const result = prepareProposal(
      PROJECT,
      { action: "next_move", value: "Book the cohort call", reason: "Fiona replied" },
      "next move is booking the cohort call",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.currentValue).toBe("Send the draft to Fiona");
    expect(result.proposal.proposedValue).toBe("Book the cohort call");
    expect(result.proposal.owningRoom).toBe("Projects");
    expect(result.proposal.changes).toEqual({ nextMove: "Book the cohort call" });
    expect(PROJECT.nextMove).toBe("Send the draft to Fiona");
  });

  it("refuses a change the record already reflects", () => {
    const result = prepareProposal(
      PROJECT,
      { action: "next_move", value: "Send the draft to Fiona" },
      "keep it as is",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.because).toMatch(/already says that/i);
  });

  it("uses the same refusal as the Manage panel when the edit is dishonest", () => {
    const result = prepareProposal(PROJECT, { action: "name", value: "  " }, "rename it");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.because).toMatch(/needs a name/i);
  });

  it("requires a member for an owner change, never a typed name", () => {
    const result = prepareProposal(PROJECT, { action: "owner", value: "Someone" }, "hand it over");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.because).toMatch(/member of this workspace/i);
  });

  it("records a block only with the reason a person gave", () => {
    const missing = prepareProposal(PROJECT, { action: "block" }, "it is stuck");
    expect(missing.ok).toBe(false);
    const named = prepareProposal(
      PROJECT,
      { action: "block", value: "Waiting on brand assets" },
      "it is stuck on assets",
    );
    expect(named.ok).toBe(true);
    if (!named.ok) return;
    expect(named.proposal.changes).toEqual({
      state: "blocked",
      blockedBecause: "Waiting on brand assets",
    });
  });

  it("keeps a due date on the agreed day and refuses an unreadable one", () => {
    const good = prepareProposal(PROJECT, { action: "due_date", value: "2026-10-01" }, "due Oct 1");
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect(good.proposal.changes).toEqual({ dueDate: "2026-10-01T12:00:00.000Z" });
    expect(good.proposal.proposedValue).toBe("2026-10-01");

    const bad = prepareProposal(PROJECT, { action: "due_date", value: "soon" }, "due soon");
    expect(bad.ok).toBe(false);
  });

  it("keeps finished delivery items ticked when the list is rewritten", () => {
    const project = {
      ...PROJECT,
      deliveryItems: [
        { label: "Outline", done: true },
        { label: "Slides", done: false },
      ],
    };
    const result = prepareProposal(
      project,
      { action: "delivery_items", items: ["- Outline", "Slides", "Workbook"] },
      "add a workbook",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.changes?.deliveryItems).toEqual([
      { label: "Outline", done: true },
      { label: "Slides", done: false },
      { label: "Workbook", done: false },
    ]);
  });

  it("saves a source as a link and says nothing was imported from it", () => {
    const result = prepareProposal(
      PROJECT,
      {
        action: "link_source",
        source: { title: "Course thinking", url: "https://chat.openai.com/x", sourceType: "chatgpt" },
      },
      "link my chatgpt thread",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.source).toEqual({
      sourceType: "chatgpt",
      title: "Course thinking",
      url: "https://chat.openai.com/x",
    });
    expect(result.proposal.note).toMatch(/nothing is imported/i);
    expect(result.proposal.changes).toBeNull();
  });

  it("names the room that owns truth Projects does not", () => {
    expect(OTHER_ROOM_TRUTH.clients.room).toBe("Clients");
    expect(OTHER_ROOM_TRUTH.comms.to).toBe("/modules/comms");
    expect(OTHER_ROOM_TRUTH.roadmap.because).toMatch(/Roadmap truth/);
  });
});

describe("approval safety", () => {
  const prepared = prepareProposal(
    PROJECT,
    { action: "next_move", value: "Book the cohort call" },
    "book the call",
  );
  const proposal = prepared.ok ? prepared.proposal : null;

  it("refuses a proposal prepared against truth that has since moved", () => {
    expect(proposal).not.toBeNull();
    if (!proposal) return;
    const moved = { ...PROJECT, nextMove: "Chase the invoice" };
    expect(staleReason(proposal, moved)).toMatch(/changed since this was prepared/i);
    expect(staleReason(proposal, PROJECT)).toBeNull();
  });

  it("treats a second approval as already recorded, not a second change", () => {
    if (!proposal) return;
    const applied = { ...PROJECT, nextMove: "Book the cohort call" };
    expect(alreadyApplied(proposal, applied)).toBe(true);
    expect(alreadyApplied(proposal, PROJECT)).toBe(false);
    expect(staleReason(proposal, applied)).toBeNull();
  });

  it("reads the current value from the record, never from the proposal", () => {
    expect(currentValueFor(PROJECT, "point_a")).toBe("Course outline drafted");
    expect(currentValueFor(PROJECT, "waiting_on")).toBe("");
    expect(currentValueFor({ ...PROJECT, state: "blocked", blockedBecause: "No assets" }, "block"))
      .toBe("No assets");
  });

  it("claims a receipt only in the store that actually holds it", () => {
    if (!proposal) return;
    expect(receiptFor(proposal)).toMatch(/updated in Projects/);
  });
});
