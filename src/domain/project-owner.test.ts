/**
 * Who carries the work.
 *
 * Handing a project to a named person is always allowed. Leaving live work
 * with nobody is refused, in the same words the picker shows.
 */

import { describe, expect, it } from "vitest";

import { checkOwnerAssignment } from "./projects";

describe("checkOwnerAssignment", () => {
  it("accepts handing in-flight work to a named member", () => {
    const check = checkOwnerAssignment(
      { state: "in_flight" },
      { ownerUserId: "user-1", ownerLabel: "Diamond" },
    );
    expect(check.ok).toBe(true);
    expect(check.because).toContain("Diamond");
  });

  it("refuses taking the last person off in-flight work", () => {
    const check = checkOwnerAssignment({ state: "in_flight" }, { ownerUserId: "", ownerLabel: "" });
    expect(check.ok).toBe(false);
    expect(check.because).toContain("cannot be left with nobody");
  });

  it("refuses taking the last person off work in review", () => {
    const check = checkOwnerAssignment({ state: "in_review" }, {});
    expect(check.ok).toBe(false);
  });

  it("allows work that has not started to carry nobody", () => {
    const check = checkOwnerAssignment({ state: "not_started" }, {});
    expect(check.ok).toBe(true);
  });

  it("treats whitespace as nobody", () => {
    const check = checkOwnerAssignment(
      { state: "in_flight" },
      { ownerUserId: "  ", ownerLabel: "  " },
    );
    expect(check.ok).toBe(false);
  });
});
