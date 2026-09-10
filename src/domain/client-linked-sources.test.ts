import { describe, expect, it } from "vitest";

import { linkedSourcesFrom } from "./client-linked-sources";
import type { ProjectConnection, ThinkingSource } from "./project-intelligence";

const thinking: ThinkingSource = {
  id: "ts-1",
  organizationId: "org-1",
  projectId: "proj-1",
  sourceType: "google_doc",
  title: "July 09 alignment notes",
  url: "https://docs.google.com/document/d/abc/edit",
  isPrimary: false,
  syncState: "link_saved",
  createdAt: "2026-09-01T00:00:00.000Z",
};

const figma: ProjectConnection = {
  id: "pc-1",
  organizationId: "org-1",
  projectId: "proj-1",
  connectionType: "other",
  label: "Figma prototype",
  url: "https://www.figma.com/proto/abc",
  status: "linked",
  createdAt: "2026-09-02T00:00:00.000Z",
};

describe("linkedSourcesFrom", () => {
  it("reads both canonical stores, newest first", () => {
    const sources = linkedSourcesFrom([thinking], [figma]);
    expect(sources.map((source) => source.id)).toEqual(["pc-1", "ts-1"]);
    expect(sources[1]?.kindLabel).toBe("Google Doc");
    expect(sources[1]?.stateLabel).toBe("Link saved");
    expect(sources[0]?.store).toBe("connection");
  });

  it("leaves out a connection that has no address", () => {
    const { url: _url, ...rest } = figma;
    const noUrl: ProjectConnection = { ...rest, id: "pc-2" };
    expect(linkedSourcesFrom([], [noUrl])).toEqual([]);
  });

  it("invents nothing when nothing is linked", () => {
    expect(linkedSourcesFrom([], [])).toEqual([]);
  });
});
