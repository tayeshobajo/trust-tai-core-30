/**
 * Trust Tai OS, identity and access contract.
 *
 * Layer 1 of the OS: user, organization, membership, role, permission, app
 * entitlement. This is deliberately small. Supabase Auth remains the identity
 * provider, `organization_memberships` remains the membership record, and RLS
 * remains the real database boundary. This file only gives the product a typed,
 * testable way to ask "may this person do this here?" so every app asks the
 * same question the same way.
 *
 * It grants nothing the database would refuse. A permission check that passes
 * here can still be rejected by RLS; a check that fails here never reaches the
 * database at all. Fail closed is the default in both directions.
 */

import type { ID } from "./entities";
import { APP_REGISTRY } from "./registry";

/**
 * Roles as they exist in the live `organization_memberships.role` column plus
 * the wider Trust Tai vocabulary. Unknown role strings are never trusted: they
 * resolve to `member`, the least capable role that can still read.
 */
export type WorkspaceRole =
  | "owner"
  | "admin"
  | "leadership"
  | "project_lead"
  | "client_support"
  | "team_member"
  | "member"
  | "viewer";

export const WORKSPACE_ROLES: WorkspaceRole[] = [
  "owner",
  "admin",
  "leadership",
  "project_lead",
  "client_support",
  "team_member",
  "member",
  "viewer",
];

export const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  leadership: "Leadership",
  project_lead: "Project lead",
  client_support: "Client support",
  team_member: "Team member",
  member: "Member",
  viewer: "Viewer",
};

/** Anything a person may be allowed to do. Coarse on purpose. */
export type Permission =
  | "workspace.read"
  | "org.manage"
  | "intelligence.read"
  | "scout.read"
  | "scout.write"
  | "comms.read"
  | "comms.write"
  | "roadmap.read"
  | "roadmap.write"
  | "roadmap.decide"
  | "projects.read"
  | "projects.write"
  /**
   * The Website room. TrustTai.com is a signal source: `website.read` is an
   * awareness/analytics grant, `website.write` only covers acting on an
   * inbound signal inside Core. It never grants Scout qualification.
   */
  | "website.read"
  | "website.write"
  /**
   * Steward is the cross-suite stewardship layer, not a business domain.
   * `steward.write` grants interpretation, memory and judgment actions
   * (confirming a meaning, correcting a belief, authorising a proposal). It
   * never substitutes for the owning room's own write permission: executing
   * work in Comms still requires `comms.write`, and so on.
   */
  | "steward.read"
  | "steward.write"
  /** Enter Ops. Ops is a separate app and enforces its own access as well. */
  | "ops.read"
  /**
   * Conductor governance. `conductor.approve` allows a person to approve, hold
   * or reject a prepared cross-room action; `conductor.execute` allows routing
   * an approved action to the owning room's service. Neither ever substitutes
   * for the owning room's own write permission: routing a Comms draft still
   * requires `comms.write` inside Comms.
   */
  | "conductor.approve"
  | "conductor.execute";

const READ_ONLY: Permission[] = [
  "workspace.read",
  "intelligence.read",
  "scout.read",
  "comms.read",
  "roadmap.read",
  "projects.read",
  "steward.read",
  "website.read",
];

const OPERATOR: Permission[] = [
  ...READ_ONLY,
  "scout.write",
  "comms.write",
  "roadmap.write",
  "projects.write",
  "steward.write",
  "website.write",
  "ops.read",
];

/** Governing the Conductor's control loop is a leadership act, not an ordinary write. */
const CONTROL: Permission[] = ["conductor.approve", "conductor.execute"];

const FULL: Permission[] = [...OPERATOR, "org.manage", "roadmap.decide", ...CONTROL];

export const ROLE_PERMISSIONS: Record<WorkspaceRole, Permission[]> = {
  owner: FULL,
  admin: FULL,
  leadership: [...OPERATOR, "roadmap.decide", ...CONTROL],
  project_lead: [...OPERATOR, "roadmap.decide", ...CONTROL],
  client_support: [...READ_ONLY, "comms.write"],
  team_member: OPERATOR,
  member: OPERATOR,
  viewer: READ_ONLY,
};

/** Roles allowed to change organization-level configuration such as the ICP. */
export const MANAGING_ROLES: WorkspaceRole[] = ["owner", "admin"];

export function normalizeRole(role: string | null | undefined): WorkspaceRole {
  const candidate = (role ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return (WORKSPACE_ROLES as string[]).includes(candidate)
    ? (candidate as WorkspaceRole)
    : "member";
}

/**
 * The authorization envelope every app and the intelligence layer reads.
 * Built from a verified membership only. There is no anonymous variant.
 */
export interface AccessContext {
  userId: ID;
  organizationId: ID;
  role: WorkspaceRole;
  /** Membership must be active for any permission to be granted. */
  active: boolean;
}

export function accessContext(input: {
  userId: ID;
  organizationId: ID;
  role: string | null | undefined;
  active?: boolean;
}): AccessContext {
  return {
    userId: input.userId,
    organizationId: input.organizationId,
    role: normalizeRole(input.role),
    active: input.active ?? true,
  };
}

/** May this person do this, in this organization? Fails closed. */
export function can(access: AccessContext | null | undefined, permission: Permission): boolean {
  if (!access || !access.active) return false;
  if (!access.userId || !access.organizationId) return false;
  return ROLE_PERMISSIONS[access.role].includes(permission);
}

export function canManageOrganization(access: AccessContext | null | undefined): boolean {
  return can(access, "org.manage");
}

/**
 * Cross-organization reads are impossible by contract as well as by RLS.
 * Every service that takes an organization id should route it through here.
 */
export function assertSameOrganization(access: AccessContext, organizationId: ID): void {
  if (access.organizationId !== organizationId) {
    throw new Error("That record belongs to another organization.");
  }
}

/* ------------------------------------------------------------ entitlements */

/** Which room a person may enter, and whether it is built yet. */
export interface AppEntitlement {
  appId: ID;
  slug: string;
  name: string;
  route: string;
  /** Entered through the shell today. */
  enabled: boolean;
  /** Why it is not enabled, in plain language. */
  because?: string;
}

const APP_READ_PERMISSION: Record<string, Permission> = {
  scout: "scout.read",
  comms: "comms.read",
  roadmap: "roadmap.read",
  projects: "projects.read",
  steward: "steward.read",
  pulse: "intelligence.read",
  ops: "ops.read",
  home: "workspace.read",
};

/** Read permission needed to enter a room. Unlisted rooms need workspace.read. */
export function appPermission(appId: string): Permission {
  return APP_READ_PERMISSION[appId] ?? "workspace.read";
}

export function appEntitlements(access: AccessContext | null | undefined): AppEntitlement[] {
  return APP_REGISTRY.map((app) => {
    const allowed = can(access, appPermission(app.id));
    return {
      appId: app.id,
      slug: app.slug,
      name: app.name,
      route: app.route,
      enabled: allowed,
      ...(allowed ? {} : { because: "Your role does not include this room." }),
    };
  });
}

export function isEntitled(access: AccessContext | null | undefined, appId: string): boolean {
  return can(access, appPermission(appId));
}
