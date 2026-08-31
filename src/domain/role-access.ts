/**
 * Trust Tai OS, role-level room access.
 *
 * A role name alone is a coarse instrument. This layer lets an owner or admin
 * say, for a whole role, which rooms it may see and how far it may act inside
 * them — without touching each person one by one.
 *
 * Two laws keep it fail-closed:
 *   1. A role grant can never exceed what that role's permissions already
 *      carry (`roleCeiling`). The matrix narrows; it never escalates.
 *   2. A per-person override still wins. Role access is the default beneath it.
 */

import { normalizeRole, type WorkspaceRole } from "./access";
import {
  APP_ACCESS_LEVELS,
  normalizeAccessLevel,
  roleCeiling,
  type AppAccessLevel,
} from "./app-access";

/** organization-wide, per-role, per-app defaults as stored. */
export type RoleAccessMap = Record<string, Record<string, AppAccessLevel>>;

const rank = (level: AppAccessLevel): number => APP_ACCESS_LEVELS.indexOf(level);

/** Narrow a proposed level to what the role could ever hold in that room. */
export function clampToRole(
  role: string | null | undefined,
  appId: string,
  level: string | null | undefined,
): AppAccessLevel {
  const ceiling = roleCeiling(normalizeRole(role), appId);
  const proposed = normalizeAccessLevel(level);
  return rank(proposed) > rank(ceiling) ? ceiling : proposed;
}

/** The level this role holds in this room today: recorded grant, else template. */
export function roleAccessFor(
  role: string | null | undefined,
  appId: string,
  map: RoleAccessMap | null | undefined,
): AppAccessLevel {
  const normalized = normalizeRole(role);
  const recorded = map?.[normalized]?.[appId];
  if (recorded === undefined) return roleCeiling(normalized, appId);
  return clampToRole(normalized, appId, recorded);
}

/** Which levels an owner or admin may actually choose for a role and room. */
export function selectableLevels(
  role: string | null | undefined,
  appId: string,
): AppAccessLevel[] {
  const ceiling = roleCeiling(normalizeRole(role), appId);
  return APP_ACCESS_LEVELS.filter((level) => rank(level) <= rank(ceiling));
}

/**
 * The override map a person's access resolution should use: role defaults
 * first, the person's own recorded override on top.
 */
export function effectiveOverrides(input: {
  role: string | null | undefined;
  appIds: string[];
  roleAccess: RoleAccessMap | null | undefined;
  memberAccess: Record<string, AppAccessLevel> | null | undefined;
}): Record<string, AppAccessLevel> {
  const normalized = normalizeRole(input.role);
  const recorded = input.roleAccess?.[normalized];
  const result: Record<string, AppAccessLevel> = {};
  if (recorded) {
    for (const appId of input.appIds) {
      const level = recorded[appId];
      if (level !== undefined) result[appId] = clampToRole(normalized, appId, level);
    }
  }
  for (const [appId, level] of Object.entries(input.memberAccess ?? {})) {
    result[appId] = normalizeAccessLevel(level);
  }
  return result;
}
