import { describe, expect, it } from "vitest";

import { displayName } from "@/lib/identity-name";

describe("displayName", () => {
  it("prefers the explicit full_name from the profile", () => {
    expect(
      displayName(
        { full_name: "Diamond Shobajo", display_name: "Diamond" },
        "diamond@trusttai.com",
      ),
    ).toBe("Diamond Shobajo");
  });

  it("falls back to display_name then name when full_name is absent", () => {
    expect(displayName({ display_name: "Diamond" }, "diamond@trusttai.com")).toBe("Diamond");
    expect(displayName({ name: "D. Shobajo" }, "diamond@trusttai.com")).toBe("D. Shobajo");
  });

  it("trims stored names without inventing anything", () => {
    expect(displayName({ full_name: "  Tai Shobajo  " }, "t@trusttai.com")).toBe("Tai Shobajo");
  });

  it("uses the verified email, never a guessed name, when no name is stored", () => {
    expect(displayName(null, "diamond@trusttai.com")).toBe("diamond@trusttai.com");
    expect(displayName({ full_name: null, display_name: "" }, "diamond@trusttai.com")).toBe(
      "diamond@trusttai.com",
    );
    expect(displayName({ full_name: "   " }, "diamond@trusttai.com")).toBe("diamond@trusttai.com");
  });
});
