import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: {},
}));

const { decideBriefPersistence } = await import("./studio-brief-service");

describe("Studio brief persistence choice", () => {
  it("updates an existing brief by its durable id", () => {
    expect(decideBriefPersistence({ id: "brief-1", sourceOpportunityId: "opportunity-1" })).toEqual({
      operation: "update",
    });
  });

  it("upserts a new opportunity brief on the organization and opportunity pair", () => {
    expect(decideBriefPersistence({ id: "", sourceOpportunityId: "opportunity-1" })).toEqual({
      operation: "upsert",
      onConflict: "organization_id,source_opportunity_id",
    });
  });

  it("inserts a new brief without a source opportunity", () => {
    expect(decideBriefPersistence({ id: "", sourceOpportunityId: null })).toEqual({
      operation: "insert",
    });
  });
});