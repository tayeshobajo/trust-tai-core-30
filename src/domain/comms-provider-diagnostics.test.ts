import { describe, expect, it } from "vitest";

import {
  categorizeProviderError,
  diagnosticStages,
  diagnosticsLogLine,
  providerDiagnostics,
} from "@/domain/comms-provider-diagnostics";

class FakeProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderCallFailedError";
  }
}

describe("classifying a provider failure", () => {
  it("reads a status before anything else", () => {
    expect(categorizeProviderError({ status: 401 })).toBe("auth");
    expect(categorizeProviderError({ status: 402 })).toBe("quota");
    expect(categorizeProviderError({ status: 429 })).toBe("rate_limited");
    expect(categorizeProviderError({ status: 400 })).toBe("bad_request");
    expect(categorizeProviderError({ status: 503 })).toBe("upstream_error");
  });

  it("falls back to the shape of the message when there is no status", () => {
    // This is the live shape: the stream reported response.failed with no
    // HTTP status attached, which is how run b7bee2e2 was recorded.
    expect(
      categorizeProviderError({
        message: "The reasoning run failed before returning anything.",
      }),
    ).toBe("refused");
    expect(categorizeProviderError({ message: "insufficient_quota" })).toBe("quota");
    expect(categorizeProviderError({ message: "fetch failed" })).toBe("network");
  });

  it("names a missing provider as such, never as a refusal", () => {
    expect(categorizeProviderError({ notConfigured: true })).toBe("not_configured");
  });
});

describe("the sanitized record kept with a failed run", () => {
  it("carries provider, model, status and category, and no message", () => {
    const diagnostics = providerDiagnostics({
      error: new FakeProviderError("Bearer sk-live-secret rejected", 401),
      configured: { provider: "openai", model: "gpt-5-mini" },
    });
    expect(diagnostics).toEqual({
      provider: "openai",
      model: "gpt-5-mini",
      status: 401,
      category: "auth",
      errorName: "ProviderCallFailedError",
    });
    const line = diagnosticsLogLine("comms-review", diagnostics);
    expect(line).toContain("status=401");
    expect(line).toContain("category=auth");
    expect(line).not.toContain("sk-live-secret");
  });

  it("reproduces the live failure as recordable stages", () => {
    const diagnostics = providerDiagnostics({
      error: new FakeProviderError("The reasoning run failed before returning anything."),
      configured: { provider: "openai", model: "gpt-5-mini" },
    });
    expect(diagnostics.category).toBe("refused");
    expect(diagnosticStages(diagnostics)).toEqual([
      "provider:openai",
      "model:gpt-5-mini",
      "provider_status:none",
      "provider_error:refused",
    ]);
  });

  it("says none rather than guessing when no provider is configured", () => {
    const diagnostics = providerDiagnostics({
      error: new Error("No intelligence provider is configured"),
      configured: { provider: null, model: null },
      notConfigured: true,
    });
    expect(diagnosticStages(diagnostics)).toContain("provider:none");
    expect(diagnostics.category).toBe("not_configured");
  });
});
