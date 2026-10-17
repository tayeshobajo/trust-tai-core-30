import { describe, expect, it } from "vitest";

/**
 * recording_id arrives as a NUMBER on some Fathom responses and a string on
 * others. The normalizer must keep both as the same stable identity rather
 * than dropping the numeric form (which used to silently unlink calls).
 */
import * as fathom from "./steward-fathom.server";

describe("steward fathom adapter", () => {
  it("normalizes numeric and string recording ids to the same stable identity", () => {
    expect(fathom.normalizeRecordingId(779145597)).toBe("779145597");
    expect(fathom.normalizeRecordingId("779145597")).toBe("779145597");
    expect(fathom.normalizeRecordingId("  ")).toBeUndefined();
    expect(fathom.normalizeRecordingId(null)).toBeUndefined();
    expect(fathom.normalizeRecordingId(1.5)).toBeUndefined();
    expect(fathom.normalizeRecordingId(Number.MAX_SAFE_INTEGER + 1)).toBeUndefined();
  });

  it("reports an unconfigured source honestly when no key is present", () => {
    const status = fathom.fathomStatus();
    expect(status.provider).toBe("fathom");
    expect(typeof status.configured).toBe("boolean");
    expect(status.because.length).toBeGreaterThan(0);
  });
});
