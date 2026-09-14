import { describe, expect, it } from "vitest";

import { draftSearch, readFailureMessage, sectionState } from "./comms-section-state";

describe("dashboard sections", () => {
  it("never shows an empty success after a failed read", () => {
    expect(sectionState({ isError: true, isPending: false, count: 0 })).toBe("error");
    expect(sectionState({ isError: true, isPending: false, count: null })).toBe("error");
  });

  it("separates loading, empty and a real list", () => {
    expect(sectionState({ isError: false, isPending: true, count: null })).toBe("loading");
    expect(sectionState({ isError: false, isPending: false, count: 0 })).toBe("empty");
    expect(sectionState({ isError: false, isPending: false, count: 3 })).toBe("list");
  });

  it("sanitizes what a failure says", () => {
    expect(readFailureMessage(new Error("permission denied for table comms_drafts"))).toBe(
      "You do not have access to this part of the workspace.",
    );
    expect(readFailureMessage(new Error("FetchError: ECONNRESET https://x.supabase.co"))).toBe(
      "This could not be read just now.",
    );
  });

  it("opens the exact draft record, not the list", () => {
    expect(draftSearch("draft-9")).toEqual({ draft: "draft-9" });
  });
});
