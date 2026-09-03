import { describe, expect, it } from "vitest";

import { companyFromEmail, identityPatches, isMailboxNoise, resolveIdentity } from "./comms-people";

describe("companyFromEmail", () => {
  it("reads a company from a real domain", () => {
    expect(companyFromEmail("brendon@elevateortho.com")).toBe("Elevateortho");
    expect(companyFromEmail("a@your-choice.co.uk")).toBe("Your Choice");
  });

  it("invents nothing from a free mailbox", () => {
    expect(companyFromEmail("kingdomtransport123@gmail.com")).toBeUndefined();
    expect(companyFromEmail("someone@icloud.com")).toBeUndefined();
    expect(companyFromEmail("")).toBeUndefined();
  });
});

describe("isMailboxNoise", () => {
  it("recognises a company derived from a free mailbox", () => {
    expect(isMailboxNoise("Gmail", "kingdomtransport123@gmail.com")).toBe(true);
  });

  it("keeps a real company", () => {
    expect(isMailboxNoise("Elevateortho", "brendon@elevateortho.com")).toBe(false);
    expect(isMailboxNoise(undefined, "a@b.com")).toBe(false);
  });
});

describe("resolveIdentity", () => {
  it("drops mailbox noise and keeps the contact's title", () => {
    const identity = resolveIdentity({
      relationship: {
        fullName: "Clayton Matlock",
        companyName: "Gmail",
        email: "kingdomtransport123@gmail.com",
      },
      contact: { fullName: "Clayton Matlock", roleTitle: "Owner" },
    });
    expect(identity).toEqual({ fullName: "Clayton Matlock", roleTitle: "Owner" });
  });

  it("derives a company when neither side states one", () => {
    const identity = resolveIdentity({
      relationship: { fullName: "Brendon Schmitt", email: "brendon@elevateortho.com" },
    });
    expect(identity.companyName).toBe("Elevateortho");
  });

  it("prefers a stated company over a derived one", () => {
    const identity = resolveIdentity({
      relationship: { fullName: "Amy Cromer", companyName: "Pinnacle Bank", email: "amy@pnfp.com" },
    });
    expect(identity.companyName).toBe("Pinnacle Bank");
  });
});

describe("identityPatches", () => {
  it("writes nothing when both sides already agree", () => {
    const sides = {
      relationship: {
        fullName: "Dana Whitfield",
        companyName: "Northlight Systems",
        email: "dana@northlightsystems.com",
      },
      contact: { fullName: "Dana Whitfield", roleTitle: "COO", companyName: "Northlight Systems" },
    };
    const patches = identityPatches(sides, resolveIdentity(sides));
    expect(patches.changed).toBe(false);
  });

  it("clears mailbox noise from the relationship", () => {
    const sides = {
      relationship: { fullName: "Clayton Matlock", companyName: "Gmail", email: "c@gmail.com" },
      contact: { fullName: "Clayton Matlock" },
    };
    const patches = identityPatches(sides, resolveIdentity(sides));
    expect(patches.relationship.companyName).toBeNull();
    expect(patches.changed).toBe(true);
  });

  it("carries a human edit to both sides", () => {
    const sides = {
      relationship: { fullName: "Clayton Matlock", email: "c@gmail.com" },
      contact: { fullName: "Clayton Matlock" },
    };
    const patches = identityPatches(sides, {
      fullName: "Clayton Matlock",
      roleTitle: "Owner",
      companyName: "Kingdom Transport",
    });
    expect(patches.contact).toEqual({ roleTitle: "Owner", companyName: "Kingdom Transport" });
    expect(patches.relationship).toEqual({ companyName: "Kingdom Transport" });
  });

  it("refuses an empty name", () => {
    const patches = identityPatches({ relationship: { fullName: "A" } }, { fullName: "   " });
    expect(patches.changed).toBe(false);
  });
});
