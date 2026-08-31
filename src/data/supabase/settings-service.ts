/**
 * Trust Tai OS, Settings persistence.
 *
 * Settings never invents a second identity model. People are
 * `profiles` + `organization_memberships`, organizations are `organizations`,
 * and history is the shared `activities` stream. Only genuinely new persistent
 * state lives in the Settings tables (see docs/settings-schema.sql):
 *
 *   organization_app_settings     organization-level app on/off
 *   member_app_access             per-person visibility/authority override
 *   organization_invitations      pending invitations
 *   user_notification_preferences per-person notification choices
 *
 * If those tables have not been applied yet, every reader returns
 * `provisioned: false` rather than throwing, and the UI says so plainly.
 * Nothing is faked and nothing is granted by accident.
 */

import type { PostgrestError } from "@supabase/supabase-js";

import { supabase } from "@/integrations/trust-tai/supabase";
import { normalizeAccessLevel, type AppAccessLevel } from "@/domain/app-access";
import { normalizeRole, type WorkspaceRole } from "@/domain/access";

import { supabaseActivity } from "./activities";
import { writeTolerant, type Row } from "./schema";

/** A relation the deployment has not created yet. Read as "not provisioned". */
export function missingRelation(error: PostgrestError | null): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST202") return true;
  return /does not exist|schema cache/i.test(`${error.message} ${error.details ?? ""}`);
}

export interface Provisioned<T> {
  provisioned: boolean;
  value: T;
}

const notProvisioned = <T>(value: T): Provisioned<T> => ({ provisioned: false, value });

/* ------------------------------------------------------------------ people */

export interface MemberProfile {
  userId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  role: WorkspaceRole;
  status: "active" | "deactivated" | "invited" | string;
  /**
   * When Supabase Auth last saw this person sign in. Authoritative, read
   * server-side from auth.users — never mirrored into a workspace column.
   */
  lastSignInAt: string | null;
  /** When the sign-in account itself was created. */
  accountCreatedAt: string | null;
  /**
   * In-app activity, which is a different truth from signing in. Only set
   * when the workspace genuinely records it; never a sign-in timestamp.
   */
  lastActivityAt: string | null;
  /** The room they were last seen working in, when presence is recorded. */
  lastActivityApp: string | null;
  /** Per-app overrides recorded for this person. Empty means "role default". */
  access: Record<string, AppAccessLevel>;
}


function nameOf(row: Row, email: string): string {
  const candidate =
    (row["full_name"] as string | null) ??
    (row["preferred_name"] as string | null) ??
    (row["display_name"] as string | null) ??
    null;
  const value = (candidate ?? "").trim();
  if (value) return value;
  return email.split("@")[0] ?? "Member";
}

/**
 * Names and emails for everyone in the workspace, read server-side.
 *
 * A signed-in person can only read their own profile row, so the list would
 * otherwise show blanks for everybody else. The governed endpoint verifies the
 * caller is an active owner or admin of this organization before it answers,
 * and it returns identity only — never a credential.
 */
export interface DirectoryPerson {
  userId: string;
  email: string;
  name: string;
  jobTitle: string | null;
  avatarUrl: string | null;
  /** From auth.users.last_sign_in_at. Null means never signed in. */
  lastSignInAt: string | null;
  /** From auth.users.created_at. */
  createdAt: string | null;
  emailConfirmedAt: string | null;
}


export async function readMemberDirectory(
  organizationId: string,
): Promise<Map<string, DirectoryPerson>> {
  const outcome = (await callAdminPassword({ action: "directory", organizationId })) as
    | (AdminPasswordResult & { people?: DirectoryPerson[] })
    | null;
  const people = outcome?.ok ? (outcome.people ?? []) : [];
  return new Map(people.map((person) => [person.userId, person]));
}

