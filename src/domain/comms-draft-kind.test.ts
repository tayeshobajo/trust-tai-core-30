import { describe, expect, it } from "vitest";

import { DRAFT_KINDS, parseDraftKind, readDraftKind } from "./comms-draft-kind";

describe("draft kind", () => {
  it("accepts only the three kinds", () => {
    for (const kind of DRAFT_KINDS) expect(parseDraftKind(kind)).toBe(kind);
    expect(parseDraftKind("invoice")).toBe("message");
    expect(parseDraftKind(undefined)).toBe("message");
  });

  it("reads an old row with no kind as not recorded, never as a guess", () => {
    expect(readDraftKind(null)).toBeNull();
    expect(readDraftKind("")).toBeNull();
    expect(readDraftKind("proposal")).toBe("proposal");
  });
});
