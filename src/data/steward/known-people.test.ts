import { describe, expect, it } from "vitest";

import { describeKnownPeople, resolveKnownPeople } from "./known-people";

describe("resolveKnownPeople", () => {
  it("resolves people known elsewhere in Trust Tai, not just Steward's own registry", () => {
    const people = resolveKnownPeople({
      roleMemory: [],
      members: [{ name: "Tai Founder", email: "tai@trusttai.com", title: "Founder" }],
      contacts: [{ name: "Dana Client", email: "dana@example.com", title: "Practice lead" }],
    });
    expect(people.map((person) => person.name)).toEqual(["Tai Founder", "Dana Client"]);
    expect(people[0]?.source).toBe("workspace_member");
    expect(people[1]?.source).toBe("contact");
  });

  it("keeps human-recorded role memory ahead of a directory row for the same person", () => {
    const people = resolveKnownPeople({
      roleMemory: [{ name: "Tai Founder", email: "tai@trusttai.com", title: "Owns the roadmap" }],
      members: [{ name: "Tai Founder", email: "tai@trusttai.com", title: "Founder" }],
      contacts: [],
    });
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ title: "Owns the roadmap", source: "role_memory" });
  });

  it("treats the same email in two sources as one person", () => {
    const people = resolveKnownPeople({
      roleMemory: [],
      members: [{ name: "T. Founder", email: "tai@trusttai.com" }],
      contacts: [{ name: "Tai Founder", email: "TAI@trusttai.com", title: "Founder" }],
    });
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ name: "T. Founder", title: "Founder" });
  });

  it("matches on an exact name when no email is recorded, and never on similarity", () => {
    const exact = resolveKnownPeople({
      roleMemory: [{ name: "Dana  Client" }],
      members: [],
      contacts: [{ name: "dana client", title: "Practice lead" }],
    });
    expect(exact).toHaveLength(1);
    expect(exact[0]?.title).toBe("Practice lead");

    const similar = resolveKnownPeople({
      roleMemory: [{ name: "Dana Client" }],
      members: [],
      contacts: [{ name: "Dan Client" }],
    });
    expect(similar).toHaveLength(2);
  });

  it("never invents a person from an email address alone", () => {
    const people = resolveKnownPeople({
      roleMemory: [],
      members: [{ name: "   ", email: "someone@example.com" }],
      contacts: [],
    });
    expect(people).toEqual([]);
  });

  it("says nothing about people when nobody is known", () => {
    expect(describeKnownPeople([])).toBe("Read from this workspace's open commitments.");
    expect(describeKnownPeople([{ name: "Tai Founder", source: "workspace_member" }])).toContain(
      "workspace members",
    );
  });
});