/** A human naming another person in the workspace. Owner/admin only. */
export async function saveMemberIdentity(input: {
  organizationId: string;
  userId: string;
  email: string;
  fullName: string;
  jobTitle?: string;
  actorUserId: string;
}): Promise<AdminPasswordResult> {
  const outcome = await callAdminPassword({
    action: "set_identity",
    organizationId: input.organizationId,
    userId: input.userId,
    fullName: input.fullName,
    jobTitle: input.jobTitle ?? "",
  });
  if (outcome.ok) {
    await audit({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      name: "user.identity_updated",
      subject: { type: "user", id: input.userId, label: input.email || input.fullName },
      summary: `${input.email || input.userId} is now named ${input.fullName}.`,
      payload: { lifecycle: "other", full_name: input.fullName },
    });
  }
  return outcome;
}

/**
 * Take someone out of the workspace.
 *
 * "revoke" ends their access and keeps everything else. "delete_account" also
 * deletes the sign-in credential so the address can be provisioned again — the
 * person's records (contacts, prospects, messages, decisions, history) are
 * never deleted either way, and who they were is written into the append-only
 * history before the credential goes.
 */
export async function removeMember(input: {
  organizationId: string;
  userId: string;
  mode: "revoke" | "delete_account";
}): Promise<AdminPasswordResult> {
  return callAdminPassword({
    action: "remove_member",
    organizationId: input.organizationId,
    userId: input.userId,
    mode: input.mode,
  });
}

