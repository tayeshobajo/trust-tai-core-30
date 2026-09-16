import { describe, expect, it } from "vitest";

import { fillKnownTitles, mergePeople, personIdentity, receiptUsable } from "./scout-people-overlay";
import type { ScoutPerson } from "./scout-people";

function person(over: Partial<ScoutPerson> & { key: string; fullName: string }): ScoutPerson {
  return {
    companyName: "Acumen",
    buyingRole: "unknown",
    whyThisPerson: "Leads the function",
    emailStatus: "not_checked",
    provider: "apollo",
    discoveredAt: "2026-09-01T00:00:00Z",
    support: 10,
    ...over,
  };
}

const answer = {
  identity: "provider:abc",
  workEmail: "k@acumen.com",
  emailStatus: "verified" as const,
  provider: "apollo" as const,
  emailFetchedAt: "2026-09-16T10:00:00Z",
  emailVerifiedAt: "2026-09-16T10:00:00Z",
  providerNote: "Apollo reported this address as verified.",
  saveError: "Researched people cannot be saved yet.",
};

describe("mergePeople", () => {
  it("shows a new answer on a person who exists only in storage", () => {
    const saved = person({
      key: "row-1",
      persistedId: "row-1",
      fullName: "Keith",
      providerPersonId: "abc",
    });
    const [row] = mergePeople({
      saved: [saved],
      session: [],
      pending: { [personIdentity(saved)]: answer },
    });
    expect(row?.workEmail).toBe("k@acumen.com");
    expect(row?.emailStatus).toBe("verified");
    expect(row?.emailFetchedAt).toBe("2026-09-16T10:00:00Z");
    expect(row?.pendingSave).toBe(true);
    expect(row?.saveError).toBe("Researched people cannot be saved yet.");
    expect(row?.pendingNote).toContain("Apollo");
  });

  it("lays a newer lookup over a stale saved version", () => {
    const saved = person({
      key: "row-1",
      persistedId: "row-1",
      fullName: "Keith",
      providerPersonId: "abc",
      workEmail: "old@acumen.com",
      emailStatus: "found_unverified",
      emailFetchedAt: "2026-01-01T00:00:00Z",
    });
    const [row] = mergePeople({
      saved: [saved],
      session: [],
      pending: { [personIdentity(saved)]: answer },
    });
    expect(row?.workEmail).toBe("k@acumen.com");
    expect(row?.emailVerifiedAt).toBe("2026-09-16T10:00:00Z");
  });

  it("never lets an older answer hide a newer saved one", () => {
    const saved = person({
      key: "row-1",
      persistedId: "row-1",
      fullName: "Keith",
      providerPersonId: "abc",
      workEmail: "new@acumen.com",
      emailStatus: "verified",
      emailVerifiedAt: "2026-10-01T00:00:00Z",
    });
    const [row] = mergePeople({
      saved: [saved],
      session: [],
      pending: { [personIdentity(saved)]: answer },
    });
    expect(row?.workEmail).toBe("new@acumen.com");
    expect(row?.pendingSave).toBeUndefined();
  });

  it("keeps the answer on the right person and company", () => {
    const keith = person({ key: "a", fullName: "Keith", providerPersonId: "abc" });
    const shaun = person({ key: "b", fullName: "Shaun", providerPersonId: "def" });
    const rows = mergePeople({
      saved: [],
      session: [keith, shaun],
      pending: { [personIdentity(keith)]: answer },
    });
    expect(rows[0]?.workEmail).toBe("k@acumen.com");
    expect(rows[1]?.workEmail).toBeUndefined();
  });

  it("does not merge two different people who share a name", () => {
    const a = person({ key: "row-1", fullName: "Sam Reed" });
    const b = person({ key: "row-2", fullName: "Sam Reed" });
    expect(personIdentity(a)).not.toBe(personIdentity(b));
    expect(mergePeople({ saved: [a], session: [b] })).toHaveLength(2);
  });

  it("drops a session duplicate of a saved person", () => {
    const saved = person({ key: "row-1", persistedId: "row-1", fullName: "Keith", providerPersonId: "abc" });
    const session = person({ key: "apollo:abc", fullName: "Keith", providerPersonId: "abc" });
    expect(mergePeople({ saved: [saved], session: [session] })).toHaveLength(1);
  });
});

describe("receiptUsable", () => {
  it("is true only while the server still holds the answer", () => {
    expect(
      receiptUsable({ ...answer, receiptId: "r", receiptExpiresAt: "2026-09-16T10:30:00Z" }, "2026-09-16T10:10:00Z"),
    ).toBe(true);
    expect(
      receiptUsable({ ...answer, receiptId: "r", receiptExpiresAt: "2026-09-16T10:30:00Z" }, "2026-09-16T11:00:00Z"),
    ).toBe(false);
    expect(receiptUsable(answer, "2026-09-16T10:10:00Z")).toBe(false);
  });
});

describe("details recovered by a lookup", () => {
  it("fills a missing title from the match without overwriting a known one", () => {
    const withoutTitle = person({ key: "row-1", fullName: "Robin Shah", providerPersonId: "abc" });
    const [filled] = mergePeople({
      saved: [withoutTitle],
      session: [],
      pending: {
        [personIdentity(withoutTitle)]: {
          ...answer,
          identity: personIdentity(withoutTitle),
          title: "Head of Partnerships",
        },
      },
    });
    expect(filled?.title).toBe("Head of Partnerships");

    const known = person({ key: "row-2", fullName: "Robin Shah", title: "COO", providerPersonId: "xyz" });
    const [kept] = mergePeople({
      saved: [known],
      session: [],
      pending: {
        [personIdentity(known)]: {
          ...answer,
          identity: personIdentity(known),
          title: "Head of Partnerships",
        },
      },
    });
    expect(kept?.title).toBe("COO");
  });
});

describe("fillKnownTitles", () => {
  it("keeps a title this workspace already recorded when the provider gave none", () => {
    const [row] = fillKnownTitles(
      [person({ key: "apollo:1", fullName: "Robin Shah", companyName: "Thyme Care" })],
      [{ fullName: "Robin Shah", roleTitle: "Co-founder (publicly profiled)", companyName: "Thyme Care" }],
    );
    expect(row?.title).toBe("Co-founder (publicly profiled)");
  });

  it("never overwrites the title the provider did give", () => {
    const [row] = fillKnownTitles(
      [person({ key: "apollo:1", fullName: "Robin Shah", companyName: "Thyme Care", title: "COO" })],
      [{ fullName: "Robin Shah", roleTitle: "Co-founder", companyName: "Thyme Care" }],
    );
    expect(row?.title).toBe("COO");
  });

  it("leaves a person with no recorded title alone", () => {
    const [row] = fillKnownTitles([person({ key: "apollo:2", fullName: "Sam Reed" })], []);
    expect(row?.title).toBeUndefined();
  });
});
