import { describe, expect, it } from "vitest";

import {
  editedProvenance,
  readTouchRecord,
  recordNote,
  restoredProvenance,
  retractedProvenance,
} from "./comms-touch-record";

describe("touch record", () => {
  it("keeps the original wording when an entry is corrected", () => {
    const first = editedProvenance(
      { added_by: "Tai", logged_at: "2026-01-01T09:00:00.000Z" },
      {
        previousSummary: "Called about pricing",
        occurredAt: "2026-01-01T09:00:00.000Z",
        at: "2026-01-02T09:00:00.000Z",
        by: "Tai",
      },
    );
    const second = editedProvenance(first, {
      previousSummary: "Called about the pilot pricing",
      at: "2026-01-03T09:00:00.000Z",
      by: "Tai",
    });

    expect(second.original_summary).toBe("Called about pricing");
    expect(second.original_occurred_at).toBe("2026-01-01T09:00:00.000Z");
    expect(second.edits).toHaveLength(2);

    const read = readTouchRecord(second);
    expect(read.edited).toBe(true);
    expect(read.editCount).toBe(2);
    expect(read.addedBy).toBe("Tai");
    expect(recordNote(read)).toContain("Originally");
  });

  it("marks a retraction without deleting anything", () => {
    const provenance = retractedProvenance(
      { added_by: "Tai", original_summary: "Called about pricing" },
      { at: "2026-01-04T09:00:00.000Z", by: "Tai", because: " logged on the wrong person " },
    );
    expect(provenance.added_by).toBe("Tai");
    expect(provenance.retracted_because).toBe("logged on the wrong person");

    const read = readTouchRecord(provenance);
    expect(read.retracted).toBe(true);
    expect(recordNote(read)).toContain("The original record is kept.");
  });

  it("remembers that a restored entry was once withdrawn", () => {
    const retracted = retractedProvenance(undefined, {
      at: "2026-01-04T09:00:00.000Z",
      by: "Tai",
    });
    const restored = restoredProvenance(retracted, { at: "2026-01-05T09:00:00.000Z" });

    expect(readTouchRecord(restored).retracted).toBe(false);
    expect(restored["retractions"]).toHaveLength(1);
  });

  it("says nothing when an entry has never been touched", () => {
    expect(recordNote(readTouchRecord(undefined))).toBeNull();
    expect(readTouchRecord("not an object").edited).toBe(false);
  });
});