export async function listMembers(organizationId: string): Promise<MemberProfile[]> {
  const memberships = await supabase
    .from("organization_memberships")
    .select("*")
    .eq("organization_id", organizationId);
  if (memberships.error) throw new Error(memberships.error.message);

  const rows = (memberships.data ?? []) as Row[];
  const ids = rows.map((row) => String(row["user_id"]));
  if (ids.length === 0) return [];

  const profiles = await supabase.from("profiles").select("*").in("id", ids);
  if (profiles.error) throw new Error(profiles.error.message);
  const byId = new Map<string, Row>(
    ((profiles.data ?? []) as Row[]).map((row) => [String(row["id"]), row]),
  );

  const overrides = await readMemberAccess(organizationId);
  const directory = await readMemberDirectory(organizationId).catch(
    () => new Map<string, DirectoryPerson>(),
  );
  /* In-app presence is a separate truth from signing in. */
  const { readMemberPresence } = await import("./member-activity");
  const presence = await readMemberPresence(organizationId).catch(() => ({
    provisioned: false,
    value: new Map<string, { userId: string; lastActivityAt: string; appKey: string }>(),
  }));

  return rows
    .map((row) => {
      const userId = String(row["user_id"]);
      const profile = byId.get(userId) ?? {};
      const known = directory.get(userId);
      /* Auth is the authority for the address a person signs in with. */
      const email = (known?.email ?? "") || String(profile["email"] ?? "");
      const derived = nameOf(profile, email);
      return {
        userId,
        email,
        /* A canonical email is always enough to name somebody: the local part
           is a real, stable label. "Unnamed person" is reserved for a record
           with neither a name nor an address. */
        name: known?.name || derived || email || "Unnamed person",
        avatarUrl: (profile["avatar_url"] as string | null) ?? known?.avatarUrl ?? null,
        jobTitle: (profile["job_title"] as string | null) ?? known?.jobTitle ?? null,
        role: normalizeRole(row["role"] as string | null),
        status: String(row["status"] ?? "active"),
        lastSignInAt: known?.lastSignInAt ?? null,
        accountCreatedAt: known?.createdAt ?? null,
        /* Only real product activity, if the deployment records any. */
        lastActivityAt: presence.value.get(userId)?.lastActivityAt ?? null,
        lastActivityApp: presence.value.get(userId)?.appKey ?? null,
        access: overrides.value[userId] ?? {},
      } satisfies MemberProfile;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

}

/* --------------------------------------------------------------- app state */

export async function readOrganizationApps(
  organizationId: string,
): Promise<Provisioned<Record<string, boolean>>> {
  const result = await supabase
    .from("organization_app_settings")
    .select("app_key, enabled")
    .eq("organization_id", organizationId);
  if (result.error) {
    if (missingRelation(result.error)) return notProvisioned({});
    throw new Error(result.error.message);
  }
  const enabled: Record<string, boolean> = {};
  for (const row of (result.data ?? []) as Row[]) {
    enabled[String(row["app_key"])] = row["enabled"] !== false;
  }
  return { provisioned: true, value: enabled };
}

export async function setOrganizationApp(input: {
  organizationId: string;
  appId: string;
  enabled: boolean;
  actorUserId: string;
  appName: string;
}): Promise<void> {
  const { error } = await supabase.from("organization_app_settings").upsert(
    {
      organization_id: input.organizationId,
      app_key: input.appId,
      enabled: input.enabled,
      updated_by: input.actorUserId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,app_key" },
  );
  if (error) throw new Error(error.message);

  await audit({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    name: "app.status_changed",
    subject: { type: "app", id: input.appId, label: input.appName },
    summary: `${input.appName} was ${input.enabled ? "enabled" : "disabled"} for the organization.`,
    payload: { enabled: input.enabled },
  });
}

/* ------------------------------------------------------------ member access */

export async function readMemberAccess(
  organizationId: string,
): Promise<Provisioned<Record<string, Record<string, AppAccessLevel>>>> {
  const result = await supabase
    .from("member_app_access")
    .select("user_id, app_key, access_level")
    .eq("organization_id", organizationId);
  if (result.error) {
    if (missingRelation(result.error)) return notProvisioned({});
    throw new Error(result.error.message);
  }
  const map: Record<string, Record<string, AppAccessLevel>> = {};
  for (const row of (result.data ?? []) as Row[]) {
    const userId = String(row["user_id"]);
    map[userId] = map[userId] ?? {};
    map[userId]![String(row["app_key"])] = normalizeAccessLevel(row["access_level"] as string);
  }
  return { provisioned: true, value: map };
}

export async function setMemberAppAccess(input: {
  organizationId: string;
  userId: string;
  memberName: string;
  appId: string;
  appName: string;
  level: AppAccessLevel;
  actorUserId: string;
}): Promise<void> {
  const { error } = await supabase.from("member_app_access").upsert(
    {
      organization_id: input.organizationId,
      user_id: input.userId,
      app_key: input.appId,
      access_level: input.level,
      updated_by: input.actorUserId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,user_id,app_key" },
  );
  if (error) throw new Error(error.message);

  await audit({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    name: "user.access_changed",
    subject: { type: "user", id: input.userId, label: input.memberName },
    summary: `${input.memberName}'s access to ${input.appName} was set to ${input.level}.`,
    payload: { app_key: input.appId, access_level: input.level },
  });
}

/* -------------------------------------------------------- role app access */

/**
 * Per-role room defaults for the whole organization. Absent table means the
 * product falls back to role templates alone, and says so plainly.
 */
export async function readRoleAppAccess(
  organizationId: string,
): Promise<Provisioned<Record<string, Record<string, AppAccessLevel>>>> {
  const result = await supabase
    .from("organization_role_app_access")
    .select("role, app_key, access_level")
    .eq("organization_id", organizationId);
  if (result.error) {
    if (missingRelation(result.error)) return notProvisioned({});
    throw new Error(result.error.message);
  }
  const map: Record<string, Record<string, AppAccessLevel>> = {};
  for (const row of (result.data ?? []) as Row[]) {
    const role = normalizeRole(row["role"] as string | null);
    map[role] = map[role] ?? {};
    map[role]![String(row["app_key"])] = normalizeAccessLevel(row["access_level"] as string);
  }
  return { provisioned: true, value: map };
}

export async function setRoleAppAccess(input: {
  organizationId: string;
  role: WorkspaceRole;
  appId: string;
  appName: string;
  level: AppAccessLevel;
  actorUserId: string;
}): Promise<void> {
  const { error } = await supabase.from("organization_role_app_access").upsert(
    {
      organization_id: input.organizationId,
      role: input.role,
      app_key: input.appId,
      access_level: input.level,
      updated_by: input.actorUserId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,role,app_key" },
  );
  if (error) throw new Error(error.message);

  await audit({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    name: "role.access_changed",
    subject: { type: "role", id: input.role, label: input.role },
    summary: `${input.role} access to ${input.appName} was set to ${input.level}.`,
    payload: { role: input.role, app_key: input.appId, access_level: input.level },
  });
}


export async function setMemberRole(input: {
  organizationId: string;
  userId: string;
  memberName: string;
  role: WorkspaceRole;
  actorUserId: string;
}): Promise<void> {
  const { error } = await supabase
    .from("organization_memberships")
    .update({ role: input.role, updated_at: new Date().toISOString() })
    .eq("organization_id", input.organizationId)
    .eq("user_id", input.userId);
  if (error) throw new Error(error.message);

  await audit({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    name: "user.updated",
    subject: { type: "user", id: input.userId, label: input.memberName },
    summary: `${input.memberName}'s role was changed to ${input.role}.`,
    payload: { role: input.role },
  });
}

export async function setMemberStatus(input: {
  organizationId: string;
  userId: string;
  memberName: string;
  status: "active" | "deactivated";
  actorUserId: string;
}): Promise<void> {
  /* The database records loss of access as `suspended`. The product says
     "deactivated"; the row keeps its history either way. */
  const persisted = input.status === "active" ? "active" : "suspended";
  const { error } = await supabase
    .from("organization_memberships")
    .update({ status: persisted, updated_at: new Date().toISOString() })
    .eq("organization_id", input.organizationId)
    .eq("user_id", input.userId);
  if (error) throw new Error(error.message);

  await audit({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    name: input.status === "active" ? "user.reactivated" : "user.deactivated",
    subject: { type: "user", id: input.userId, label: input.memberName },
    summary:
      input.status === "active"
        ? `${input.memberName} was reactivated.`
        : `${input.memberName} was deactivated.`,
    payload: { status: input.status },
  });
}

/* -------------------------------------------------------------- invitations */

export interface Invitation {
  id: string;
  email: string;
  role: WorkspaceRole;
  status: string;
  access: Record<string, AppAccessLevel>;
  invitedBy: string | null;
  createdAt: string;
  lastSentAt: string | null;
  expiresAt: string | null;
}

function toInvitation(row: Row): Invitation {
  const access = (row["app_access"] ?? {}) as Record<string, string>;
  const normalized: Record<string, AppAccessLevel> = {};
  for (const [key, value] of Object.entries(access)) {
    normalized[key] = normalizeAccessLevel(value);
  }
  return {
    id: String(row["id"]),
    email: String(row["email"] ?? ""),
    role: normalizeRole(row["role"] as string | null),
    status: String(row["status"] ?? "pending"),
    access: normalized,
    invitedBy: (row["invited_by"] as string | null) ?? null,
    createdAt: String(row["created_at"] ?? ""),
    lastSentAt: (row["last_sent_at"] as string | null) ?? null,
    expiresAt: (row["expires_at"] as string | null) ?? null,
  };
}

export async function listInvitations(
  organizationId: string,
): Promise<Provisioned<Invitation[]>> {
  const result = await supabase
    .from("organization_invitations")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (result.error) {
    if (missingRelation(result.error)) return notProvisioned([]);
    throw new Error(result.error.message);
  }
  return { provisioned: true, value: ((result.data ?? []) as Row[]).map(toInvitation) };
}

/** Split a pasted list of emails. Empty and duplicate entries are dropped. */
export function parseEmails(input: string): { valid: string[]; invalid: string[] } {
  const parts = input
    .split(/[\s,;]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const part of parts) {
    if (/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(part)) {
      if (!valid.includes(part)) valid.push(part);
    } else if (!invalid.includes(part)) {
      invalid.push(part);
    }
  }
  return { valid, invalid };
}

/** One saved invitation, enough to deliver an email for it. */
export interface InvitationRef {
  id: string;
  email: string;
}

export async function inviteMembers(input: {
  organizationId: string;
  emails: string[];
  role: WorkspaceRole;
  access: Record<string, AppAccessLevel>;
  actorUserId: string;
}): Promise<InvitationRef[]> {
  if (input.emails.length === 0) return [];
  const now = new Date();
  const expires = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const rows = input.emails.map((email) => ({
    organization_id: input.organizationId,
    email,
    role: input.role,
    app_access: input.access,
    status: "pending",
    invited_by: input.actorUserId,
    created_at: now.toISOString(),
    last_sent_at: now.toISOString(),
    expires_at: expires,
  }));

  const { data, error } = await supabase
    .from("organization_invitations")
    .upsert(rows, { onConflict: "organization_id,email" })
    .select("id, email");
  if (error) throw new Error(error.message);

  for (const email of input.emails) {
    await audit({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      name: "user.invited",
      subject: { type: "user", id: email, label: email },
      summary: `${email} was invited as ${input.role}.`,
      payload: { role: input.role, app_access: input.access, lifecycle: "created" },
    });
  }
  return ((data ?? []) as Row[]).map((row) => ({
    id: String(row["id"]),
    email: String(row["email"] ?? ""),
  }));
}

export async function resendInvitation(input: {
  organizationId: string;
  invitationId: string;
  email: string;
  actorUserId: string;
}): Promise<void> {
  const { error } = await supabase
    .from("organization_invitations")
    .update({ last_sent_at: new Date().toISOString(), status: "pending" })
    .eq("id", input.invitationId);
  if (error) throw new Error(error.message);
  await audit({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    name: "user.invite_resent",
    subject: { type: "user", id: input.email, label: input.email },
    summary: `The invitation for ${input.email} was sent again.`,
    payload: { resend: true, lifecycle: "resent", invitation_id: input.invitationId },
  });
}


export async function cancelInvitation(input: {
  organizationId: string;
  invitationId: string;
  email: string;
  actorUserId: string;
}): Promise<void> {
  const { error } = await supabase
    .from("organization_invitations")
    .update({ status: "cancelled" })
    .eq("id", input.invitationId);
  if (error) throw new Error(error.message);
  await audit({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    name: "user.invite_cancelled",
    subject: { type: "user", id: input.email, label: input.email },
    summary: `The invitation for ${input.email} was cancelled.`,
    payload: { status: "cancelled", lifecycle: "cancelled", invitation_id: input.invitationId },
  });
}

/* --------------------------------------------- invitation email + audit trail */

/** Event names that belong to the invitation lifecycle, in one place. */
export const INVITATION_EVENTS = [
  "user.invited",
  "user.invite_resent",
  "user.invite_cancelled",
  "user.invite_emailed",
  "user.created_with_password",
  "user.password_reset",
  "user.access_revoked",
  "user.account_deleted",
] as const;

export interface InvitationAuditEntry {
  id: string;
  at: string;
  event: string;
  lifecycle:
    | "created"
    | "resent"
    | "cancelled"
    | "emailed"
    | "password_reset"
    | "removed"
    | "other";
  email: string;
  summary: string;
  actorUserId: string | null;
  delivered: boolean | null;
}

function lifecycleOf(event: string): InvitationAuditEntry["lifecycle"] {
  if (event === "user.invited") return "created";
  if (event === "user.invite_resent") return "resent";
  if (event === "user.invite_cancelled") return "cancelled";
  if (event === "user.invite_emailed") return "emailed";
  if (event === "user.created_with_password") return "created";
  if (event === "user.password_reset") return "password_reset";
  if (event === "user.access_revoked" || event === "user.account_deleted") return "removed";
  return "other";
}

/**
 * Everything that has happened to invitations in this organization. Read from
 * the shared activity stream, so it is the same history the rest of the suite
 * sees. RLS decides who may read it; nothing here widens that.
 */
export async function listInvitationAudit(
  organizationId: string,
  limit = 50,
): Promise<Provisioned<InvitationAuditEntry[]>> {
  const result = await supabase
    .from("activities")
    .select("id, event_type, summary, occurred_at, created_at, actor_user_id, payload")
    .eq("organization_id", organizationId)
    .in("event_type", INVITATION_EVENTS as unknown as string[])
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (result.error) {
    if (missingRelation(result.error)) return notProvisioned([]);
    throw new Error(result.error.message);
  }
  const entries = ((result.data ?? []) as Row[]).map((row) => {
    const payload = (row["payload"] ?? {}) as Record<string, unknown>;
    const event = String(row["event_type"] ?? "");
    const delivered = payload["delivered"];
    return {
      id: String(row["id"] ?? crypto.randomUUID()),
      at: String(row["occurred_at"] ?? row["created_at"] ?? ""),
      event,
      lifecycle: lifecycleOf(event),
      email:
        typeof payload["label"] === "string"
          ? (payload["label"] as string)
          : typeof payload["entity_ref"] === "string"
            ? (payload["entity_ref"] as string)
            : "",
      summary: String(row["summary"] ?? ""),
      actorUserId: (row["actor_user_id"] as string | null) ?? null,
      delivered: typeof delivered === "boolean" ? delivered : null,
    } satisfies InvitationAuditEntry;
  });
  return { provisioned: true, value: entries };
}

export interface DeliveryResult {
  delivered: boolean;
  because: string;
  providerId?: string;
}

/**
 * Ask the server to email an invitation that already exists. Persistence and
 * access control are untouched: this only sends a courtesy notification, and a
 * failure to send is reported rather than hidden.
 */
export async function deliverInvitationEmail(input: {
  organizationId: string;
  invitationId: string;
  email: string;
  actorUserId: string;
}): Promise<DeliveryResult> {
  let outcome: DeliveryResult = {
    delivered: false,
    because: "The email could not be sent. The invitation still stands.",
  };
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      outcome = { delivered: false, because: "Sign in again to send invitation emails." };
    } else {
      const response = await fetch("/api/public/settings/invite-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          organizationId: input.organizationId,
          invitationId: input.invitationId,
        }),
      });
      const body = (await response.json().catch(() => null)) as DeliveryResult | null;
      if (body && typeof body.delivered === "boolean") outcome = body;
    }
  } catch {
    /* Keep the default refusal message. */
  }

  await audit({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    name: "user.invite_emailed",
    subject: { type: "user", id: input.email, label: input.email },
    summary: outcome.delivered
      ? `An invitation email was sent to ${input.email}.`
      : `An invitation email to ${input.email} was not delivered. ${outcome.because}`,
    payload: {
      lifecycle: "emailed",
      delivered: outcome.delivered,
      because: outcome.because,
      invitation_id: input.invitationId,
      ...(outcome.providerId ? { provider_id: outcome.providerId } : {}),
    },
  });

  return outcome;
}

