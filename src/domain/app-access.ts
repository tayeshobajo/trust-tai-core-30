/**
 * Trust Tai OS, application visibility and authority.
 *
 * Two separate questions, never collapsed into one:
 *   1. Visibility  · may this person SEE this room at all?
 *   2. Authority   · what may they DO once inside it?
 *
 * Effective access is the intersection of three facts:
 *   organization has the app enabled
 *   AND the person's app access level is not `hidden`
 *   AND their role carries the permission that level implies.
 *
 * Unknown role, unknown app, missing record: no access. Always.
 */

import {
  can,
  normalizeRole,
  type AccessContext,
  type Permission,
  type WorkspaceRole,
} from "./access";
import { APP_REGISTRY } from "./registry";

/** What a person may do inside a room. Ordered from least to most. */
export type AppAccessLevel = "hidden" | "view" | "work" | "manage";

export const APP_ACCESS_LEVELS: AppAccessLevel[] = ["hidden", "view", "work", "manage"];

export const APP_ACCESS_LABEL: Record<AppAccessLevel, string> = {
  hidden: "Hidden",
  view: "View",
  work: "Work",
  manage: "Manage",
};

export const APP_ACCESS_DESCRIPTION: Record<AppAccessLevel, string> = {
  hidden: "The room does not appear in their navigation.",
  view: "They can open the room and read it. Nothing can be changed.",
  work: "They can do the everyday work of the room.",
  manage: "They can change how the room is configured for the organization.",
};

const LEVEL_RANK: Record<AppAccessLevel, number> = {
  hidden: 0,
  view: 1,
  work: 2,
  manage: 3,
};

export function normalizeAccessLevel(value: string | null | undefined): AppAccessLevel {
  const candidate = (value ?? "").trim().toLowerCase();
  return (APP_ACCESS_LEVELS as string[]).includes(candidate)
    ? (candidate as AppAccessLevel)
    : "hidden";
}

/* --------------------------------------------------------------- room needs */

/** Permission required to read a room, and to work in it. */
interface AppPermissions {
  read: Permission;
  write?: Permission;
}

const APP_PERMISSIONS: Record<string, AppPermissions> = {
  home: { read: "workspace.read" },
  /*
   * Clients has no permission of its own yet. Reading the book is workspace
   * membership; writing a client record borrows `roadmap.write` because the
   * client record is the head of the prospect -> roadmap lineage and the same
   * people carry both. This is a deliberate, temporary reuse, not a rule:
   * a canonical `clients.write` replaces it once the permission list grows.
   * Row-level security on `clients` governs the actual write either way.
   */
  clients: { read: "workspace.read", write: "roadmap.write" },
  scout: { read: "scout.read", write: "scout.write" },
  comms: { read: "comms.read", write: "comms.write" },
  roadmap: { read: "roadmap.read", write: "roadmap.write" },
  projects: { read: "projects.read", write: "projects.write" },
  steward: { read: "steward.read", write: "steward.write" },
  website: { read: "website.read", write: "website.write" },
  ops: { read: "ops.read" },
  studio: { read: "workspace.read" },
  pulse: { read: "intelligence.read" },
  conductor: { read: "intelligence.read", write: "conductor.approve" },
  approvals: { read: "intelligence.read", write: "conductor.approve" },
};

export function knownApp(appId: string): boolean {
  return APP_REGISTRY.some((app) => app.id === appId);
}

/**
 * The strongest level a role can reach in a room, before any per-person
 * override narrows it. Templates are defaults, not authority.
 */
export function roleCeiling(role: WorkspaceRole, appId: string): AppAccessLevel {
  if (!knownApp(appId)) return "hidden";
  const needs = APP_PERMISSIONS[appId];
  if (!needs) return "hidden";
  const probe: AccessContext = {
    userId: "role-template",
    organizationId: "role-template",
    role,
    active: true,
  };
  if (!can(probe, needs.read)) return "hidden";
  if (can(probe, "org.manage")) return "manage";
  if (needs.write && can(probe, needs.write)) return "work";
  return "view";
}

/** The default level a role template hands a new member for a room. */
export function roleDefaultAccess(role: string | null | undefined, appId: string): AppAccessLevel {
  return roleCeiling(normalizeRole(role), appId);
}

/* ------------------------------------------------------------- the decision */

export interface AppAccessInput {
  role: string | null | undefined;
  /** Membership must be active. Deactivated people see nothing. */
  membershipActive: boolean;
  /** Organization-level switch for this app. */
  organizationEnabled: boolean;
  /** Per-person override, when one has been recorded. */
  override?: string | null | undefined;
}

export interface AppAccessDecision {
  appId: string;
  level: AppAccessLevel;
  visible: boolean;
  canWork: boolean;
  canManage: boolean;
  /** Plain language, for the person and for the audit trail. */
  because: string;
}

const DENIED = (appId: string, because: string): AppAccessDecision => ({
  appId,
  level: "hidden",
  visible: false,
  canWork: false,
  canManage: false,
  because,
});

/** Resolve one person's real access to one room. Fails closed on every gap. */
export function resolveAppAccess(appId: string, input: AppAccessInput): AppAccessDecision {
  if (!knownApp(appId)) return DENIED(appId, "That application is not registered.");
  if (!input.membershipActive) return DENIED(appId, "This membership is not active.");
  if (!input.organizationEnabled) {
    return DENIED(appId, "This application is switched off for the organization.");
  }

  const role = normalizeRole(input.role);
  const ceiling = roleCeiling(role, appId);
  if (ceiling === "hidden") return DENIED(appId, "This role does not include this room.");

  const requested =
    input.override === null || input.override === undefined
      ? ceiling
      : normalizeAccessLevel(input.override);
  if (requested === "hidden") return DENIED(appId, "Hidden for this person.");

  const level: AppAccessLevel = LEVEL_RANK[requested] <= LEVEL_RANK[ceiling] ? requested : ceiling;

  return {
    appId,
    level,
    visible: true,
    canWork: LEVEL_RANK[level] >= LEVEL_RANK["work"],
    canManage: level === "manage",
    because:
      LEVEL_RANK[requested] > LEVEL_RANK[ceiling]
        ? `Narrowed to ${APP_ACCESS_LABEL[level]} by the ${role} role.`
        : APP_ACCESS_DESCRIPTION[level],
  };
}

export interface OrganizationAppState {
  /** app id → organization-level enabled. Missing app: treated as enabled. */
  enabled: Record<string, boolean>;
}

/** Every room this person may see, in registry order. */
export function visibleApps(input: {
  role: string | null | undefined;
  membershipActive: boolean;
  organization: OrganizationAppState;
  overrides: Record<string, string | null | undefined>;
}): AppAccessDecision[] {
  return APP_REGISTRY.map((app) =>
    resolveAppAccess(app.id, {
      role: input.role,
      membershipActive: input.membershipActive,
      organizationEnabled: input.organization.enabled[app.id] !== false,
      override: input.overrides[app.id],
    }),
  ).filter((decision) => decision.visible);
}
