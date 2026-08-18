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
  lastActiveAt: string | null;
  /** Per-app overrides recorded for this person. Empty means "role default". */
  access: Record<string, AppAccessLevel>;
}

function nameOf(row: Row, email: string): string {
  const candidate =
    (row["display_name"] as string | null) ??
    (row["full_name"] as string | null) ??
    (row["preferred_name"] as string | null) ??
    null;
  const value = (candidate ?? "").trim();
  if (value) return value;
  return email.split("@")[0] ?? "Member";
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

  return rows
    .map((row) => {
      const userId = String(row["user_id"]);
      const profile = byId.get(userId) ?? {};
      const email = String(profile["email"] ?? "");
      return {
        userId,
        email,
        name: nameOf(profile, email),
        avatarUrl: (profile["avatar_url"] as string | null) ?? null,
        jobTitle: (profile["job_title"] as string | null) ?? null,
        role: normalizeRole(row["role"] as string | null),
        status: String(row["status"] ?? "active"),
        lastActiveAt: (row["last_active_at"] as string | null) ?? null,
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
  const { error } = await supabase
    .from("organization_memberships")
    .update({ status: input.status, updated_at: new Date().toISOString() })
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

export async function inviteMembers(input: {
  organizationId: string;
  emails: string[];
  role: WorkspaceRole;
  access: Record<string, AppAccessLevel>;
  actorUserId: string;
}): Promise<number> {
  if (input.emails.length === 0) return 0;
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

  const { error } = await supabase
    .from("organization_invitations")
    .upsert(rows, { onConflict: "organization_id,email" });
  if (error) throw new Error(error.message);

  for (const email of input.emails) {
    await audit({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      name: "user.invited",
      subject: { type: "user", id: email, label: email },
      summary: `${email} was invited as ${input.role}.`,
      payload: { role: input.role, app_access: input.access },
    });
  }
  return input.emails.length;
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
    name: "user.invited",
    subject: { type: "user", id: input.email, label: input.email },
    summary: `The invitation for ${input.email} was sent again.`,
    payload: { resend: true },
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
    name: "user.updated",
    subject: { type: "user", id: input.email, label: input.email },
    summary: `The invitation for ${input.email} was cancelled.`,
    payload: { status: "cancelled" },
  });
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

  const { data, error } = await writeTolerant<Row>(payload, ["id"], async (body) => {
    const result = await supabase.from("profiles").upsert(body).select("*").maybeSingle();
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
    const result = await supabase.from("organizations").upsert(body).select("*").maybeSingle();
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