/* ------------------------------------------------- admin-managed passwords */

/**
 * Provision a workspace user directly, or set a new password for one who
 * already exists. The browser never holds a service key: it calls the governed
 * server endpoint with the caller's own session, and the endpoint verifies
 * authority before Supabase Auth is touched.
 *
 * The plaintext password lives in this call and nowhere else. It is never put
 * into an activity payload, storage, or a log line — only the fact that the
 * action happened, by whom, for whom, and when.
 */
export interface AdminPasswordResult {
  ok: boolean;
  because?: string;
  userId?: string;
  /** True when creation failed because that email already signs in somewhere. */
  existing?: boolean;
  /** How the person is named, as persisted. */
  name?: string | null;
  /** True when the call completed an earlier attempt instead of creating anew. */
  adopted?: boolean;
}

async function callAdminPassword(body: Record<string, unknown>): Promise<AdminPasswordResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, because: "Sign in again to manage workspace passwords." };
  try {
    const response = await fetch("/api/public/settings/admin-password", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const parsed = (await response.json().catch(() => null)) as AdminPasswordResult | null;
    if (parsed && typeof parsed.ok === "boolean") return parsed;
    return { ok: false, because: "That change could not be completed." };
  } catch {
    return { ok: false, because: "That change could not be completed." };
  }
}

