import { describe, expect, it } from "vitest";

import {
  canonicalUrl,
  checkResourceUrl,
  filterResources,
  findDuplicate,
  groupByProject,
  pinnedShortcuts,
  scopeLabel,
  type ClientResource,
} from "./client-resources";

function resource(patch: Partial<ClientResource>): ClientResource {
  return {
    id: "r-1",
    organizationId: "org-1",
    clientId: "client-1",
    projectId: null,
    category: "lovable_project",
    title: "Main build",
    url: "https://lovable.dev/projects/one",
    description: null,
    meetingDate: null,
    createdAt: "2026-09-18T09:00:00.000Z",
    createdBy: "user-1",
    ...patch,
  };
}

const names = { "proj-1": "Website rebuild", "proj-2": "Onboarding app" };

describe("checkResourceUrl", () => {
  it("accepts an ordinary web address", () => {
    expect(checkResourceUrl(" https://docs.google.com/document/d/abc ")).toEqual({
      ok: true,
      url: "https://docs.google.com/document/d/abc",
    });
  });

  it("refuses script, data and file addresses", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd"]) {
      expect(checkResourceUrl(bad).ok).toBe(false);
    }
  });

  it("refuses an address carrying a credential", () => {
    const check = checkResourceUrl("https://user:secret@example.com/folder");
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.problem).toMatch(/credential/i);
  });

  it("refuses nothing at all", () => {
    expect(checkResourceUrl("   ").ok).toBe(false);
  });
});

describe("canonicalUrl", () => {
  it("normalises only the parts that are case-insensitive by definition", () => {
    expect(canonicalUrl("HTTPS://Docs.Google.com/document/d/AbC")).toBe(
      "https://docs.google.com/document/d/AbC",
    );
  });

  it("keeps a trailing slash as written, because it can mean another page", () => {
    expect(canonicalUrl("https://example.com/space")).not.toBe(
      canonicalUrl("https://example.com/space/"),
    );
  });
});

describe("duplicates", () => {
  const existing = [resource({ id: "a", projectId: "proj-1" })];

  it("catches the exact same address in the same scope", () => {
    const hit = findDuplicate(existing, {
      url: "https://lovable.dev/projects/one/",
      projectId: "proj-1",
    });
    expect(hit?.id).toBe("a");
  });

  it("allows the same address on another project", () => {
    expect(
      findDuplicate(existing, { url: "https://lovable.dev/projects/one", projectId: "proj-2" }),
    ).toBeNull();
  });

  it("ignores the record being edited", () => {
    expect(
      findDuplicate(
        existing,
        { url: "https://lovable.dev/projects/one", projectId: "proj-1" },
        "a",
      ),
    ).toBeNull();
  });
});

describe("filtering and grouping", () => {
  const all = [
    resource({ id: "wide", title: "Account knowledge base", category: "knowledge_base" }),
    resource({ id: "p1", projectId: "proj-1", title: "Rebuild build" }),
    resource({ id: "p2", projectId: "proj-2", title: "Onboarding build" }),
  ];

  it("shows a project's own resources plus the client-wide ones", () => {
    const shown = filterResources(all, { projectId: "proj-1", query: "", category: "all" });
    expect(shown.map((item) => item.id)).toEqual(["wide", "p1"]);
  });

  it("searches title, kind and project name", () => {
    expect(
      filterResources(all, { projectId: "all", query: "onboarding", category: "all" }, names).map(
        (item) => item.id,
      ),
    ).toEqual(["p2"]);
    expect(
      filterResources(all, { projectId: "all", query: "knowledge base", category: "all" }).map(
        (item) => item.id,
      ),
    ).toEqual(["wide"]);
  });

  it("filters by kind", () => {
    expect(
      filterResources(all, { projectId: "all", query: "", category: "knowledge_base" }).map(
        (item) => item.id,
      ),
    ).toEqual(["wide"]);
  });

  it("groups client-wide first, then projects", () => {
    const groups = groupByProject(all, names);
    expect(groups.map((group) => group.label)).toEqual([
      "Client-wide",
      "Onboarding app",
      "Website rebuild",
    ]);
  });

  it("labels scope in plain words", () => {
    expect(scopeLabel(all[0]!, names)).toBe("Client-wide");
    expect(scopeLabel(all[1]!, names)).toBe("Website rebuild");
  });
});

describe("pinned shortcuts", () => {
  it("pins every Lovable, knowledge base and chat link, not one of each", () => {
    const shortcuts = pinnedShortcuts(
      [
        resource({ id: "a", title: "Build", projectId: "proj-1" }),
        resource({ id: "b", title: "Build", projectId: "proj-2" }),
        resource({ id: "c", title: "Working chat", category: "chat" }),
        resource({ id: "d", title: "A recording", category: "meeting_recording" }),
      ],
      names,
    );
    expect(shortcuts.map((shortcut) => shortcut.label)).toEqual([
      "Build (Website rebuild)",
      "Build (Onboarding app)",
      "Working chat",
    ]);
  });
});

describe("duplicates are case aware after the host", () => {
  const existing = [
    resource({ id: "doc", url: "https://docs.google.com/document/d/DocA", projectId: null }),
    resource({ id: "q", url: "https://example.com/report?id=AbC", projectId: null }),
  ];

  it("treats /DocA and /doca as different documents", () => {
    expect(
      findDuplicate(existing, { url: "https://docs.google.com/document/d/doca", projectId: null }),
    ).toBeNull();
  });

  it("treats a query token as case significant", () => {
    expect(
      findDuplicate(existing, { url: "https://example.com/report?id=abc", projectId: null }),
    ).toBeNull();
  });

  it("still catches the same address written with a different scheme or host case", () => {
    expect(
      findDuplicate(existing, {
        url: "HTTPS://Docs.Google.com/document/d/DocA",
        projectId: null,
      })?.id,
    ).toBe("doc");
  });

  it("allows that same address on one of this client's projects", () => {
    expect(
      findDuplicate(existing, {
        url: "https://docs.google.com/document/d/DocA",
        projectId: "proj-1",
      }),
    ).toBeNull();
  });
});
