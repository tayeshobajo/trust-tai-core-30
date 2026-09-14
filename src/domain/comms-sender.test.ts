import { describe, expect, it } from "vitest";

import { senderEvidence, signatureName, signoffFor } from "./comms-sender";

describe("signatureName", () => {
  it("uses the given name, including surname-first records", () => {
    expect(signatureName("Tayo Shobajo")).toBe("Tayo");
    expect(signatureName("Shobajo, Tayo")).toBe("Tayo");
    expect(signatureName("  Sam  ")).toBe("Sam");
    expect(signatureName("")).toBe("");
  });
});

describe("signoffFor", () => {
  it("signs Tai's message with Tai's name", () => {
    expect(signoffFor({ id: "u1", name: "Tai Shobajo" })).toBe("Trust,\nTai");
  });

  it("never signs a team member's message with Tai's name", () => {
    expect(signoffFor({ id: "u2", name: "Sam Okoye" })).toBe("Trust,\nSam");
  });

  it("leaves the draft unsigned when the author is unknown", () => {
    expect(signoffFor(null)).toBeNull();
    expect(signoffFor({ id: "u3", name: "   " })).toBeNull();
  });
});

describe("senderEvidence", () => {
  it("states who is writing, without borrowing another name", () => {
    expect(senderEvidence({ id: "u2", name: "Sam Okoye" })).toMatchObject({
      name: "Sam Okoye",
      signsAs: "Sam",
    });
    expect(senderEvidence(null)).toMatchObject({ name: null, signsAs: null });
  });
});