export async function createMemberWithPassword(input: {
  organizationId: string;
  email: string;
  password: string;
  confirmation: string;
  role: WorkspaceRole;
  access: Record<string, AppAccessLevel>;
  actorUserId: string;
  /** How this person should be named in the workspace. */
  fullName?: string;
}): Promise<AdminPasswordResult> {
  const email = input.email.trim().toLowerCase();
  const outcome = await callAdminPassword({
    action: "create_user",
    organizationId: input.organizationId,
    email,
    password: input.password,
    confirmation: input.confirmation,
    role: input.role,
    access: input.access,
    ...(input.fullName?.trim() ? { fullName: input.fullName.trim() } : {}),
  });

  /* History records the creation once. A retry that lands on the same person
     (`adopted`) is not a second provisioning and must not read like one. The
     human name is used when known; the address stays as immutable evidence. */
  if (outcome.ok && !outcome.adopted) {
    const person = (outcome.name ?? input.fullName ?? "").trim();
    await audit({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      name: "user.created_with_password",
      subject: { type: "user", id: outcome.userId ?? email, label: person || email },
      summary: `${person ? `${person} (${email})` : email} was created as ${input.role} with a temporary password.`,
      payload: {
        role: input.role,
        app_access: input.access,
        onboarding: "temporary_password",
        lifecycle: "created",
        full_name: person || null,
        email,
      },
    });
  }
  return outcome;
}

