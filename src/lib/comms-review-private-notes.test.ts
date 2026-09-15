/**
 * Private review notes: three states that must never read as each other.
 *
 * A run written before the column existed, or one whose note write did not
 * land, has no record of private notes. A completed run that recorded them
 * and raised none is a different fact. Showing both as "no notes" would
 * credit the reviewer with a judgment it never made.
 */

import { describe, expect, it } from "vitest";

import { privateNotesReading } from "@/domain/comms-review";
import { toRun } from "./comms-review.server";

const row = (over: Record<string, unknown> = {}) => ({
  id: "run-1",
  session_id: "s-1",
  version_id: "v-1",
  status: "complete",
  provider: "lovable",
  model: "openai/gpt-5-mini",
  prompt_version: "comms-review/2026-09-15",
  started_at: "2026-09-15T10:00:00.000Z",
  completed_at: "2026-09-15T10:00:20.000Z",
  ...over,
});

describe("reading a run's private notes", () => {
  it("treats a historical run with no column as not recorded", () => {
    const run = toRun(row());
    expect(run.opportunities).toBeNull();
    const reading = privateNotesReading(run);
    expect(reading.state).toBe("not_recorded");
    expect(reading.note).toMatch(/not the same as the reviewer raising none/i);
    expect(reading.notes).toHaveLength(0);
  });

  it("treats an explicit SQL NULL the same way", () => {
    expect(toRun(row({ opportunities: null })).opportunities).toBeNull();
    expect(privateNotesReading(toRun(row({ opportunities: null }))).state).toBe("not_recorded");
  });

  it("treats a recorded empty array as the reviewer raising none", () => {
    const run = toRun(row({ opportunities: [] }));
    expect(run.opportunities).toEqual([]);
    const reading = privateNotesReading(run);
    expect(reading.state).toBe("evaluated_none");
    expect(reading.note).toMatch(/raised none/i);
  });

  it("keeps populated notes, with their evidence, after a reload", () => {
    const run = toRun(
      row({
        opportunities: [
          {
            evidence: "we are hiring two more engineers in Q1",
            reading: "The team is growing, which may change their delivery needs.",
            worth: "medium",
            timing: "after this thread settles",
          },
        ],
      }),
    );
    const reading = privateNotesReading(run);
    expect(reading.state).toBe("notes");
    expect(reading.notes[0]?.evidence).toBe("we are hiring two more engineers in Q1");
    expect(reading.notes[0]?.worth).toBe("medium");
  });

  it("falls back to unknown rather than inventing worth or timing", () => {
    const run = toRun(row({ opportunities: [{ evidence: "x", reading: "y" }] }));
    expect(run.opportunities?.[0]).toMatchObject({ worth: "unknown", timing: "unknown" });
  });

  it("reads a failed note write as not recorded, never as none raised", () => {
    /* The completion update retries without the column; the row keeps NULL. */
    const afterFailedWrite = toRun(row({ opportunities: null }));
    expect(privateNotesReading(afterFailedWrite).state).toBe("not_recorded");
    expect(privateNotesReading(afterFailedWrite).state).not.toBe("evaluated_none");
  });

  it("says nothing at all when there is no run", () => {
    expect(privateNotesReading(null).state).toBe("no_run");
  });
});
