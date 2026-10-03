import { describe, it, expect } from "vitest";
import { dayBounds, projectOutbound } from "./live";
const row = { organization_id: "org", provider: "gmail", provider_message_id: "one", direction: "outbound", from_email: "a@example.com", occurred_at: "2026-10-03T00:00:00Z", provenance: { mailbox: "a@example.com" }, relationship_id: null, thread_id: null };
describe("Outreach observation boundary", () => {
  it("retains original Chicago reporting day and null assignments", () => {
    expect(projectOutbound([row], "org", "2026-10-02").rows).toHaveLength(1);
    expect(projectOutbound([row], "org", "2026-10-03").rows).toHaveLength(0);
    expect(projectOutbound([row], "org", "2026-10-02").rows[0]?.relationship).toBeNull();
  });
  it("uses 23 and 25 hour DST days", () => {
    for (const [day, hours] of [["2026-03-08",23],["2026-11-01",25]] as const) {
      const b = dayBounds(day); expect(Date.parse(b.end)-Date.parse(b.start)).toBe(hours*3600000);
    }
  });
  it("rejects invalid dates", () => expect(() => dayBounds("2026-02-30")).toThrow());
  it("rejects cross-org, inbound, hostile provenance, mailbox mismatch and offsetless time", () => {
    for (const patch of [{organization_id:"other"},{direction:"inbound"},{provenance:[]},{provenance:{mailbox:"other@example.com"}},{occurred_at:"2026-10-02T12:00:00"}]) expect(projectOutbound([{...row,...patch}],"org","2026-10-02").rows).toHaveLength(0);
  });
  it("deduplicates and holds conflicting identities in either order", () => {
    expect(projectOutbound([row,row],"org","2026-10-02").rows).toHaveLength(1);
    const other = {...row, relationship_id:"different"};
    for (const rows of [[row,other],[other,row]]) expect(projectOutbound(rows,"org","2026-10-02").rows).toHaveLength(0);
  });
});