export async function resetMemberPassword(input: {
  organizationId: string;
  userId: string;
  email: string;
  password: string;
  confirmation: string;
  actorUserId: string;
}): Promise<AdminPasswordResult> {
  const outcome = await callAdminPassword({
    action: "reset_password",
    organizationId: input.organizationId,
    userId: input.userId,
    password: input.password,
    confirmation: input.confirmation,
  });

  if (outcome.ok) {
    await audit({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      name: "user.password_reset",
      subject: { type: "user", id: input.userId, label: input.email },
      summary: `An admin set a new sign-in password for ${input.email}.`,
      payload: { lifecycle: "password_reset", target_user_id: input.userId },
    });
  }
  return outcome;
}


/* ------------------------------------------------------------------ profile */

export interface ProfileDetail {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  preferredName: string;
  jobTitle: string;
  timezone: string;
  locale: string;
  avatarUrl: string;
}

export async function readProfile(userId: string, email: string): Promise<ProfileDetail> {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Row;
  const text = (key: string) => String(row[key] ?? "");
  return {
    userId,
    email: text("email") || email,
    firstName: text("first_name"),
    lastName: text("last_name"),
    displayName: text("display_name") || text("full_name"),
    preferredName: text("preferred_name"),
    jobTitle: text("job_title"),
    timezone: text("timezone"),
    locale: text("locale"),
    avatarUrl: text("avatar_url"),
  };
}

