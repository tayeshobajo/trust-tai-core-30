import { describe, expect, it } from "vitest";

import { canonDomainsForQuestion } from "./relevance";

describe("canon relevance", () => {
  it("scopes a delivery question to delivery", () => {
    expect(canonDomainsForQuestion("Why is delivery slow?")).toEqual(["delivery"]);
  });

  it("scopes a bottleneck question to the founder and commitments", () => {
    expect(canonDomainsForQuestion("Am I becoming the bottleneck?")).toEqual([
      "founder",
      "commitments",
    ]);
  });

  it("leaves a general question open to the whole canon", () => {
    expect(canonDomainsForQuestion("What deserves my attention today?")).toBeUndefined();
    expect(canonDomainsForQuestion("What is quietly getting worse?")).toBeUndefined();
  });

  it("says nothing about an empty question", () => {
    expect(canonDomainsForQuestion("   ")).toBeUndefined();
  });
});
