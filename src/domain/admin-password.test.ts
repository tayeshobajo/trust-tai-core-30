import { describe, expect, it } from "vitest";

import {
  PASSWORD_MIN_LENGTH,
  canManagePasswords,
  humanAuthError,
  refusePasswordAction,
  validatePassword,
} from "./admin-password";

describe("password policy", () => {
  it("matches the project's Auth minimum", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(6);
    expect(validatePassword("abc12", "abc12").ok).toBe(false);
    expect(validatePassword("abc123", "abc123").ok).toBe(true);
  });

  it("refuses a mismatch and an empty value", () => {
    expect(validatePassword("abc123", "abc124")).toEqual({
      ok: false,
      because: "The two passwords do not match.",
    });
    expect(validatePassword("", "")).toEqual({ ok: false, because: "Enter a password." });
  });
});

describe("authority", () => {
  it("allows an active owner and admin only", () => {
    expect(canManagePasswords({ role: "owner", active: true })).toBe(true);
    expect(canManagePasswords({ role: "admin", active: true })).toBe(true);
    expect(canManagePasswords({ role: "member", active: true })).toBe(false);
    expect(canManagePasswords({ role: "viewer", active: true })).toBe(false);
    expect(canManagePasswords({ role: "owner", active: false })).toBe(false);
    expect(canManagePasswords({ role: null, active: true })).toBe(false);
  });

  it("refuses an ordinary member (case D)", () => {
    expect(
      refusePasswordAction({
        actorRole: "member",
        actorActive: true,
        actorOrganizationId: "org-1",
        organizationId: "org-1",
      }),
    ).toMatch(/owner or admin/i);
  });

  it("refuses a cross-organization attempt (case E)", () => {
    expect(
      refusePasswordAction({
        actorRole: "owner",
        actorActive: true,
        actorOrganizationId: "org-1",
        organizationId: "org-2",
      }),
    ).toMatch(/your own workspace/i);

    expect(
      refusePasswordAction({
        actorRole: "owner",
        actorActive: true,
        actorOrganizationId: "org-1",
        organizationId: "org-1",
        targetOrganizationId: "org-2",
      }),
    ).toMatch(/another workspace/i);
  });

  it("refuses a caller with no membership at all", () => {
    expect(
      refusePasswordAction({
        actorRole: "owner",
        actorActive: true,
        actorOrganizationId: null,
        organizationId: "org-1",
      }),
    ).toBeTruthy();
  });

  it("allows an active owner in their own organization", () => {
    expect(
      refusePasswordAction({
        actorRole: "owner",
        actorActive: true,
        actorOrganizationId: "org-1",
        organizationId: "org-1",
        targetOrganizationId: "org-1",
      }),
    ).toBeNull();
  });
});

describe("human errors (case F)", () => {
  it("explains a duplicate email", () => {
    expect(
      humanAuthError({ status: 422, code: "email_exists", message: "email already registered" }),
    ).toMatch(/already signs in/i);
  });

  it("explains a weak password", () => {
    expect(
      humanAuthError({
        status: 422,
        code: "weak_password",
        message: "Password should be at least 6 characters.",
      }),
    ).toMatch(/at least 6 characters/i);
  });

  it("explains an expired session and an unknown failure", () => {
    expect(humanAuthError({ status: 401 })).toMatch(/sign in again/i);
    expect(humanAuthError({ status: 500 })).toMatch(/nothing was altered/i);
  });
});