/**
 * Save the profile. Columns the deployment has not added yet are dropped and
 * the write is retried, so the supported fields always save.
 */
export async function saveProfile(input: ProfileDetail): Promise<string[]> {
  const full = [input.firstName, input.lastName].filter(Boolean).join(" ").trim();
  const payload: Row = {
    id: input.userId,
    email: input.email,
    full_name: input.displayName || full || null,
    display_name: input.displayName || full || null,
    first_name: input.firstName || null,
    last_name: input.lastName || null,
    preferred_name: input.preferredName || null,
    job_title: input.jobTitle || null,
    timezone: input.timezone || null,
    locale: input.locale || null,
    avatar_url: input.avatarUrl || null,
    updated_at: new Date().toISOString(),
  };
  const dropped: string[] = [];
  const before = Object.keys(payload);

  /* The profile row already exists for every member: it is created with the
     account. Settings updates it rather than upserting, because insert on
     profiles is not a privilege a signed-in person holds. */
  const { data, error } = await writeTolerant<Row>(payload, ["id"], async (body) => {
    const { id, ...fields } = body;
    const result = await supabase
      .from("profiles")
      .update(fields)
      .eq("id", String(id))
      .select("*")
      .maybeSingle();
    return { data: (result.data ?? null) as Row | null, error: result.error };
  });
  if (error) throw new Error(error.message);
  if (data) {
    for (const key of before) if (!(key in data)) dropped.push(key);
  }
  return dropped;
}

