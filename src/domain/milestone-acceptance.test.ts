import { describe, expect, it } from "vitest";

import {
  acceptanceEventKey,
  acceptanceSummary,
  isAccepted,
  reopenEventKey,
} from "./milestone-acceptance";

describe("milestone acceptance", () => {
  it("reads complete from acceptedAt only", () => {
    expect(isAccepted({})).toBe(false);
    expect(isAccepted({ acceptance: null })).toBe(false);
    expect(isAccepted({ acceptance: { acceptedAt: "2026-09-07T10:00:00.000Z", acceptedBy: "u1" } }))
      .toBe(true);
  });

  it("keeps one stable key per acceptance, so a retry writes no second receipt", () => {
    expect(acceptanceEventKey("m1")).toBe(acceptanceEventKey("m1"));
    expect(acceptanceEventKey("m1")).not.toBe(acceptanceEventKey("m2"));
  });

  it("keys a reopen to the acceptance it clears", () => {
    const at = "2026-09-07T10:00:00.000Z";
    expect(reopenEventKey("m1", at)).toBe(reopenEventKey("m1", at));
    expect(reopenEventKey("m1", at)).not.toBe(reopenEventKey("m1", "2026-09-08T10:00:00.000Z"));
  });

  it("says who accepted it, and does not invent a name", () => {
    expect(
      acceptanceSummary({
        acceptedAt: "2026-09-07T10:00:00.000Z",
        acceptedBy: "u1",
        acceptedByLabel: "Tai",
      }),
    ).toBe("Accepted by Tai on 2026-09-07.");
    expect(acceptanceSummary({ acceptedAt: "2026-09-07T10:00:00.000Z", acceptedBy: "u1" })).toBe(
      "Accepted on 2026-09-07.",
    );
  });
});
