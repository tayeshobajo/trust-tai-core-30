import { describe, expect, it } from "vitest";

import { ClientResourceNotHere, missingSchema, toResource } from "./client-resources-store.server";

describe("client resources store", () => {
  it("reads a missing table as a gap, not as an empty healthy list", () => {
    expect(missingSchema({ code: "42P01", message: "relation does not exist" })).toBe(true);
    expect(missingSchema({ code: "PGRST205", message: "Could not find the table" })).toBe(true);
    expect(missingSchema({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(missingSchema(null)).toBe(false);
  });

  it("maps a stored row, keeping client-wide scope as null rather than a guess", () => {
    const resource = toResource({
      id: "r-1",
      organization_id: "org-1",
      client_id: "client-1",
      project_id: null,
      category: "knowledge_base",
      title: "Account knowledge base",
      url: "https://notion.so/space",
      description: null,
      meeting_date: null,
      created_at: "2026-09-18T10:00:00.000Z",
      created_by: "user-1",
    });
    expect(resource.projectId).toBeNull();
    expect(resource.category).toBe("knowledge_base");
  });

  it("falls back to Other for a category this build does not know", () => {
    expect(toResource({ category: "something_new" }).category).toBe("other");
  });
});

describe("refusals", () => {
  it("has a distinct refusal for a link that is not on this company", () => {
    const error = new ClientResourceNotHere();
    expect(error.name).toBe("ClientResourceNotHere");
    expect(error.message).toMatch(/nothing was removed/i);
  });
});
