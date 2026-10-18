import { beforeEach, describe, expect, it, vi } from "vitest";

// The provider module builds on the existing intelligence runtime boundary;
// these tests mock that boundary so NO real provider call ever happens.
const mockCall = vi.fn();
const mockRuntimeModelCaller = vi.fn();
const mockRuntimeProviderStatus = vi.fn();

vi.mock("@/lib/intelligence-runtime.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/intelligence-runtime.server")>();
  return {
    ...actual,
    runtimeModelCaller: (...args: unknown[]) => mockRuntimeModelCaller(...args),
    runtimeProviderStatus: () => mockRuntimeProviderStatus(),
  };
});

import {
  canonicalRunProviderStatus,
  createCanonicalRunProvider,
} from "./steward-canonical-run.provider.server";

const SNAPSHOT_INPUT = {
  action: "prepare_brief" as const,
  taskTitle: "Prepare the Soji roadmap handoff",
  inputs: [{ kind: "transcript", id: "conv-1", content: "stored transcript content", revision: 3 }],
};

beforeEach(() => {
  mockCall.mockReset();
  mockRuntimeModelCaller.mockReset();
  mockRuntimeProviderStatus.mockReset();
  mockRuntimeProviderStatus.mockReturnValue({ configured: true });
  mockRuntimeModelCaller.mockResolvedValue(mockCall);
});

describe("canonicalRunProviderStatus", () => {
  it("reports unavailable with an honest reason when no provider is configured", () => {
    mockRuntimeProviderStatus.mockReturnValue({ configured: false });
    const status = canonicalRunProviderStatus();
    expect(status.configured).toBe(false);
    expect(status.reason).toMatch(/unavailable/i);
  });

  it("reports configured when the runtime has a provider", () => {
    expect(canonicalRunProviderStatus()).toEqual({ configured: true, reason: null });
  });
});

describe("createCanonicalRunProvider", () => {
  it("throws before any call when no provider is configured", () => {
    mockRuntimeProviderStatus.mockReturnValue({ configured: false });
    expect(() => createCanonicalRunProvider({ token: "t", organizationId: "o" })).toThrow(
      /no provider configured/i,
    );
    expect(mockRuntimeModelCaller).not.toHaveBeenCalled();
  });

  it("returns the artifact text from a valid strict-JSON response", async () => {
    mockCall.mockResolvedValue({
      raw: JSON.stringify({ artifact: "Brief draft", evidence_refs: ["input:1"] }),
    });
    const provider = createCanonicalRunProvider({ token: "t", organizationId: "o" });
    const out = await provider.generate(SNAPSHOT_INPUT);
    expect(out.text).toBe("Brief draft");
    // Snapshot context only: web search is always off.
    expect(mockCall).toHaveBeenCalledWith(expect.objectContaining({ webSearch: false }));
  });

  it("rejects evidence refs outside the supplied inputs", async () => {
    mockCall.mockResolvedValue({
      raw: JSON.stringify({ artifact: "Brief", evidence_refs: ["input:99"] }),
    });
    const provider = createCanonicalRunProvider({ token: "t", organizationId: "o" });
    await expect(provider.generate(SNAPSHOT_INPUT)).rejects.toThrow(/outside the supplied inputs/i);
  });

  it("rejects an empty artifact", async () => {
    mockCall.mockResolvedValue({ raw: JSON.stringify({ artifact: "  ", evidence_refs: [] }) });
    const provider = createCanonicalRunProvider({ token: "t", organizationId: "o" });
    await expect(provider.generate(SNAPSHOT_INPUT)).rejects.toThrow(/no usable artifact/i);
  });

  it("rejects an unreadable provider response", async () => {
    mockCall.mockResolvedValue({ raw: "not json at all" });
    const provider = createCanonicalRunProvider({ token: "t", organizationId: "o" });
    await expect(provider.generate(SNAPSHOT_INPUT)).rejects.toThrow(/unreadable/i);
  });

  it("times out a hanging provider call instead of running forever", async () => {
    mockCall.mockReturnValue(new Promise(() => {})); // never resolves
    const provider = createCanonicalRunProvider({
      token: "t",
      organizationId: "o",
      timeoutMs: 25,
    });
    await expect(provider.generate(SNAPSHOT_INPUT)).rejects.toThrow(/timed out/i);
  });
});
