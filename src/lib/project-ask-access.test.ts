/**
 * Project Chat fails closed.
 *
 * Access is decided at the shared runtime boundary, before a provider is ever
 * reached. A caller the boundary refuses gets one plain sentence, and no
 * model call happens at all.
 */

import { describe, expect, it, vi } from "vitest";

const runtimeModelCaller = vi.fn();

vi.mock("./intelligence-runtime.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./intelligence-runtime.server")>();
  return { ...actual, runtimeModelCaller };
});

const { askProject } = await import("./project-intelligence.server");

const INPUT = {
  token: "not-a-session",
  organizationId: "org-1",
  projectLabel: "Mental Dental Academy",
  question: "Where is this stuck?",
  packet: {},
};

describe("askProject access", () => {
  it("refuses when the boundary refuses, without reaching a provider", async () => {
    runtimeModelCaller.mockRejectedValueOnce(new Error("forbidden"));
    await expect(askProject(INPUT)).rejects.toThrow(/do not have access/i);
  });

  it("asks the boundary for the projects room and an existing purpose", async () => {
    runtimeModelCaller.mockResolvedValueOnce(async () => ({
      raw: JSON.stringify({ answer: "ok" }),
      provider: "test",
      model: "test",
    }));
    await askProject(INPUT);
    expect(runtimeModelCaller).toHaveBeenLastCalledWith(
      expect.objectContaining({ room: "projects", purpose: "research" }),
    );
  });
});
