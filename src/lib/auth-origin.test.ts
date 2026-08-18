import { describe, expect, it } from "vitest";

import {
  CANONICAL_APP_ORIGIN,
  authRedirectUrl,
  isTrustedAuthOrigin,
  resolveAuthOrigin,
  sanitizeReturnPath,
  signInUrlFor,
} from "./auth-origin";

describe("origin selection", () => {
  it("keeps production on production", () => {
    expect(resolveAuthOrigin("https://cmd.trusttai.com")).toBe("https://cmd.trusttai.com");
  });

  it("lets a preview return to its own preview origin", () => {
    const preview = "https://id-preview--65944e34-ede5-4757-befb-870e1ff97444.lovable.app";
    expect(resolveAuthOrigin(preview)).toBe(preview);
  });

  it("falls back to the canonical origin, never a preview host", () => {
    expect(resolveAuthOrigin(null)).toBe(CANONICAL_APP_ORIGIN);
    expect(resolveAuthOrigin("https://evil.example.com")).toBe(CANONICAL_APP_ORIGIN);
    expect(CANONICAL_APP_ORIGIN).not.toContain("lovable.app");
  });

  it("refuses untrusted and insecure origins", () => {
    expect(isTrustedAuthOrigin("https://cmd.trusttai.com.evil.com")).toBe(false);
    expect(isTrustedAuthOrigin("http://cmd.trusttai.com")).toBe(false);
    expect(isTrustedAuthOrigin("https://notlovable.app.evil.com")).toBe(false);
    expect(isTrustedAuthOrigin("javascript:alert(1)")).toBe(false);
    expect(isTrustedAuthOrigin("http://localhost:8080")).toBe(true);
  });
});

describe("returnTo sanitisation", () => {
  it("preserves a deep link path", () => {
    expect(sanitizeReturnPath("/modules/projects")).toBe("/modules/projects");
    expect(sanitizeReturnPath("/modules/projects?tab=work")).toBe("/modules/projects?tab=work");
  });

  it("collapses anything that could be an open redirect", () => {
    for (const bad of [
      "https://evil.example.com",
      "//evil.example.com",
      "/\\evil.example.com",
      "javascript:alert(1)",
      "modules/projects",
      undefined,
      42,
    ]) {
      expect(sanitizeReturnPath(bad)).toBe("/");
    }
  });
});

describe("auth URLs", () => {
  it("builds a same-origin callback carrying the sanitized path", () => {
    expect(authRedirectUrl("/modules/projects", "https://cmd.trusttai.com")).toBe(
      "https://cmd.trusttai.com/auth/callback?redirect=%2Fmodules%2Fprojects",
    );
  });

  it("never leaks an external destination into the callback", () => {
    const url = authRedirectUrl("https://evil.example.com", "https://cmd.trusttai.com");
    expect(url).toBe("https://cmd.trusttai.com/auth/callback?redirect=%2F");
  });

  it("keeps invitation sign-in links on a trusted origin", () => {
    expect(signInUrlFor("sarah@trusttai.com", "https://worker.internal")).toBe(
      `${CANONICAL_APP_ORIGIN}/auth?email=sarah%40trusttai.com`,
    );
  });
});