/* ------------------------------------------------------------- organization */

export interface OrganizationDetail {
  id: string;
  name: string;
  slug: string;
  websiteUrl: string;
  logoUrl: string;
  timezone: string;
}

export async function readOrganization(organizationId: string): Promise<OrganizationDetail> {
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Row;
  return {
    id: organizationId,
    name: String(row["name"] ?? ""),
    slug: String(row["slug"] ?? ""),
    websiteUrl: String(row["website_url"] ?? ""),
    logoUrl: String(row["logo_url"] ?? ""),
    timezone: String(row["timezone"] ?? ""),
  };
}

export async function saveOrganization(
  input: OrganizationDetail & { actorUserId: string },
): Promise<void> {
  const payload: Row = {
    id: input.id,
    name: input.name,
    slug: input.slug,
    website_url: input.websiteUrl || null,
    logo_url: input.logoUrl || null,
    timezone: input.timezone || null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await writeTolerant<Row>(payload, ["id", "name", "slug"], async (body) => {
    const { id, ...fields } = body;
    const result = await supabase
      .from("organizations")
      .update(fields)
      .eq("id", String(id))
      .select("*")
      .maybeSingle();
    return { data: (result.data ?? null) as Row | null, error: result.error };
  });
  if (error) throw new Error(error.message);

  await audit({
    organizationId: input.id,
    actorUserId: input.actorUserId,
    name: "organization.updated",
    subject: { type: "organization", id: input.id, label: input.name },
    summary: `The organization profile was updated.`,
    payload: {},
  });
}

/* ----------------------------------------------------------- notifications */

export type NotificationPreferences = Record<string, boolean>;

export async function readNotificationPreferences(
  userId: string,
  organizationId: string,
): Promise<Provisioned<NotificationPreferences>> {
  const result = await supabase
    .from("user_notification_preferences")
    .select("preferences")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (result.error) {
    if (missingRelation(result.error)) return notProvisioned({});
    throw new Error(result.error.message);
  }
  const row = (result.data ?? {}) as Row;
  return { provisioned: true, value: (row["preferences"] ?? {}) as NotificationPreferences };
}

export async function saveNotificationPreferences(input: {
  userId: string;
  organizationId: string;
  preferences: NotificationPreferences;
}): Promise<void> {
  const { error } = await supabase.from("user_notification_preferences").upsert(
    {
      user_id: input.userId,
      organization_id: input.organizationId,
      preferences: input.preferences,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,organization_id" },
  );
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------- audit */

async function audit(input: {
  organizationId: string;
  actorUserId: string;
  name: string;
  subject: { type: string; id: string; label: string };
  summary: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  try {
    await supabaseActivity.record({
      organizationId: input.organizationId,
      name: input.name as never,
      subject: input.subject as never,
      summary: input.summary,
      payload: input.payload,
      occurredAt: new Date().toISOString(),
      provenance: {
        appId: "home",
        actor: { type: "user", id: input.actorUserId },
        observedAt: new Date().toISOString(),
        confidence: "observed",
      },
    });
  } catch {
    /* History is best effort. A settings change must never fail because the
       activity stream refused the row. */
  }
}
