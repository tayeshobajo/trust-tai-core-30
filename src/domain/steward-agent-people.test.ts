import { describe, expect, it } from "vitest";

import { linkedProspectId, toPeopleEvidence, validatePeopleUse } from "./steward-agent-people";

const PID = "11111111-1111-4111-8111-111111111111";
const rows = [1, 2, 3, 4, 5].map((n) => ({
  id: `p${n}`,
  full_name: `Person ${n}`,
  title: n === 2 ? null : `Title ${n}`,
  company_name: "Synthetic Co",
  email_status: (n === 1 ? "verified" : n === 3 ? "found_unverified" : "not_checked") as
    | "verified"
    | "found_unverified"
    | "not_checked",
  work_email: n === 1 ? "a@synthetic.test" : n === 3 ? "c@synthetic.test" : null,
  buying_role: "unknown",
  why_this_person: "Synthetic",
}));

describe("agent Scout People context", () => {
  it("links only by canonical source or exact Scout correlation", () => {
    expect(linkedProspectId({ sourceApp: "scout", sourceEntityType: "prospect", sourceEntityId: PID })).toBe(PID);
    expect(linkedProspectId({ correlationId: `scout:prospect:${PID}:first-message` })).toBe(PID);
    expect(linkedProspectId({ correlationId: "Scout task for Person 1" })).toBeNull();
  });

  it("caps at four and labels email state honestly", () => {
    const ev = toPeopleEvidence(rows);
    expect(ev).toHaveLength(4);
    expect(ev[0]!.email).toContain("(verified)");
    expect(ev[1]!.title).toBe("Title not recorded");
    expect(ev[2]!.email).toContain("(not verified)");
    expect(ev[3]!.email).toBe("No work email on file");
  });

  it("accepts cited real people and rejects invented or uncited names", () => {
    const people = toPeopleEvidence(rows);
    expect(
      validatePeopleUse({ artifact: "Talk to Person 1, Title 1.", evidenceRefs: ["person:p1"], peopleNamed: ["Person 1"], people }).ok,
    ).toBe(true);
    expect(
      validatePeopleUse({ artifact: "Talk to Jane Doe.", evidenceRefs: [], peopleNamed: ["Jane Doe"], people }).ok,
    ).toBe(false);
    expect(
      validatePeopleUse({ artifact: "Talk to Person 1.", evidenceRefs: [], peopleNamed: [], people }).ok,
    ).toBe(false);
    expect(
      validatePeopleUse({ artifact: "x", evidenceRefs: ["person:zzz"], peopleNamed: [], people }).ok,
    ).toBe(false);
  });
});
