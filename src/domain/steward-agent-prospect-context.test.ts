import { describe, expect, it } from "vitest";

import { toProspectContext, validateProspectRefs } from "./steward-agent-prospect-context";

describe("prospect context for the AI teammate", () => {
  it("P1/P3 supplies recorded facts and lists empty ones as unknown", () => {
    const ctx = toProspectContext({ id: "x", name: "Synthetic Co", industry: "Health", website_url: "", stage: null, secret: "no" });
    expect(ctx?.facts.map((f) => f.ref)).toEqual(["prospect:x:industry"]);
    expect(ctx?.unknown).toEqual(["Website", "Scout stage"]);
    expect(JSON.stringify(ctx)).not.toContain("secret");
  });

  it("P2 rejects invented company refs", () => {
    const ctx = toProspectContext({ id: "x", name: "Co", industry: "Health" });
    expect(validateProspectRefs(["prospect:x:industry", "person:1"], ctx).ok).toBe(true);
    expect(validateProspectRefs(["prospect:x:revenue"], ctx).ok).toBe(false);
    expect(validateProspectRefs(["prospect:y"], null).ok).toBe(false);
  });

  it("no row means no context", () => {
    expect(toProspectContext(null)).toBeNull();
  });
});
