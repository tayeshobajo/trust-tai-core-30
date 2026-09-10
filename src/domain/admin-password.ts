/**
 * Trust Tai OS, admin-managed passwords.
 *
 * A small, pure contract shared by the People & access screen and the
 * server-only endpoint that performs the Supabase Auth mutation. It decides
 * two things and nothing else:
 *
 *   1. Is this password acceptable to this project's Auth policy?
 *   2. Is this person allowed to set it, here, for that person?
 *
 * Locked law: convenience must not weaken auth boundaries. Every helper here
 * fails closed, and none of them ever receives a place to store a password.
 * The plaintext exists only in the request that sets it.
 */

import { MANAGING_ROLES, normalizeRole, type WorkspaceRole } from "./access";

/**
 * The live Supabase Auth policy for this project: length only, minimum six.
 * Verified against the project's own Auth endpoint rather than assumed.
 */
export const PASSWORD_MIN_LENGTH = 6;

export const PASSWORD_HELP =
  "At least 6 characters, this workspace's sign-in policy. A longer passphrase is better.";

export type Refusal = { ok: false; because: string };
export type Allowed = { ok: true };
export type Verdict = Allowed | Refusal;

const allow: Allowed = { ok: true };
const refuse = (because: string): Refusal => ({ ok: false, because });

/** Is this password acceptable, and does the confirmation match? */
export function validatePassword(password: string, confirmation: string): Verdict {
  if (!password) return refuse("Enter a password.");
  if (password.length < PASSWORD_MIN_LENGTH) {
    return refuse(`That password is too short. ${PASSWORD_HELP}`);
  }
  if (password !== confirmation) return refuse("The two passwords do not match.");
  return allow;
}

/** Roles allowed to set another person's password. Mirrors org management. */
export const PASSWORD_MANAGING_ROLES: WorkspaceRole[] = MANAGING_ROLES;

export function canManagePasswords(input: {
  role: string | null | undefined;
  active: boolean;
}): boolean {
  if (!input.active) return false;
  return PASSWORD_MANAGING_ROLES.includes(normalizeRole(input.role));
}

/**
 * The full authority test for an admin password action. Returns `null` when the
 * action may proceed, or a human sentence explaining the refusal.
 */
export function refusePasswordAction(input: {
  actorRole: string | null | undefined;
  actorActive: boolean;
  actorOrganizationId: string | null | undefined;
  /** The organization the action is being performed in. */
  organizationId: string;
  /** The organization the target person belongs to, when they already exist. */
  targetOrganizationId?: string | null;
}): string | null {
  if (!input.actorOrganizationId || input.actorOrganizationId !== input.organizationId) {
    return "You can only manage people in your own workspace.";
  }
  if (!canManagePasswords({ role: input.actorRole, active: input.actorActive })) {
    return "Only an active owner or admin can set a workspace password.";
  }
  if (
    input.targetOrganizationId !== undefined &&
    input.targetOrganizationId !== null &&
    input.targetOrganizationId !== input.organizationId
  ) {
    return "That person belongs to another workspace.";
  }
  return null;
}

/** Turn a Supabase Auth failure into something a person can act on. */
export function humanAuthError(input: {
  status: number;
  code?: string | null;
  message?: string | null;
}): string {
  const code = (input.code ?? "").toLowerCase();
  const message = (input.message ?? "").toLowerCase();
  if (code === "weak_password" || message.includes("password should be")) {
    return `That password was refused. ${PASSWORD_HELP}`;
  }
  if (
    code === "email_exists" ||
    code === "user_already_exists" ||
    message.includes("already been registered") ||
    message.includes("already registered") ||
    message.includes("already exists")
  ) {
    return "Someone already signs in with that email. Add them to this workspace or reset their password instead.";
  }
  if (input.status === 401 || input.status === 403) {
    return "Sign in again, that session no longer has authority for this action.";
  }
  if (input.status === 422) return "That email or password was refused by sign-in.";
  return "Sign-in could not complete that change. Nothing was altered.";
}
